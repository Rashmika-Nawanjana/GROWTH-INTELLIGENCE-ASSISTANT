/**
 * MiroFish Live Agent
 *
 * Runs against the real MiroFish VPS at MIROFISH_LIVE_BASE_URL.
 * Unlike the standard mirofish agent there is NO synthetic fallback —
 * if the backend is unreachable the agent returns a clear empty output
 * so the UI can show "Live VPS unavailable" rather than silently
 * substituting synthetic data.
 *
 * This agent is opt-in only (not in ALL_AGENTS) and is dispatched via
 * runMirofishLiveAgent in orchestrator.ts when the user has toggled it.
 */

import {
  interviewLiveSwarm,
  isLiveSimulationReady,
  getLiveSimulationIdForProduct,
  LIVE_BASE_URL,
} from '../tools/mirofish-live';
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

function makeEmptyForecast(query: string, reason: string): ForecastOutput {
  return {
    agentId: 'mirofish-live',
    domain: 'mirofish-live',
    artifactType: 'forecast-chart',
    confidence: 'low',
    confidenceScore: 0.1,
    facts: [],
    interpretation: [`MiroFish Live unavailable: ${reason}`],
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
    rationale: `Live swarm unavailable: ${reason}`,
  };
}

function getLiveMaxAgents(): number {
  const raw = parseInt(process.env.MIROFISH_LIVE_MAX_AGENTS ?? '5', 10);
  if (!Number.isFinite(raw)) return 5;
  return Math.max(1, Math.min(12, raw));
}

function getLiveInterviewTimeoutSec(): number {
  const raw = parseInt(process.env.MIROFISH_LIVE_INTERVIEW_TIMEOUT_SEC ?? '240', 10);
  if (!Number.isFinite(raw)) return 240;
  return Math.max(30, Math.min(360, raw));
}

function hasNonAscii(text: string | undefined): boolean {
  if (!text) return false;
  return /[^\x00-\x7F]/.test(text);
}

async function translateToEnglishIfNeeded(text: string | undefined): Promise<string | undefined> {
  if (!text) return text;
  if (!hasNonAscii(text)) return text;
  try {
    const translated = await generateHuggingFaceText(
      `Translate to fluent English. Keep meaning and be concise.\n\nText:\n${text}\n\nEnglish:`,
      { maxNewTokens: 120, temperature: 0.1 },
    );
    return translated.trim() || text;
  } catch {
    return text;
  }
}

async function formulateForecastQuestion(
  query: string,
  product: string,
  competitor: string | undefined,
  priorContext: string | undefined,
): Promise<string> {
  const fallback = query.trim();
  const prompt = `You are a prediction-market question writer.

Product: ${product}${competitor ? `\nCompetitor: ${competitor}` : ''}
${priorContext ? `Prior context:\n${priorContext}\n` : ''}
User query: "${query}"

Rephrase the user's query into ONE question suitable for polling a simulated swarm of market personas.
Critical rules:
- PRESERVE the original intent exactly — do NOT change the topic
- For descriptive questions use open-ended form: "From your perspective, what are the main [topic] for [subject]?"
- For future event questions use: "Will X happen by [horizon]?"
- Keep it specific and measurable

Reply with ONLY the rephrased question string, no JSON, no preamble.`;

  const result = await generateHuggingFaceText(prompt, { maxNewTokens: 160, temperature: 0.2 });
  return sanitiseInterviewQuestion(result, fallback);
}

function sanitiseInterviewQuestion(raw: string | undefined, fallback: string): string {
  const value = (raw ?? '').trim();
  if (!value) return fallback;

  // Remove control chars and common mojibake symbols that blow up token count.
  let cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[�]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // If model returns extra leading junk, keep from first plausible sentence start.
  const starts = ['From your perspective', 'Will ', 'What ', 'How ', 'Why '];
  const idx = starts
    .map(s => cleaned.indexOf(s))
    .filter(i => i >= 0)
    .sort((a, b) => a - b)[0];
  if (typeof idx === 'number' && idx > 0) cleaned = cleaned.slice(idx).trim();

  // Hard cap prompt length to keep interview requests under Groq TPM.
  const MAX_CHARS = 220;
  if (cleaned.length > MAX_CHARS) cleaned = `${cleaned.slice(0, MAX_CHARS - 3).trim()}...`;

  return cleaned || fallback;
}

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
  const prompt = `You are a market-intelligence analyst synthesising a live swarm of real simulated personas.

Swarm question: "${params.forecastQuestion}"
Product/Subject: ${params.product}
Live swarm size: ${params.swarmSize} personas responded from MiroFish VPS
${params.priorContext ? `Prior research context:\n${params.priorContext}\n` : ''}
Trend baseline: ${params.trendSummary || 'unavailable'}

Live swarm responses (sample):
${responsesSample}

Synthesise into a structured swarm consensus. Stay true to what was asked.
For threat/landscape questions, pointEstimate = severity (0=none, 1=critical).
For future-event questions, pointEstimate = probability.

Reply with ONLY valid JSON:
{
  "pointEstimate": 0.0-1.0,
  "unit": "probability",
  "confidenceLow": 0.0-1.0,
  "confidenceHigh": 0.0-1.0,
  "direction": "up"|"down"|"flat",
  "timeHorizon": "string",
  "distribution": [
    { "label": "high", "count": 0 },
    { "label": "moderate", "count": 0 },
    { "label": "neutral", "count": 0 },
    { "label": "low", "count": 0 }
  ],
  "contributingSignals": [
    { "persona": "string", "weight": -1.0 to 1.0, "excerpt": "short quote" }
  ],
  "confidenceScore": 0.0-1.0,
  "facts": ["string"],
  "interpretation": ["string"],
  "rationale": "string"
}

All output must be in English.
If source snippets are non-English, translate them into English before writing facts, interpretation, or contributingSignals excerpts.`;

  try {
    return await generateHuggingFaceJson<any>(
      'You are a prediction-market analyst.',
      prompt,
      { maxNewTokens: 1400, temperature: 0.2 },
    );
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
      confidenceScore: 0.35,
      facts: [`${params.swarmSize} live personas were polled from MiroFish VPS`],
      interpretation: ['Live synthesis parsing failed; raw swarm data was received'],
      rationale: 'Live synthesis step encountered an error. Raw swarm data was collected from the VPS.',
    };
  }
}

// ── Main run ─────────────────────────────────────────────────────────────────

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext } = ctx;
  const sources: AgentSource[] = [];

  // Step 0: Resolve simulation_id from LIVE map
  const simulationId = getLiveSimulationIdForProduct(product);
  if (!simulationId) {
    return makeEmptyForecast(
      query,
      'No simulation configured — add MIROFISH_LIVE_SIMULATIONS to your env and run the bootstrap script against http://168.144.36.78:5001.',
    );
  }

  // Step 1: Health check — fail fast if VPS is down
  const ready = await isLiveSimulationReady(simulationId).catch(() => false);
  if (!ready) {
    return makeEmptyForecast(
      query,
      `VPS at ${LIVE_BASE_URL} is unreachable or simulation not ready. SSH in and run: docker compose logs -f`,
    );
  }

  // Step 2: Formulate forecast question
  const forecastQuestion = await formulateForecastQuestion(
    query, product, competitor, priorContext,
  ).catch(() => sanitiseInterviewQuestion(query, query));

  // Step 3: Interview live swarm + trend baseline in parallel
  let swarmBundle: { responses: { response: string }[]; totalCount: number };
  let trendSummary = '';

  const [interviewResult, trendsResult] = await Promise.allSettled([
    interviewLiveSwarm(simulationId, forecastQuestion, {
      timeoutSec: getLiveInterviewTimeoutSec(),
      maxAgents: getLiveMaxAgents(),
    }),
    // Keep trends non-blocking and lightweight in strict serial mode.
    searchTrends([product, competitor].filter(Boolean) as string[]),
  ]);

  if (interviewResult.status === 'rejected') {
    return makeEmptyForecast(
      query,
      `Live swarm interviews failed: ${interviewResult.reason instanceof Error ? interviewResult.reason.message : String(interviewResult.reason)}`,
    );
  }

  swarmBundle = interviewResult.value.data;

  sources.push({
    url: interviewResult.value.sourceUrl ?? `${LIVE_BASE_URL}/api/simulation/interview`,
    title: `MiroFish Live VPS — ${swarmBundle.totalCount} real personas polled`,
    timestamp: new Date().toISOString(),
    tool: 'mirofish-live',
  });

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

  if (!swarmBundle.totalCount) {
    return makeEmptyForecast(query, 'Live swarm returned no responses.');
  }

  // Step 4: Synthesise live swarm responses
  const swarmResponseTexts = swarmBundle.responses.map(r => r.response).filter(Boolean);
  const synthesised = await synthesiseForecast({
    forecastQuestion,
    product,
    swarmResponses: swarmResponseTexts,
    swarmSize: swarmBundle.totalCount,
    trendSummary,
    priorContext,
  });

  const [factsEn, interpretationEn, rationaleEn, signalsEn] = await Promise.all([
    Promise.all((synthesised.facts ?? []).map(f => translateToEnglishIfNeeded(f))).then(arr => arr.filter(Boolean) as string[]),
    Promise.all((synthesised.interpretation ?? []).map(i => translateToEnglishIfNeeded(i))).then(arr => arr.filter(Boolean) as string[]),
    translateToEnglishIfNeeded(synthesised.rationale).then(v => v ?? synthesised.rationale),
    Promise.all((synthesised.contributingSignals ?? []).map(async s => ({
      ...s,
      persona: (await translateToEnglishIfNeeded(s.persona)) ?? s.persona,
      excerpt: await translateToEnglishIfNeeded(s.excerpt),
    }))),
  ]);

  return {
    agentId: 'mirofish-live',
    domain: 'mirofish-live',
    artifactType: 'forecast-chart',
    confidence: scoreToLevel(synthesised.confidenceScore),
    confidenceScore: synthesised.confidenceScore,
    facts: factsEn,
    interpretation: interpretationEn,
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
    contributingSignals: signalsEn ?? [],
    rationale: rationaleEn ?? synthesised.rationale,
  } as ForecastOutput;
}

export const mirofishLiveAgent: AgentConfig = {
  id: 'mirofish-live',
  name: 'MiroFish Live (Real VPS)',
  description: 'Live swarm forecasting — interviews real MiroFish personas on the VPS at 168.144.36.78. No synthetic fallback.',
  run,
};
