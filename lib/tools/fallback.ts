// Shared tool-fallback utilities.
//
// Every tool in this project can operate in three modes:
//   ok        — primary API returned real data
//   degraded  — a fallback path was used (HN instead of Reddit, raw HTML
//               scrape instead of Firecrawl, browser scrape instead of the
//               official Meta Ads API, etc.)
//   failed    — both the primary and fallback paths returned nothing
//
// Before this module, each tool picked its own confidence constant and each
// agent computed its final score without reference to tool health. That meant
// an agent whose Reddit call failed and Firecrawl errored out returned the
// same "high confidence" as one with all tools fresh. This utility gives
// agents a uniform way to apply a signal-quality penalty to their Gemini-
// reported score.

import {
  normalizeToolProvider,
  recordToolCall,
} from '@/lib/observability/usage-ledger';
import type { ToolResult, ToolStatus } from './types';

// Canonical confidence anchors per status. Agents never fabricate these —
// every tool writes `status` + `confidence` together through buildToolResult.
const STATUS_CONFIDENCE: Record<ToolStatus, number> = {
  ok: 0.85,
  degraded: 0.55,
  failed: 0.15,
};

/**
 * Build a ToolResult with uniform status + confidence semantics.
 * Callers pass the effective status; confidence is clamped to the anchor
 * unless an override is provided (e.g. a real API reporting cached vs fresh).
 */
export function buildToolResult<T>(params: {
  data: T;
  status: ToolStatus;
  source: string;
  sourceUrl?: string;
  cached?: boolean;
  confidenceOverride?: number;
  latencyMs?: number;
  operation?: string;
}): ToolResult<T> {
  const { data, status, source, sourceUrl, cached = false, confidenceOverride, latencyMs, operation } = params;
  const confidence = typeof confidenceOverride === 'number'
    ? Math.max(0, Math.min(1, confidenceOverride))
    : STATUS_CONFIDENCE[status];

  recordToolCall({
    provider: normalizeToolProvider(source),
    operation,
    status,
    latencyMs,
    cached,
  });

  return {
    data,
    source,
    sourceUrl,
    timestamp: new Date().toISOString(),
    confidence,
    status,
    cached,
  };
}

/**
 * Penalty multiplier for an agent's synthesised confidence score.
 *
 * Inputs: the tool results that actually fed this agent's synthesis +
 * (optional) expected total tool count so missing results count as failures.
 *
 * Returns a multiplier in [0.5, 1.0]:
 *   - 1.0  = every tool call returned fresh, primary data
 *   - ~0.8 = mix of ok + degraded
 *   - ~0.6 = mostly degraded / some failures
 *   - 0.5  = all failed (floor — we never zero out, the agent may still
 *            have useful partial signal)
 */
export function computeSignalQualityPenalty(
  results: ToolResult<unknown>[],
  expectedCount?: number,
): number {
  const totalExpected = Math.max(expectedCount ?? results.length, 1);
  const failureShortfall = Math.max(0, totalExpected - results.length); // tools that threw before returning a ToolResult

  let weight = 0;
  let count = 0;

  for (const r of results) {
    // Derive status if legacy callers didn't set it explicitly.
    const status: ToolStatus =
      r.status
      ?? (r.confidence >= 0.7 ? 'ok' : r.confidence >= 0.3 ? 'degraded' : 'failed');
    weight += STATUS_CONFIDENCE[status];
    count += 1;
  }
  // Each shortfall tool contributes a "failed" weight
  weight += failureShortfall * STATUS_CONFIDENCE.failed;
  count += failureShortfall;

  const avg = count === 0 ? STATUS_CONFIDENCE.failed : weight / count;
  // Map [0.15, 0.85] → [0.5, 1.0] so the best case leaves the Gemini score
  // unchanged and the worst case halves it.
  const normalised = (avg - STATUS_CONFIDENCE.failed) / (STATUS_CONFIDENCE.ok - STATUS_CONFIDENCE.failed);
  const penalty = 0.5 + Math.max(0, Math.min(1, normalised)) * 0.5;
  return Number.parseFloat(penalty.toFixed(3));
}

/**
 * Extract ToolResult values from a batch of Promise.allSettled results.
 * Handles the generic variance issue — callers pass heterogeneous settled
 * arrays (ToolResult<SearchResult[]>, ToolResult<RedditPost[]>, etc.) and
 * this function returns them all as ToolResult<unknown>[].
 */
export function extractToolResults(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  settled: PromiseSettledResult<any>[],
): ToolResult<unknown>[] {
  return settled
    .filter((r): r is PromiseFulfilledResult<ToolResult<unknown>> =>
      r.status === 'fulfilled' && r.value != null && typeof r.value === 'object' && 'confidence' in r.value
    )
    .map(r => r.value);
}

/**
 * Summarise a batch of tool results for logging / observability.
 * Returns a short string like "ok:3 degraded:1 failed:0" so ops panels can
 * show at-a-glance tool health per agent run.
 */
export function summariseToolHealth(results: ToolResult<unknown>[]): string {
  const counts: Record<ToolStatus, number> = { ok: 0, degraded: 0, failed: 0 };
  for (const r of results) {
    const status: ToolStatus =
      r.status
      ?? (r.confidence >= 0.7 ? 'ok' : r.confidence >= 0.3 ? 'degraded' : 'failed');
    counts[status] += 1;
  }
  return `ok:${counts.ok} degraded:${counts.degraded} failed:${counts.failed}`;
}
