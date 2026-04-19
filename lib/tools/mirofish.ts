/**
 * MiroFish swarm-simulation tool
 *
 * MiroFish (https://github.com/666ghj/MiroFish) is a self-hosted swarm
 * intelligence prediction engine.  It runs a Flask backend on port 5001.
 *
 * This adapter only calls the *fast* `/api/simulation/interview/all` endpoint
 * against a **pre-prepared** simulation.  The slow multi-step setup pipeline
 * (graph build → simulation create/prepare/start) is handled once out-of-band
 * by scripts/mirofish-bootstrap.ts — not at query time.
 *
 * Configuration (add to .env.local):
 *   MIROFISH_BASE_URL=http://localhost:5001          # where your MiroFish backend is
 *   MIROFISH_SIMULATIONS={"vector agents":"sim_xxx"} # JSON map product→simulation_id
 */

import { getCached, setCache } from '../supabase';
import type { ToolResult } from './types';

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = (process.env.MIROFISH_BASE_URL ?? 'http://localhost:5001').replace(/\/$/, '');

let SIMULATIONS_MAP: Record<string, string> = {};
try {
  SIMULATIONS_MAP = JSON.parse(process.env.MIROFISH_SIMULATIONS ?? '{}');
} catch {
  // malformed JSON — silently fall back to empty map
}

// Cache swarm interview responses for 1 hour (forecasts are stable short-term)
const CACHE_TTL_MS = 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SwarmInterviewResponse {
  agent_id: number;
  response: string;
  platform: 'twitter' | 'reddit';
  /** Optional persona metadata when returned by MiroFish */
  persona?: { name?: string; role?: string; sentiment?: string };
}

export interface SwarmInterviewBundle {
  simulationId: string;
  prompt: string;
  responses: SwarmInterviewResponse[];
  totalCount: number;
}

// ── Exported helpers ──────────────────────────────────────────────────────────

/**
 * Look up the simulation_id for a product (case-insensitive, fuzzy).
 *
 * Resolution order:
 * 1. Exact lowercase match  ("vector agents" → "sim_xxx")
 * 2. Partial/contains match — the configured key is a substring of the
 *    product string, or vice-versa.  Handles Gemini returning "Vector Agents
 *    (Lilian)", "Lilian by Vector Agents", "the product", etc.
 * 3. First configured simulation (catch-all when only one sim exists).
 *
 * Returns undefined only when SIMULATIONS_MAP is empty.
 */
export function getSimulationIdForProduct(product: string): string | undefined {
  if (!product) return undefined;

  const keys = Object.keys(SIMULATIONS_MAP);
  if (keys.length === 0) return undefined;

  const needle = product.toLowerCase().trim();

  // 1. Exact match
  if (SIMULATIONS_MAP[needle]) return SIMULATIONS_MAP[needle];

  // 2. Fuzzy: key is substring of needle, or needle is substring of key
  const fuzzy = keys.find(k => needle.includes(k) || k.includes(needle));
  if (fuzzy) return SIMULATIONS_MAP[fuzzy];

  // 3. Single-sim fallback — if there's only one bootstrapped sim, use it
  if (keys.length === 1) return SIMULATIONS_MAP[keys[0]];

  return undefined;
}

/**
 * Health-check: is the simulation in a state that accepts /interview requests?
 * Times out after 5 s so a dead backend can't stall the orchestrator.
 */
export async function isSimulationReady(simulationId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/simulation/${encodeURIComponent(simulationId)}/run-status`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const json = await res.json() as { data?: { status?: string }; status?: string };
    const status = json?.data?.status ?? json?.status ?? '';
    // Accept 'completed', 'waiting_command', 'finished', 'running' — anything
    // that means the simulation env is alive and agents can be interviewed
    return ['completed', 'waiting_command', 'finished', 'running'].includes(status);
  } catch {
    return false;
  }
}

/**
 * Poll all simulated personas with *prompt* and return their aggregated
 * responses.  This is the only MiroFish endpoint called at query-time.
 *
 * @param simulationId - ID from MIROFISH_SIMULATIONS map
 * @param prompt       - Forward-looking question (LLM-generated from user query)
 * @param options      - platform: restrict to 'twitter' or 'reddit'; timeoutSec default 120
 */
export async function interviewSwarm(
  simulationId: string,
  prompt: string,
  options: { platform?: 'twitter' | 'reddit'; timeoutSec?: number } = {},
): Promise<ToolResult<SwarmInterviewBundle>> {
  const cacheKey = `mirofish:interview:${simulationId}:${prompt}`;

  // Check cache first
  try {
    const cached = await getCached('mirofish_interview', cacheKey);
    if (cached) {
      return { ...(cached as ToolResult<SwarmInterviewBundle>), cached: true };
    }
  } catch {
    // cache miss is fine — continue
  }

  const timeoutSec = options.timeoutSec ?? 120;

  const res = await fetch(`${BASE_URL}/api/simulation/interview/all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      simulation_id: simulationId,
      prompt,
      ...(options.platform ? { platform: options.platform } : {}),
      timeout: timeoutSec,
    }),
    signal: AbortSignal.timeout(timeoutSec * 1_000 + 10_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`MiroFish interview ${res.status}: ${body}`);
  }

  const raw = await res.json() as {
    success: boolean;
    error?: string;
    data?: {
      result?: {
        results?: Record<string, { agent_id: number; response: string; platform: string }>;
        interviews_count?: number;
      };
      results?: Record<string, { agent_id: number; response: string; platform: string }>;
    };
  };

  if (!raw.success) {
    throw new Error(`MiroFish API error: ${raw.error ?? 'unknown'}`);
  }

  // Normalise response — /interview/all returns
  // { data: { result: { results: { "twitter_0": {...}, "reddit_0": {...} } } } }
  const resultsObj =
    raw.data?.result?.results ??
    raw.data?.results ??
    {};

  const responses: SwarmInterviewResponse[] = Object.entries(resultsObj).map(
    ([key, val]) => ({
      agent_id: val.agent_id,
      response: val.response ?? '',
      platform: (val.platform as 'twitter' | 'reddit') ??
        (key.startsWith('twitter') ? 'twitter' : 'reddit'),
    }),
  );

  const bundle: SwarmInterviewBundle = {
    simulationId,
    prompt,
    responses,
    totalCount: responses.length,
  };

  // Confidence grows with swarm size (capped at 0.9)
  const confidence = Math.min(
    0.9,
    responses.length > 50 ? 0.85 :
    responses.length > 20 ? 0.70 :
    responses.length > 5  ? 0.55 : 0.30,
  );

  const result: ToolResult<SwarmInterviewBundle> = {
    data: bundle,
    source: 'MiroFish Swarm',
    sourceUrl: `${BASE_URL}/api/simulation/interview/all`,
    timestamp: new Date().toISOString(),
    confidence,
    cached: false,
  };

  // Cache result
  try {
    await setCache('mirofish_interview', cacheKey, result);
  } catch {
    // non-fatal
  }

  return result;
}
