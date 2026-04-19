import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { orchestrate } from '@/lib/agents/orchestrator';
import type {
  AgentOutput,
  ConversationMessage,
  ExecutionPlanOutput,
  FeedbackAppliedCounts,
  OrchestratorOutput,
  RefinementDelta,
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

// Turn raw outcome rows into a compact text block the execution sub-agents can
// read as part of `priorContext`. Deliberately human-readable so Gemini can
// reason over it directly.
function buildFeedbackSummary(
  feedback: Array<Record<string, unknown>>,
  actions: Array<Record<string, unknown>>,
  variantResults: Array<Record<string, unknown>>,
  focus?: string,
): string {
  const lines: string[] = ['[USER FEEDBACK & OUTCOMES — treat these as the highest-priority signal]'];

  if (focus) lines.push(`Refinement focus: ${focus}`);

  // Recommendations the user liked / disliked
  const likes = feedback.filter(f => f.rating === 'up').map(f => `+ liked: ${f.title}`);
  const dislikes = feedback.filter(f => f.rating === 'down').map(f => `- rejected: ${f.title}${f.note ? ` (${f.note})` : ''}`);

  if (likes.length) lines.push('Recommendations the user validated:', ...likes);
  if (dislikes.length) lines.push('Recommendations the user rejected (do NOT repeat these angles):', ...dislikes);

  // Accepted / refined actions — strong positive signal
  const accepted = actions.filter(a => a.action === 'accepted' || a.action === 'refined').map(a => `~ ${a.action}: ${a.title}`);
  if (accepted.length) lines.push('Actions the user took:', ...accepted);

  // Variant outcomes — the real gold
  if (variantResults.length) {
    lines.push('Variant performance from prior runs:');
    for (const r of variantResults) {
      const parts: string[] = [`  ${r.variant_id}${r.variant_angle ? ` (${r.variant_angle})` : ''}`];
      if (r.sent_count) parts.push(`sent=${r.sent_count}`);
      if (r.open_rate != null) parts.push(`open=${r.open_rate}%`);
      if (r.reply_rate != null) parts.push(`reply=${r.reply_rate}%`);
      if (r.click_rate != null) parts.push(`click=${r.click_rate}%`);
      if (r.meetings_booked) parts.push(`meetings=${r.meetings_booked}`);
      if (r.hypothesis_confirmed) parts.push(`hypothesis=${r.hypothesis_confirmed}`);
      if (r.notes) parts.push(`notes="${String(r.notes).slice(0, 160)}"`);
      lines.push(parts.join(' | '));
    }

    lines.push(
      '',
      'REFINEMENT RULES:',
      '- Keep hypotheses that were confirmed; drop or rewrite hypotheses that were rejected.',
      '- If a variant performed well (reply_rate > 3% or hypothesis=yes), generate a NEW variant that extends its winning angle, not a copy.',
      '- If a variant underperformed (reply_rate < 1% or hypothesis=no), explicitly test the opposite angle.',
      '- Do not reuse identical subject lines or hooks from prior variants.',
    );
  }

  return lines.join('\n');
}

function normalizeFact(fact: string): string {
  return fact.toLowerCase().replace(/\s+/g, ' ').trim();
}

function buildRefinementDeltas(previous: AgentOutput[], next: AgentOutput[]): RefinementDelta[] {
  const previousByDomain = new Map(previous.map(o => [o.domain, o]));

  return next
    .filter(o => o.artifactType !== 'mind-map')
    .map((current): RefinementDelta => {
      const prior = previousByDomain.get(current.domain);
      if (!prior) {
        return {
          domain: current.domain,
          summary: `New ${current.domain} output added in this refined cycle.`,
          afterConfidence: current.confidence,
        };
      }

      const confidenceShift = current.confidenceScore - prior.confidenceScore;
      const priorFacts = new Set(prior.facts.map(normalizeFact));
      const newFacts = current.facts.filter(f => !priorFacts.has(normalizeFact(f)));

      if (Math.abs(confidenceShift) >= 0.08) {
        const direction = confidenceShift > 0 ? 'increased' : 'decreased';
        return {
          domain: current.domain,
          summary: `${current.domain} confidence ${direction} from ${prior.confidence} to ${current.confidence}.`,
          beforeConfidence: prior.confidence,
          afterConfidence: current.confidence,
        };
      }

      if (newFacts.length > 0) {
        return {
          domain: current.domain,
          summary: `${current.domain} added new evidence: ${newFacts[0].slice(0, 140)}.`,
          beforeConfidence: prior.confidence,
          afterConfidence: current.confidence,
        };
      }

      return {
        domain: current.domain,
        summary: `${current.domain} direction retained with refreshed validation from latest feedback context.`,
        beforeConfidence: prior.confidence,
        afterConfidence: current.confidence,
      };
    })
    .slice(0, 8);
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
