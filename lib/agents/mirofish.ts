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

/** Turn the user's query into a single falsifiable forecast question. */
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

Convert the query into ONE single, falsifiable forecast question suitable for polling a simulated swarm of market personas.
Requirements:
- Binary or probabilistic form (e.g. "Will X happen by [time horizon]?" or "How likely is X to Y by [horizon]?")
- Include a concrete time horizon (default "6 months" if not specified)
- Specific and measurable — avoid vague language
- Focused on market/business outcome relevant to ${product}

Reply with ONLY the forecast question string, no JSON, no preamble.`;

  const result = await generateHuggingFaceText(prompt, { maxNewTokens: 160, temperature: 0.2 });
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

  const prompt = `You are a prediction-market analyst synthesising a swarm of simulated AI personas.

Forecast question: "${params.forecastQuestion}"
Product: ${params.product}
Swarm size: ${params.swarmSize} personas responded
${params.priorContext ? `Prior research context:\n${params.priorContext}\n` : ''}
Trend baseline: ${params.trendSummary || 'unavailable'}

Swarm responses (sample):
${responsesSample}

Synthesise these into a structured forecast. Reply with ONLY valid JSON matching this exact shape:
{
  "pointEstimate": 0.0-1.0,           // probability estimate (0 = impossible, 1 = certain)
  "unit": "probability",              // always "probability" for binary/percentage forecasts
  "confidenceLow": 0.0-1.0,          // lower bound of 90% confidence interval
  "confidenceHigh": 0.0-1.0,         // upper bound
  "direction": "up"|"down"|"flat",   // overall direction of the predicted outcome
  "timeHorizon": "string",            // e.g. "6 months", "Q3 2026"
  "distribution": [                   // 4-6 sentiment buckets (label + count of swarm members)
    { "label": "strongly positive", "count": 0 },
    { "label": "positive", "count": 0 },
    { "label": "neutral", "count": 0 },
    { "label": "negative", "count": 0 },
    { "label": "strongly negative", "count": 0 }
  ],
  "contributingSignals": [            // top 3 distinct persona perspectives that most influenced the forecast
    { "persona": "string", "weight": -1.0 to 1.0, "excerpt": "short quote" }
  ],
  "confidenceScore": 0.0-1.0,        // overall confidence in this forecast
  "facts": ["string"],                // 2-4 verifiable swarm findings (e.g. "X% of simulated personas predict Y")
  "interpretation": ["string"],       // 2-3 analyst insights beyond the raw data
  "rationale": "string"               // 2-3 sentence plain-English summary of the forecast
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

  const prompt = `You are simulating a panel of ${SYNTHETIC_PERSONAS.length} independent market personas answering a forecast question about ${product}.

Panel members:
${personaList}

Forecast question: "${forecastQuestion}"

For EACH persona, write a 1-2 sentence response in their voice that:
- Gives their probability estimate (e.g. "I'd put this at ~65% likely")
- Gives their main reason (their background shapes this)
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
        const trendSummary = Array.isArray(td.data)
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
        void trendSummary; // used below
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
    return makeEmptyForecast(query, 'Both real and synthetic swarm returned no responses. Check HUGGING_FACE_API_KEY / model quota.');
  }

  // Step 4: Synthesise swarm responses → structured forecast (via HF JSON)
  const swarmResponseTexts = swarmBundle.responses.map(r => r.response).filter(Boolean);
  const synthesised = await synthesiseForecast({
    forecastQuestion,
    product,
    swarmResponses: swarmResponseTexts,
    swarmSize: swarmBundle.totalCount,
    trendSummary: '',
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
