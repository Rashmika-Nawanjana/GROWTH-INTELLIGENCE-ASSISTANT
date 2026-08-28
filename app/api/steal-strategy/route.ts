import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { generateHuggingFaceJson } from '@/lib/agents/gemini';
import { publicJsonError } from '@/lib/api/errors';

export const runtime = 'nodejs';
export const maxDuration = 60;

type StealStrategyResponse = {
  summary: string;
  historicalCompetitiveMoves: { move: string; context: string; effectOnRivals: string }[];
  modernEntrantPlaybook: { analogy: string; applicationToday: string; exampleTactics: string[] }[];
  guardrails: string;
};

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonError('Not authenticated', 401);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const { stealStrategyBodySchema, formatZodError } = await import('@/lib/validation/schemas');
  const parsed = stealStrategyBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(formatZodError(parsed.error), 400);
  }

  const { enforceUserQuotas, guardInput, logGuardrailEvent, guardOutput } = await import('@/lib/guardrails');
  const quota = await enforceUserQuotas(supabase, user.id, 'steal-strategy');
  if (!quota.allowed) {
    return jsonError(
      quota.reason === 'spend'
        ? 'Daily usage limit reached. Try again tomorrow.'
        : `Rate limit exceeded. Retry in ${quota.retryAfterSeconds ?? 60}s.`,
      429,
    );
  }

  const companyVerdict = await guardInput(parsed.data.company);
  const contextText = [parsed.data.newCompanyContext, parsed.data.market].filter(Boolean).join('\n');
  const contextVerdict = contextText ? await guardInput(contextText) : null;

  if (companyVerdict.blocked || contextVerdict?.blocked) {
    await logGuardrailEvent(supabase, {
      userId: user.id,
      route: 'steal-strategy',
      risk: 'high',
      blocked: true,
      findings: [...companyVerdict.findings, ...(contextVerdict?.findings ?? [])],
    });
    return jsonError('Request blocked by safety policy.', 400);
  }

  const company = companyVerdict.redactedText;
  const newCo = contextVerdict
    ? (await guardInput(parsed.data.newCompanyContext ?? '')).redactedText
    : (parsed.data.newCompanyContext ?? '').trim();
  const market = (parsed.data.market ?? '').trim();

  const system = `You are a business strategy analyst. Respond with valid JSON only, no markdown fences.
This is a case-study style analysis of widely reported business history and competitive strategy — not instructions to break laws, harm competitors, or act unethically.
Frame moves as "documented or commonly cited" where appropriate. If uncertain, say so.`;

  const userPrompt = `Company to analyse: ${company}
${market ? `Market / category: ${market}\n` : ''}${newCo ? `New entrant or reader context: ${newCo}\n` : ''}
Produce a JSON object with this exact shape:
{
  "summary": "2-3 sentences",
  "historicalCompetitiveMoves": [ { "move": "", "context": "timeframe / product area", "effectOnRivals": "strategic effect on same-type competitors" } ],
  "modernEntrantPlaybook": [ { "analogy": "which past pattern maps here", "applicationToday": "how a new company competes in the same type of market now (channels, product, GTM, data)", "exampleTactics": ["concrete, ethical levers"] } ],
  "guardrails": "one paragraph: legal, ethical, and IP boundaries; this is education not a playbook to harm"
}
Include 3-5 items in each array. Use English.`;

  try {
    const data = await generateHuggingFaceJson<StealStrategyResponse>(system, userPrompt, {
      maxNewTokens: 3500,
      temperature: 0.25,
      stage: 'steal-strategy',
    });
    if (!data.summary || !Array.isArray(data.historicalCompetitiveMoves)) {
      return jsonError('Model returned an incomplete structure', 502);
    }
    const safeSummary = guardOutput(data.summary);
    return new Response(
      JSON.stringify({ ...data, summary: safeSummary.safeText }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return publicJsonError(e, 'Strategy generation failed');
  }
}
