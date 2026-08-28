/**
 * MiroFish Forecast Agent — Stage 1 specialist
 *
 * Runs in parallel with the 6 research agents.  Calls a pre-prepared MiroFish
 * swarm simulation to produce a probabilistic forecast for forward-looking queries.
 *
 * Fast path: uses /api/simulation/interview/all on an existing simulation.
 * Slow setup path: handled once out-of-band via scripts/mirofish-bootstrap.ts.
 */

import { interviewSwarm, isSimulationReady, getSimulationIdForProduct } from '../tools/mirofish';
import { searchTrends } from '../tools/serpapi';
import { generateHuggingFaceText, generateHuggingFaceJson } from './gemini';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  ForecastOutput,
  AgentSource,
} from './types';
import { scoreToLevel } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return a graceful empty forecast when MiroFish is unavailable. */
function makeEmptyForecast(query: string, reason: string): ForecastOutput {
  return {
    agentId: 'mirofish',
    domain: 'mirofish',
    artifactType: 'forecast-chart',
    confidence: 'low',
    confidenceScore: 0.1,
    facts: [],
    interpretation: [`MiroFish unavailable: ${reason}`],
    sources: [],
    generatedAt: new Date().toISOString(),
    question: query,
    pointEstimate: 0,
    unit: 'probability',
    confidenceLow: 0,
    confidenceHigh: 0,
    direction: 'flat',
    swarmSize: 0,
    timeHorizon: 'unknown',
    distribution: [],
    contributingSignals: [],
    rationale: `Swarm prediction unavailable: ${reason}`,
  };
}

/** Turn the user's query into a swarm poll question that stays faithful to the original intent. */
async function formulateForecastQuestion(
  query: string,
  product: string,
  competitor: string | undefined,
  priorContext: string | undefined,
): Promise<string> {
  const prompt = `You are a prediction-market question writer.

Product: ${product}${competitor ? `\nCompetitor: ${competitor}` : ''}
${priorContext ? `Prior context:\n${priorContext}\n` : ''}
User query: "${query}"

Rephrase the user's query into ONE question suitable for polling a simulated swarm of market personas.
Critical rules:
- PRESERVE the original intent exactly — do NOT change the topic or introduce new subjects the user did not mention
- If the user asked about threats, competitors, or market landscape, ask the swarm about threats/competitors/landscape
- If the user asked about a specific company, region, or product, keep that exact focus
- Only use "Will X happen by [horizon]?" form if the user explicitly asked about a future event
- For descriptive questions (threats, competitors, positioning, strategy), use open-ended form: "From your perspective, what are the main [topic] for [subject]?"
- Include geographic or domain context from the original query (e.g. "in Sri Lanka", "in 2026")
- Keep it specific and measurable

Reply with ONLY the rephrased question string, no JSON, no preamble.`;

  const result = await generateHuggingFaceText(prompt, { maxNewTokens: 160, temperature: 0.2, stage: 'mirofish' });
  return result.trim() || query;
}

/** Send swarm responses + trend baseline to Gemini → structured ForecastOutput fields. */
async function synthesiseForecast(params: {
  forecastQuestion: string;
  product: string;
  swarmResponses: string[];
  swarmSize: number;
  trendSummary: string;
  priorContext: string | undefined;
}): Promise<{
  pointEstimate: number;
  unit: 'probability' | 'value' | 'percent';
  confidenceLow: number;
  confidenceHigh: number;
  direction: 'up' | 'down' | 'flat';
  timeHorizon: string;
  distribution: { label: string; count: number }[];
  contributingSignals: { persona: string; weight: number; excerpt?: string }[];
  confidenceScore: number;
  facts: string[];
  interpretation: string[];
  rationale: string;
}> {
  const responsesSample = params.swarmResponses.slice(0, 30).join('\n---\n');

  const prompt = `You are a market-intelligence analyst synthesising a swarm of simulated market personas.

Swarm question: "${params.forecastQuestion}"
Product/Subject: ${params.product}
Swarm size: ${params.swarmSize} personas responded
${params.priorContext ? `Prior research context:\n${params.priorContext}\n` : ''}
Trend baseline: ${params.trendSummary || 'unavailable'}

Swarm responses (sample):
${responsesSample}

Synthesise these into a structured swarm consensus. Stay true to what was asked — do NOT reframe the question.
For questions about threats, competitors, or landscape, "pointEstimate" represents the overall severity/concern level (0=no threat, 1=critical threat).
For questions about future events, "pointEstimate" represents probability.

Reply with ONLY valid JSON matching this exact shape:
{
  "pointEstimate": 0.0-1.0,           // severity/concern level or probability, depending on question type
  "unit": "probability",
  "confidenceLow": 0.0-1.0,          // lower bound of 90% confidence interval
  "confidenceHigh": 0.0-1.0,         // upper bound
  "direction": "up"|"down"|"flat",   // trend direction (up = increasing threat/likelihood)
  "timeHorizon": "string",            // e.g. "2026", "next 12 months" — use context from the question
  "distribution": [                   // 4-6 buckets reflecting swarm sentiment on THIS specific question
    { "label": "high threat", "count": 0 },
    { "label": "moderate threat", "count": 0 },
    { "label": "neutral", "count": 0 },
    { "label": "low threat", "count": 0 }
  ],
  "contributingSignals": [            // top 3 persona perspectives that most influenced the synthesis
    { "persona": "string", "weight": -1.0 to 1.0, "excerpt": "short quote directly addressing the question" }
  ],
  "confidenceScore": 0.0-1.0,        // overall confidence in this synthesis
  "facts": ["string"],                // 2-4 specific findings from the swarm directly answering the question
  "interpretation": ["string"],       // 2-3 analyst insights that directly address what was asked
  "rationale": "string"               // 2-3 sentence summary that directly answers the original question
}`;

  try {
    return await generateHuggingFaceJson<any>('You are a prediction-market analyst.', prompt, {
      maxNewTokens: 1400,
      temperature: 0.2,
    });
  } catch {
    return {
      pointEstimate: 0.5,
      unit: 'probability',
      confidenceLow: 0.3,
      confidenceHigh: 0.7,
      direction: 'flat',
      timeHorizon: '6 months',
      distribution: [],
      contributingSignals: [],
      confidenceScore: 0.3,
      facts: [`${params.swarmSize} simulated personas were polled`],
      interpretation: ['Synthesis parsing failed; raw swarm data was received'],
      rationale: 'Synthesis step encountered an error. Raw swarm data was collected but could not be fully structured.',
    };
  }
}

// ── Synthetic swarm fallback ──────────────────────────────────────────────────
// When no MiroFish backend is available, Gemini role-plays as a diverse
// population of market personas.  Each persona gives a probability estimate +
// short rationale.  The output is structurally identical to a real swarm run.

const SYNTHETIC_PERSONAS = [
  'enterprise CTO evaluating AI vendors',
  'Series B SaaS founder',
  'growth-stage product manager',
  'B2B sales leader in tech',
  'VC analyst tracking AI infrastructure',
  'startup operator with sales automation background',
  'mid-market RevOps director',
  'digital-native SMB founder',
  'technical co-founder building with agents',
  'analyst at a research firm covering AI tooling',
  'CMO at a scale-up',
  'procurement lead at a Fortune-500 firm',
  'developer advocate in the LLM ecosystem',
  'early adopter SaaS power user',
  'CFO evaluating AI ROI',
];

async function runSyntheticSwarm(
  forecastQuestion: string,
  product: string,
): Promise<{ responses: string[]; totalCount: number }> {
  const personaList = SYNTHETIC_PERSONAS.map((p, i) => `${i + 1}. ${p}`).join('\n');

  const prompt = `You are simulating a panel of ${SYNTHETIC_PERSONAS.length} independent market personas answering a question about ${product}.

Panel members:
${personaList}

Question: "${forecastQuestion}"

For EACH persona, write a 1-2 sentence response in their voice that:
- Directly answers the question as asked (do NOT reframe or change the topic)
- Gives their specific view based on their background
- Is grounded in realistic market signals for 2025/2026

Reply with ONLY a JSON object with a "responses" field containing an array of ${SYNTHETIC_PERSONAS.length} strings (one per persona, in order):
{ "responses": ["response1", "response2", ...] }`;

  try {
    const parsed = await generateHuggingFaceJson<{ responses?: string[] }>(
      'You are a simulation engine producing structured persona responses.',
      prompt,
      { maxNewTokens: 1600, temperature: 0.5 },
    );
    const responses = Array.isArray(parsed?.responses) ? parsed.responses.filter(Boolean) : [];
    return { responses, totalCount: responses.length };
  } catch {
    return { responses: [], totalCount: 0 };
  }
}



async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext } = ctx;
  const sources: AgentSource[] = [];
  let trendSummary = '';

  // Step 0: Resolve simulation_id for the active product
  const simulationId = getSimulationIdForProduct(product);

  // Step 1: Quick health check — does not block if backend is down
  const useRealSwarm = simulationId
    ? await isSimulationReady(simulationId).catch(() => false)
    : false;

  // Step 2: Formulate a good forecast question from the user query
  const forecastQuestion = await formulateForecastQuestion(
    query, product, competitor, priorContext,
  ).catch(() => query);

  // Step 3: Fan-out — interview swarm (real or synthetic) + trend baseline in parallel
  let swarmBundle: { responses: { response: string }[]; totalCount: number };
  let swarmSourceLabel: string;

  if (useRealSwarm && simulationId) {
    const [interviewResult, trendsResult] = await Promise.allSettled([
      interviewSwarm(simulationId, forecastQuestion, { timeoutSec: 90 }),
      searchTrends([product, competitor].filter(Boolean) as string[]),
    ]);

    if (interviewResult.status === 'rejected') {
      // Real swarm failed — fall through to synthetic below
      const synth = await runSyntheticSwarm(forecastQuestion, product);
      swarmBundle = { responses: synth.responses.map(r => ({ response: r })), totalCount: synth.totalCount };
      swarmSourceLabel = `Synthetic swarm — ${synth.totalCount} AI personas (real swarm failed)`;
    } else {
      swarmBundle = interviewResult.value.data;
      swarmSourceLabel = `MiroFish swarm — ${swarmBundle.totalCount} simulated personas polled`;
      if (trendsResult.status === 'fulfilled') {
        const td = trendsResult.value;
        trendSummary = Array.isArray(td.data)
          ? (td.data as Array<{ keyword?: string; value?: number }>)
              .slice(0, 3)
              .map(p => `${p.keyword ?? ''}: ${p.value ?? ''}`)
              .join(', ')
          : String(td.data ?? '');
        sources.push({
          url: td.sourceUrl ?? '',
          title: 'Google Trends baseline',
          timestamp: td.timestamp,
          tool: 'serpapi',
        });
      }
    }

    sources.push({
      url: interviewResult.status === 'fulfilled'
        ? (interviewResult.value.sourceUrl ?? `${process.env.MIROFISH_BASE_URL ?? 'http://localhost:5001'}/api/simulation/interview/all`)
        : 'synthetic',
      title: swarmSourceLabel,
      timestamp: new Date().toISOString(),
      tool: 'mirofish',
    });
  } else {
    // No real simulation available — use LLM-based synthetic swarm
    const [synthResult, trendsResult] = await Promise.allSettled([
      runSyntheticSwarm(forecastQuestion, product),
      searchTrends([product, competitor].filter(Boolean) as string[]),
    ]);

    const synth = synthResult.status === 'fulfilled' ? synthResult.value : { responses: [], totalCount: 0 };
    swarmBundle = { responses: synth.responses.map(r => ({ response: r })), totalCount: synth.totalCount };

    sources.push({
      url: 'synthetic',
      title: `Synthetic swarm — ${synth.totalCount} AI personas (no live simulation)`,
      timestamp: new Date().toISOString(),
      tool: 'mirofish',
    });

    if (trendsResult.status === 'fulfilled') {
      const td = trendsResult.value;
      sources.push({
        url: td.sourceUrl ?? '',
        title: 'Google Trends baseline',
        timestamp: td.timestamp,
        tool: 'serpapi',
      });
    }
  }

  // If swarm is empty (total failure), return graceful empty
  if (!swarmBundle.totalCount) {
    return makeEmptyForecast(query, 'Both real and synthetic swarm returned no responses. Check GEMINI_API_KEY / model quota.');
  }

  // Step 4: Synthesise swarm responses → structured forecast (via HF JSON)
  const swarmResponseTexts = swarmBundle.responses.map(r => r.response).filter(Boolean);
  const synthesised = await synthesiseForecast({
    forecastQuestion,
    product,
    swarmResponses: swarmResponseTexts,
    swarmSize: swarmBundle.totalCount,
    trendSummary,
    priorContext,
  });

  return {
    agentId: 'mirofish',
    domain: 'mirofish',
    artifactType: 'forecast-chart',
    confidence: scoreToLevel(synthesised.confidenceScore),
    confidenceScore: synthesised.confidenceScore,
    facts: synthesised.facts,
    interpretation: synthesised.interpretation,
    sources,
    generatedAt: new Date().toISOString(),
    question: forecastQuestion,
    pointEstimate: synthesised.pointEstimate,
    unit: synthesised.unit,
    confidenceLow: synthesised.confidenceLow,
    confidenceHigh: synthesised.confidenceHigh,
    direction: synthesised.direction,
    swarmSize: swarmBundle.totalCount,
    timeHorizon: synthesised.timeHorizon,
    distribution: synthesised.distribution ?? [],
    contributingSignals: synthesised.contributingSignals ?? [],
    rationale: synthesised.rationale,
  } as ForecastOutput;
}

// ── Export ────────────────────────────────────────────────────────────────────

export const mirofishAgent: AgentConfig = {
  id: 'mirofish',
  name: 'MiroFish (Forecast)',
  description: 'Swarm-simulation forecasting — interviews thousands of simulated personas to predict what happens next',
  run,
};
