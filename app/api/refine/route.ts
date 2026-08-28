import { NextRequest, NextResponse, after } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { runOrchestration } from '@/lib/agents/orchestrate-entry';
import { buildRefinementDeltas } from '@/lib/agents/refine-utils';
import { getPastOutcomes } from '@/lib/memory-store';
import { runWithUsageLedger } from '@/lib/observability/usage-ledger';
import { flushLangfuse, runWithLangfuseTrace } from '@/lib/observability/langfuse';
import type {
  ConversationMessage,
  ExecutionPlanOutput,
  FeedbackAppliedCounts,
  OrchestratorOutput,
} from '@/lib/agents/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Refine a prior run using accumulated feedback/outcomes.
// Flow:
//   1. Read the prior assistant message and session history.
//   2. Read all outcomes for the session (recommendation feedback, actions,
//      variant results).
//   3. Build a feedbackSummary string and inject it into research context.
//   4. Re-run FULL orchestration (research + execution), not only Stage 2.
//   5. Return the refined OrchestratorOutput + execution plan + change deltas.
//
// This is the "learning across cycles" proof: each refine improves on
// the previous, grounded in real numbers the user pasted in.

interface RefineBody {
  sessionId: string;
  messageId: string;                 // prior assistant message
  focus?: string;                    // optional "refine around X" steer
}

interface StoredOrchestratorOutput extends OrchestratorOutput {}

async function getSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
}

export async function POST(req: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const { refineBodySchema, formatZodError } = await import('@/lib/validation/schemas');
  const parsed = refineBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;

  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 });
  }

  const { enforceUserQuotas, guardInput, logGuardrailEvent } = await import('@/lib/guardrails');
  const quota = await enforceUserQuotas(supabase, user.id, 'refine');
  if (!quota.allowed) {
    return NextResponse.json({
      ok: false,
      error: quota.reason === 'spend'
        ? 'Daily usage limit reached. Try again tomorrow.'
        : `Rate limit exceeded. Retry in ${quota.retryAfterSeconds ?? 60}s.`,
    }, { status: 429 });
  }

  if (body.focus) {
    const focusVerdict = await guardInput(body.focus);
    if (focusVerdict.blocked) {
      await logGuardrailEvent(supabase, {
        userId: user.id,
        route: 'refine',
        risk: focusVerdict.risk,
        blocked: true,
        findings: focusVerdict.findings,
      });
      return NextResponse.json({ ok: false, error: 'Request blocked by safety policy.' }, { status: 400 });
    }
    body.focus = focusVerdict.redactedText;
  }

  // 1. Pull the prior assistant message so we have the research outputs
  const { data: msgRow, error: msgErr } = await supabase
    .from('chat_messages')
    .select('id, content, metadata, created_at')
    .eq('id', body.messageId)
    .eq('session_id', body.sessionId)
    .single();

  if (msgErr || !msgRow) {
    return NextResponse.json(
      { ok: false, error: 'Saved message not found for this session (it may not have been persisted yet). Wait for the run to save, or send a new query.' },
      { status: 404 },
    );
  }

  const metadata = (msgRow.metadata as Record<string, unknown>) ?? {};
  const orchestratorOutput = metadata.orchestratorOutput as StoredOrchestratorOutput | undefined;

  if (!orchestratorOutput?.outputs?.length) {
    return NextResponse.json(
      {
        ok: false,
        error: 'This message has no saved research outputs. Run a full intelligence query first, then use Refine.',
      },
      { status: 400 },
    );
  }

  // 2. Pull all session feedback via shared memory store
  const pastOutcomes = await getPastOutcomes(supabase, {
    sessionId: body.sessionId,
    scope: 'session',
    limit: 30,
    focus: body.focus,
    userId: user.id,
  });

  const feedbackSummary = pastOutcomes.summaryBlock;

  const feedbackApplied: FeedbackAppliedCounts = {
    recommendationFeedback: pastOutcomes.feedback.length,
    recommendationActions: pastOutcomes.actions.length,
    variantResults: pastOutcomes.variantResults.length,
  };

  // 3. Rebuild history up to the message being refined and re-run full orchestration.
  const { data: historyRows } = await supabase
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('session_id', body.sessionId)
    .lte('created_at', msgRow.created_at)
    .order('created_at', { ascending: true })
    .limit(80);

  const history: ConversationMessage[] = (historyRows ?? []).map((row: { role: 'user' | 'assistant'; content: string; created_at: string }) => ({
    role: row.role,
    content: row.content,
    timestamp: row.created_at,
  }));

  const refinedQuery = body.focus || orchestratorOutput.query;

  let refinedOutput: OrchestratorOutput;
  try {
    const { result } = await runWithLangfuseTrace(
      {
        name: 'refine-orchestration',
        input: { query: refinedQuery.slice(0, 200), focus: body.focus },
        userId: user.id,
        sessionId: body.sessionId,
        tags: ['refine'],
        asType: 'chain',
      },
      async () => {
        const output = await runWithUsageLedger(
          {
            sessionId: body.sessionId,
            userId: user.id,
            queryPreview: refinedQuery.slice(0, 120),
          },
          () => runOrchestration(
            refinedQuery,
            history,
            undefined,
            [],
            undefined,
            {
              injectedContext: feedbackSummary,
              forceExecution: true,
              userId: user.id,
            },
          ),
        );
        return output;
      },
    );
    refinedOutput = result;
  } catch (err) {
    const { toPublicError } = await import('@/lib/api/errors');
    const { message } = toPublicError(err, 'Re-orchestration failed');
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }

  const deltas = buildRefinementDeltas(orchestratorOutput.outputs ?? [], refinedOutput.outputs ?? []);

  const deltaLines = deltas.slice(0, 3).map(d => `- ${d.summary}`);
  const synthesizedAnswer = deltaLines.length > 0
    ? `${refinedOutput.synthesizedAnswer}\n\nFeedback-driven updates:\n${deltaLines.join('\n')}`
    : refinedOutput.synthesizedAnswer;

  const enrichedOutput: OrchestratorOutput = {
    ...refinedOutput,
    synthesizedAnswer,
    refinement: {
      refinedFromMessageId: body.messageId,
      focus: body.focus,
      feedbackApplied,
      deltas,
      feedbackSummary,
    },
  };

  const newPlan = enrichedOutput.outputs.find(o => o.artifactType === 'execution-plan') as ExecutionPlanOutput | undefined;
  if (!newPlan) {
    const execRun = refinedOutput.agentRuns.find(r => r.agentId === 'execution-engine');
    const why =
      execRun?.status === 'failed' && execRun.error
        ? `Execution step failed: ${execRun.error}`
        : 'The refined run completed without an execution-plan artifact (execution may have been skipped or errored).';
    return NextResponse.json({ ok: false, error: why }, { status: 500 });
  }

  after(async () => { await flushLangfuse(); });

  return NextResponse.json({
    ok: true,
    executionPlan: newPlan,
    orchestratorOutput: enrichedOutput,
    feedbackApplied,
    changes: deltas,
  });
}
