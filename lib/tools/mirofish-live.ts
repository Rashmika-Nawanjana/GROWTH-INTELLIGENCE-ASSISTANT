/**
 * MiroFish Live tool adapter
 *
 * Connects ONLY to the real MiroFish VPS at MIROFISH_LIVE_BASE_URL
 * (default: http://168.144.36.78:5001). No synthetic fallback — if the
 * backend is unreachable this throws so the caller can surface a clear
 * "MiroFish Live unavailable" message.
 *
 * Configuration (.env.local):
 *   MIROFISH_LIVE_BASE_URL=http://168.144.36.78:5001
 *   MIROFISH_LIVE_SIMULATIONS={"vector agents":"sim_xxx"}
 */

import { getCached, setCache } from '../supabase';
import type { ToolResult } from './types';
import type { SwarmInterviewBundle, SwarmInterviewResponse } from './mirofish';

// ── Config ─────────────────────────────────────────────────────────────────────
const LIVE_BASE_URL = (
  process.env.MIROFISH_LIVE_BASE_URL ?? 'http://168.144.36.78:5001'
).replace(/\/$/, '');

function parseLiveSimulations(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const candidates = [trimmed];
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    candidates.push(trimmed.slice(1, -1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'string' && k.trim()) out[k.toLowerCase().trim()] = v;
        }
        return out;
      }
    } catch {
      // try next candidate
    }
  }
  return {};
}

const LIVE_SIMULATIONS_MAP: Record<string, string> = parseLiveSimulations(
  process.env.MIROFISH_LIVE_SIMULATIONS
);
const LIVE_DEFAULT_SIM_ID = process.env.MIROFISH_LIVE_DEFAULT_SIMULATION_ID?.trim();

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Resolve simulation_id for a product using the LIVE simulations map.
 * Resolution order: exact → fuzzy substring → single-sim catch-all.
 */
export function getLiveSimulationIdForProduct(product: string): string | undefined {
  const keys = Object.keys(LIVE_SIMULATIONS_MAP);
  if (keys.length === 0) return LIVE_DEFAULT_SIM_ID;

  const needle = product?.toLowerCase().trim();
  if (!needle) {
    if (LIVE_DEFAULT_SIM_ID) return LIVE_DEFAULT_SIM_ID;
    return keys.length ? LIVE_SIMULATIONS_MAP[keys[0]] : undefined;
  }

  if (LIVE_SIMULATIONS_MAP[needle]) return LIVE_SIMULATIONS_MAP[needle];
  const fuzzy = keys.find(k => needle.includes(k) || k.includes(needle));
  if (fuzzy) return LIVE_SIMULATIONS_MAP[fuzzy];

  // If multiple aliases map to the same simulation, use it as a safe fallback.
  const uniqueIds = Array.from(new Set(Object.values(LIVE_SIMULATIONS_MAP).filter(Boolean)));
  if (uniqueIds.length === 1) return uniqueIds[0];
  if (LIVE_DEFAULT_SIM_ID) return LIVE_DEFAULT_SIM_ID;
  return keys.length ? LIVE_SIMULATIONS_MAP[keys[0]] : undefined;
}

/**
 * Health-check the live VPS simulation (5 s timeout).
 */
export async function isLiveSimulationReady(simulationId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${LIVE_BASE_URL}/api/simulation/${encodeURIComponent(simulationId)}/run-status`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return false;
    const json = await res.json() as { data?: { status?: string; runner_status?: string }; status?: string };
    const status = json?.data?.status ?? json?.data?.runner_status ?? json?.status ?? '';
    return ['completed', 'waiting_command', 'finished', 'running'].includes(status);
  } catch {
    return false;
  }
}

/**
 * Fetch agent IDs from the live VPS simulation config.
 */
async function fetchLiveAgentIds(simulationId: string, maxAgents = 6): Promise<number[]> {
  const res = await fetch(
    `${LIVE_BASE_URL}/api/simulation/${encodeURIComponent(simulationId)}/config`,
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!res.ok) throw new Error(`Live VPS config fetch failed: HTTP ${res.status}`);
  const json = await res.json() as { data?: { agent_configs?: { agent_id: number }[] } };
  const all = (json.data?.agent_configs ?? []).map(a => a.agent_id);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, maxAgents);
}

/**
 * Interview a single agent on the live VPS.
 */
async function interviewLiveAgent(
  simulationId: string,
  agentId: number,
  prompt: string,
  platform: 'reddit' | 'twitter',
  timeoutSec: number,
): Promise<SwarmInterviewResponse | null> {
  try {
    const res = await fetch(`${LIVE_BASE_URL}/api/simulation/interview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        simulation_id: simulationId,
        agent_id: agentId,
        prompt,
        platform,
        timeout: timeoutSec,
      }),
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
 * Poll a sample of live personas. Only uses real VPS — never synthetic.
 * Throws if the backend is down or all interviews fail.
 */
export async function interviewLiveSwarm(
  simulationId: string,
  prompt: string,
  options: { platform?: 'twitter' | 'reddit'; timeoutSec?: number } = {},
): Promise<ToolResult<SwarmInterviewBundle>> {
  const cacheKey = `mirofish-live:interview:${simulationId}:${prompt}`;

  try {
    const cached = await getCached('mirofish_interview', cacheKey);
    if (cached) return { ...(cached as ToolResult<SwarmInterviewBundle>), cached: true };
  } catch {
    // cache miss — continue
  }

  const platform = options.platform ?? 'reddit';
  const perAgentTimeoutSec = options.timeoutSec ?? 50;

  const agentIds = await fetchLiveAgentIds(simulationId, 5);
  if (agentIds.length === 0) throw new Error('No agents found in live simulation config');

  const responses: SwarmInterviewResponse[] = [];

  for (const agentId of agentIds) {
    const resp = await interviewLiveAgent(simulationId, agentId, prompt, platform, perAgentTimeoutSec);
    if (resp) responses.push(resp);
    if (agentId !== agentIds[agentIds.length - 1]) {
      await new Promise(r => setTimeout(r, 4_500));
    }
  }

  if (responses.length === 0) {
    throw new Error('All live-agent interviews failed — check VPS logs (docker compose logs -f)');
  }

  const bundle: SwarmInterviewBundle = {
    simulationId,
    prompt,
    responses,
    totalCount: responses.length,
  };

  const confidence = Math.min(0.9, responses.length >= 4 ? 0.78 : responses.length >= 2 ? 0.58 : 0.38);

  const result: ToolResult<SwarmInterviewBundle> = {
    data: bundle,
    source: 'MiroFish Live VPS',
    sourceUrl: `${LIVE_BASE_URL}/api/simulation/interview`,
    timestamp: new Date().toISOString(),
    confidence,
    cached: false,
  };

  try {
    await setCache('mirofish_interview', cacheKey, result);
  } catch { /* non-fatal */ }

  return result;
}

export { LIVE_BASE_URL };
