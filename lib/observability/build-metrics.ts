import type { RunMetrics } from '@/lib/agents/types';
import { snapshotUsage } from './usage-ledger';
import type { UsageBreakdown } from './types';

export function enrichRunMetrics(base: RunMetrics): RunMetrics {
  const usage = snapshotUsage();
  const hasLedgerData = usage.llm.calls > 0 || usage.tools.calls > 0 || usage.embeddings.calls > 0;

  if (!hasLedgerData) {
    return {
      ...base,
      costBasis: 'estimated',
      actualCostUsd: base.estimatedCostUsd,
    };
  }

  const measuredTokens = usage.llm.calls > 0 && !usage.llm.tokensEstimated;
  const costBasis = measuredTokens || usage.totalCostUsd > 0 ? 'measured' : 'estimated';
  const actualCostUsd =
    usage.totalCostUsd > 0 ? usage.totalCostUsd : base.estimatedCostUsd;

  return {
    ...base,
    estimatedCostUsd: Number.parseFloat(actualCostUsd.toFixed(6)),
    actualCostUsd: Number.parseFloat(actualCostUsd.toFixed(6)),
    costBasis,
    inputTokens: usage.llm.inputTokens,
    outputTokens: usage.llm.outputTokens,
    geminiCallCount: usage.llm.calls > 0 ? usage.llm.calls : base.geminiCallCount,
    toolCallCount: usage.tools.calls > 0 ? usage.tools.calls : base.toolCallCount,
    usage,
    traceId: usage.trace.id,
    traceUrl: usage.trace.url,
  };
}

export function mergeMetricsUpdate(
  existing: RunMetrics | undefined,
  update: RunMetrics,
): RunMetrics {
  if (!existing) return update;
  const usage = mergeUsageBreakdown(existing.usage, update.usage);
  return {
    ...existing,
    ...update,
    totalLatencyMs: Math.max(existing.totalLatencyMs, update.totalLatencyMs),
    agentLatencies: { ...existing.agentLatencies, ...update.agentLatencies },
    geminiCallCount: update.geminiCallCount,
    toolCallCount: update.toolCallCount,
    estimatedCostUsd: update.estimatedCostUsd,
    actualCostUsd: update.actualCostUsd ?? update.estimatedCostUsd,
    inputTokens: update.inputTokens,
    outputTokens: update.outputTokens,
    usage,
    traceId: update.traceId ?? existing.traceId,
    traceUrl: update.traceUrl ?? existing.traceUrl,
  };
}

function mergeUsageBreakdown(
  a?: UsageBreakdown,
  b?: UsageBreakdown,
): UsageBreakdown | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    llm: {
      calls: b.llm.calls,
      inputTokens: b.llm.inputTokens,
      outputTokens: b.llm.outputTokens,
      costUsd: b.llm.costUsd,
      tokensEstimated: b.llm.tokensEstimated,
      byStage: { ...a.llm.byStage, ...b.llm.byStage },
    },
    embeddings: {
      calls: b.embeddings.calls,
      estimatedTokens: b.embeddings.estimatedTokens,
      costUsd: b.embeddings.costUsd,
      byPurpose: { ...a.embeddings.byPurpose, ...b.embeddings.byPurpose },
    },
    tools: {
      calls: b.tools.calls,
      byProvider: { ...a.tools.byProvider, ...b.tools.byProvider },
    },
    trace: b.trace.id ? b.trace : a.trace,
    totalCostUsd: b.totalCostUsd,
  };
}
