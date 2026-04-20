import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { orchestrate } from '@/lib/agents/orchestrator';
import { buildFeedbackSummary, buildRefinementDeltas } from '@/lib/agents/refine-utils';
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
  let body: RefineBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  if (!body.sessionId || !body.messageId) {
    return NextResponse.json({ ok: false, error: 'sessionId and messageId required' }, { status: 400 });
  }

  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }

  // 1. Pull the prior assistant message so we have the research outputs
  const { data: msgRow, error: msgErr } = await supabase
    .from('chat_messages')
    .select('id, content, metadata, created_at')
    .eq('id', body.messageId)
    .eq('session_id', body.sessionId)
    .single();

  if (msgErr || !msgRow) {
    return NextResponse.json({ ok: false, error: 'prior message not found' }, { status: 404 });
  }

  const metadata = (msgRow.metadata as Record<string, unknown>) ?? {};
  const orchestratorOutput = metadata.orchestratorOutput as StoredOrchestratorOutput | undefined;

  if (!orchestratorOutput?.outputs?.length) {
    return NextResponse.json({ ok: false, error: 'prior message has no research outputs to refine' }, { status: 400 });
  }

  // 2. Pull all session feedback in parallel
  const [feedbackRes, actionsRes, resultsRes] = await Promise.all([
    supabase.from('recommendation_feedback').select('*').eq('session_id', body.sessionId).order('created_at', { ascending: false }).limit(30),
    supabase.from('recommendation_actions').select('*').eq('session_id', body.sessionId).order('created_at', { ascending: false }).limit(30),
    supabase.from('variant_results').select('*').eq('session_id', body.sessionId).order('created_at', { ascending: false }).limit(30),
  ]);

  const feedbackSummary = buildFeedbackSummary(
    feedbackRes.data ?? [],
    actionsRes.data ?? [],
    resultsRes.data ?? [],
    body.focus,
  );

  const feedbackApplied: FeedbackAppliedCounts = {
    recommendationFeedback: feedbackRes.data?.length ?? 0,
    recommendationActions: actionsRes.data?.length ?? 0,
    variantResults: resultsRes.data?.length ?? 0,
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
    refinedOutput = await orchestrate(
      refinedQuery,
      history,
      undefined,
      [],
      undefined,
      {
        injectedContext: feedbackSummary,
        forceExecution: true,
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'refine orchestration error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
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
    return NextResponse.json({ ok: false, error: 'refined run did not produce an execution plan' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    executionPlan: newPlan,
    orchestratorOutput: enrichedOutput,
    feedbackApplied,
    changes: deltas,
  });
}
