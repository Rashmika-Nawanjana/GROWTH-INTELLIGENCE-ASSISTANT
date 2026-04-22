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
const LIVE_STRICT_SERIAL_MODE = (process.env.MIROFISH_LIVE_STRICT_SERIAL_MODE ?? '1') !== '0';

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

function trimInterviewPrompt(prompt: string, maxChars: number): string {
  const cleaned = prompt
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxChars - 3)).trim()}...`;
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
): Promise<{ response: SwarmInterviewResponse | null; error?: string }> {
  try {
    const safePrompt = trimInterviewPrompt(prompt, 240);
    const res = await fetch(`${LIVE_BASE_URL}/api/simulation/interview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        simulation_id: simulationId,
        agent_id: agentId,
        prompt: safePrompt || prompt.slice(0, 240),
        platform,
        timeout: timeoutSec,
      }),
      signal: AbortSignal.timeout((timeoutSec + 5) * 1_000),
    });
    if (!res.ok) return { response: null, error: `HTTP ${res.status}` };
    const json = await res.json() as {
      success: boolean;
      error?: string;
      data?: { result?: string; response?: string; error?: string; success?: boolean };
    };
    if (!json.success) {
      const err = json.data?.error ?? json.error ?? 'unknown interview failure';
      return { response: null, error: String(err) };
    }
    const response = json.data?.result ?? json.data?.response ?? '';
    if (!response) {
      const err = json.data?.error ?? 'empty interview response';
      return { response: null, error: String(err) };
    }
    return { response: { agent_id: agentId, response, platform } };
  } catch {
    return { response: null, error: 'request timeout or network error' };
  }
}

/**
 * Poll a sample of live personas. Only uses real VPS — never synthetic.
 * Throws if the backend is down or all interviews fail.
 */
export async function interviewLiveSwarm(
  simulationId: string,
  prompt: string,
  options: { platform?: 'twitter' | 'reddit'; timeoutSec?: number; maxAgents?: number } = {},
): Promise<ToolResult<SwarmInterviewBundle>> {
  const cacheKey = `mirofish-live:interview:${simulationId}:${prompt}`;

  try {
    const cached = await getCached('mirofish_interview', cacheKey);
    if (cached) return { ...(cached as ToolResult<SwarmInterviewBundle>), cached: true };
  } catch {
    // cache miss — continue
  }

  const platform = options.platform ?? 'reddit';
  const perAgentTimeoutSec = options.timeoutSec ?? 30;
  const desiredMaxAgents = LIVE_STRICT_SERIAL_MODE
    ? 1
    : (options.maxAgents ?? 3);

  const allAgentIds = await fetchLiveAgentIds(simulationId, Math.max(5, desiredMaxAgents));
  if (allAgentIds.length === 0) throw new Error('No agents found in live simulation config');

  const retryPlan = LIVE_STRICT_SERIAL_MODE
    ? [
        { maxPromptChars: 90, maxAgents: 1 },
        { maxPromptChars: 60, maxAgents: 1 },
      ]
    : [
        { maxPromptChars: 220, maxAgents: Math.min(desiredMaxAgents, allAgentIds.length) },
        { maxPromptChars: 140, maxAgents: Math.min(2, allAgentIds.length) },
        { maxPromptChars: 90, maxAgents: 1 },
      ];

  let lastError = '';
  let bestResponses: SwarmInterviewResponse[] = [];

  for (let tier = 0; tier < retryPlan.length; tier++) {
    const plan = retryPlan[tier];
    const tierPrompt = trimInterviewPrompt(prompt, plan.maxPromptChars);
    const tierAgentIds = allAgentIds.slice(0, Math.max(1, plan.maxAgents));
    const responses: SwarmInterviewResponse[] = [];
    let firstError: string | undefined;

    for (const agentId of tierAgentIds) {
      const attempt = await interviewLiveAgent(simulationId, agentId, tierPrompt, platform, perAgentTimeoutSec);
      if (attempt.response) responses.push(attempt.response);
      if (!attempt.response && attempt.error && !firstError) firstError = attempt.error;
      if (agentId !== tierAgentIds[tierAgentIds.length - 1]) {
        await new Promise(r => setTimeout(r, 2_500));
      }
    }

    if (responses.length > bestResponses.length) bestResponses = responses;
    if (responses.length > 0) {
      const bundle: SwarmInterviewBundle = {
        simulationId,
        prompt: tierPrompt,
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

    lastError = firstError ?? 'unknown interview failure';
    const rateLimited =
      /rate_limit_exceeded|Request too large|TPM|tokens per minute|413/i.test(lastError);
    if (!rateLimited || tier === retryPlan.length - 1) {
      break;
    }
  }

  if (bestResponses.length > 0) {
    const bundle: SwarmInterviewBundle = {
      simulationId,
      prompt: trimInterviewPrompt(prompt, 140),
      responses: bestResponses,
      totalCount: bestResponses.length,
    };
    return {
      data: bundle,
      source: 'MiroFish Live VPS',
      sourceUrl: `${LIVE_BASE_URL}/api/simulation/interview`,
      timestamp: new Date().toISOString(),
      confidence: 0.38,
      cached: false,
    };
  }

  throw new Error(
    `All live-agent interviews failed${lastError ? `: ${lastError}` : ''} — check VPS logs (docker compose logs -f)`
  );
}

export { LIVE_BASE_URL };
