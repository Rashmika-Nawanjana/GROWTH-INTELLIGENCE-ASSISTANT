import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { executionEngineAgent } from '@/lib/agents/execution/execution-engine';
import type { AgentContext, AgentOutput, ExecutionPlanOutput } from '@/lib/agents/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Refine a prior execution plan using accumulated feedback/outcomes.
// Flow:
//   1. Read the prior assistant message (its stored orchestratorOutput gives
//      us the research findings to pass back in as grounding).
//   2. Read all outcomes for the session (recommendation feedback, actions,
//      variant results).
//   3. Build a feedbackSummary string and inject it into AgentContext.priorContext.
//   4. Re-run the Execution Engine.
//   5. Return the new ExecutionPlanOutput — frontend swaps it into the message.
//
// This is the "learning across cycles" proof: each refine improves on
// the previous, grounded in real numbers the user pasted in.

interface RefineBody {
  sessionId: string;
  messageId: string;                 // prior assistant message
  focus?: string;                    // optional "refine around X" steer
}

interface StoredOrchestratorOutput {
  query: string;
  product: string;
  competitor?: string;
  outputs: AgentOutput[];
}

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
    .select('id, content, metadata')
    .eq('id', body.messageId)
    .single();

  if (msgErr || !msgRow) {
    return NextResponse.json({ ok: false, error: 'prior message not found' }, { status: 404 });
  }

  const metadata = (msgRow.metadata as Record<string, unknown>) ?? {};
  const orchestratorOutput = metadata.orchestratorOutput as StoredOrchestratorOutput | undefined;

  if (!orchestratorOutput?.outputs?.length) {
    return NextResponse.json({ ok: false, error: 'prior message has no research outputs to refine' }, { status: 400 });
  }

  // Strip the prior execution-plan — we're regenerating it. Keep everything
  // else as research grounding.
  const researchOutputs = orchestratorOutput.outputs.filter(o => o.artifactType !== 'execution-plan');

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

  // 3. Build the refined AgentContext
  const ctx: AgentContext = {
    query: body.focus || orchestratorOutput.query,
    product: orchestratorOutput.product,
    competitor: orchestratorOutput.competitor,
    priorContext: feedbackSummary,       // feedback is the most important grounding
    researchOutputs,
  };

  // 4. Re-run the execution engine
  let newPlan: ExecutionPlanOutput;
  try {
    newPlan = await executionEngineAgent.run(ctx) as ExecutionPlanOutput;
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'execution engine error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    executionPlan: newPlan,
    feedbackApplied: {
      recommendationFeedback: feedbackRes.data?.length ?? 0,
      recommendationActions: actionsRes.data?.length ?? 0,
      variantResults: resultsRes.data?.length ?? 0,
    },
  });
}
