import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { generateHuggingFaceJson } from '@/lib/agents/gemini';

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

  let body: { company?: string; newCompanyContext?: string; market?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const company = (body.company ?? '').trim();
  if (company.length < 2) {
    return jsonError('company is required (at least 2 characters)', 400);
  }
  const newCo = (body.newCompanyContext ?? '').trim();
  const market = (body.market ?? '').trim();

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
    });
    if (!data.summary || !Array.isArray(data.historicalCompetitiveMoves)) {
      return jsonError('Model returned an incomplete structure', 502);
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Strategy generation failed';
    return jsonError(msg, 500);
  }
}
