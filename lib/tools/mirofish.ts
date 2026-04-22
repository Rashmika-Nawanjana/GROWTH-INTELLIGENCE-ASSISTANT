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
 * Fetch agent IDs from simulation config on the MiroFish backend.
 * Returns up to maxAgents IDs, shuffled for diversity.
 */
async function fetchAgentIds(simulationId: string, maxAgents = 6): Promise<number[]> {
  const res = await fetch(
    `${BASE_URL}/api/simulation/${encodeURIComponent(simulationId)}/config`,
    { signal: AbortSignal.timeout(5_000) },
  );
  if (!res.ok) throw new Error(`Could not fetch sim config: ${res.status}`);
  const json = await res.json() as { data?: { agent_configs?: { agent_id: number }[] } };
  const all = (json.data?.agent_configs ?? []).map(a => a.agent_id);
  // Shuffle and take first maxAgents for diversity
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, maxAgents);
}

/**
 * Interview a single agent via the per-agent endpoint.
 */
async function interviewSingleAgent(
  simulationId: string,
  agentId: number,
  prompt: string,
  platform: 'reddit' | 'twitter',
  timeoutSec: number,
): Promise<SwarmInterviewResponse | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/simulation/interview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ simulation_id: simulationId, agent_id: agentId, prompt, platform, timeout: timeoutSec }),
      signal: AbortSignal.timeout((timeoutSec + 5) * 1_000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { success: boolean; data?: { result?: string; response?: string } };
    if (!json.success) return null;
    const response = json.data?.result ?? json.data?.response ?? '';
    if (!response) return null;
    return { agent_id: agentId, response, platform };
  } catch {
    return null;
  }
}

/**
 * Poll a sample of simulated personas with *prompt* and return their aggregated
 * responses. Interviews agents sequentially (5 per call) to stay within
 * free-tier Gemini rate limits (15 RPM).
 *
 * @param simulationId - ID from MIROFISH_SIMULATIONS map
 * @param prompt       - Forward-looking question (LLM-generated from user query)
 * @param options      - platform: restrict to 'reddit' (default); timeoutSec per agent
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

  // Default to 'reddit' — our production sim is Reddit-only
  const platform = options.platform ?? 'reddit';
  // Per-agent timeout — generous to allow Gemini retries
  const perAgentTimeoutSec = options.timeoutSec ?? 45;

  // Fetch a sample of agent IDs (max 5 to stay within 15 RPM)
  const agentIds = await fetchAgentIds(simulationId, 5);
  if (agentIds.length === 0) throw new Error('No agents found in simulation config');

  const responses: SwarmInterviewResponse[] = [];

  // Interview sequentially with a 5-second gap to avoid rate-limit bursts
  for (const agentId of agentIds) {
    const resp = await interviewSingleAgent(simulationId, agentId, prompt, platform, perAgentTimeoutSec);
    if (resp) responses.push(resp);
    // Brief pause between calls — keeps burst rate well below 15 RPM
    if (agentId !== agentIds[agentIds.length - 1]) {
      await new Promise(r => setTimeout(r, 4_500));
    }
  }

  if (responses.length === 0) {
    throw new Error('All agent interviews failed — check MiroFish logs for rate limit errors');
  }

  const bundle: SwarmInterviewBundle = {
    simulationId,
    prompt,
    responses,
    totalCount: responses.length,
  };

  const confidence = Math.min(0.9, responses.length >= 4 ? 0.72 : responses.length >= 2 ? 0.55 : 0.35);

  const result: ToolResult<SwarmInterviewBundle> = {
    data: bundle,
    source: 'MiroFish Swarm',
    sourceUrl: `${BASE_URL}/api/simulation/interview`,
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
