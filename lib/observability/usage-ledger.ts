import { AsyncLocalStorage } from 'node:async_hooks';
import {
  estimateEmbeddingCostUsd,
  estimateLlmCostUsd,
  estimateTokensFromChars,
} from './pricing';
import type {
  EmbeddingPurpose,
  EmbeddingPurposeUsage,
  ProviderToolUsage,
  RecordEmbeddingCallParams,
  RecordLlmCallParams,
  RecordToolCallParams,
  StageUsage,
  ToolStatus,
  UsageBreakdown,
  UsageLedgerMeta,
  UsageStage,
} from './types';

interface InternalLedger {
  meta: UsageLedgerMeta;
  llmCalls: Record<UsageStage, StageUsage & { tokensEstimated: boolean }>;
  llmCallsTotal: number;
  llmTokensEstimated: boolean;
  embeddings: Partial<Record<EmbeddingPurpose, EmbeddingPurposeUsage>>;
  embeddingCallsTotal: number;
  tools: Record<string, ProviderToolUsage>;
  toolCallsTotal: number;
  traceId?: string;
  traceUrl?: string;
}

const storage = new AsyncLocalStorage<InternalLedger>();

function emptyStageUsage(): StageUsage & { tokensEstimated: boolean } {
  return {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    tokensEstimated: false,
  };
}

function createLedger(meta: UsageLedgerMeta = {}): InternalLedger {
  return {
    meta,
    llmCalls: {} as InternalLedger['llmCalls'],
    llmCallsTotal: 0,
    llmTokensEstimated: false,
    embeddings: {},
    embeddingCallsTotal: 0,
    tools: {},
    toolCallsTotal: 0,
  };
}

function getLedger(): InternalLedger | undefined {
  return storage.getStore();
}

export function runWithUsageLedger<T>(
  meta: UsageLedgerMeta,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  return storage.run(createLedger(meta), fn);
}

export function setUsageTraceInfo(traceId: string, traceUrl?: string): void {
  const ledger = getLedger();
  if (!ledger) return;
  ledger.traceId = traceId;
  ledger.traceUrl = traceUrl;
}

export function getUsageLedgerMeta(): UsageLedgerMeta | undefined {
  return getLedger()?.meta;
}

export function recordLlmCall(params: RecordLlmCallParams): void {
  const ledger = getLedger();
  if (!ledger) return;

  const costUsd = estimateLlmCostUsd(params.model, params.inputTokens, params.outputTokens);
  const stage = params.stage;
  if (!ledger.llmCalls[stage]) {
    ledger.llmCalls[stage] = emptyStageUsage();
  }
  const bucket = ledger.llmCalls[stage];
  bucket.calls += 1;
  bucket.inputTokens += params.inputTokens;
  bucket.outputTokens += params.outputTokens;
  bucket.costUsd = Number.parseFloat((bucket.costUsd + costUsd).toFixed(6));
  if (params.tokensEstimated) {
    bucket.tokensEstimated = true;
    ledger.llmTokensEstimated = true;
  }
  ledger.llmCallsTotal += 1;
}

export function recordEmbeddingCall(params: RecordEmbeddingCallParams): void {
  const ledger = getLedger();
  if (!ledger) return;

  const estimatedTokens =
    params.estimatedTokens ?? estimateTokensFromChars(params.charCount);
  const costUsd = estimateEmbeddingCostUsd(estimatedTokens);
  const purpose = params.purpose;

  if (!ledger.embeddings[purpose]) {
    ledger.embeddings[purpose] = { calls: 0, estimatedTokens: 0, costUsd: 0 };
  }
  const bucket = ledger.embeddings[purpose]!;
  bucket.calls += 1;
  bucket.estimatedTokens += estimatedTokens;
  bucket.costUsd = Number.parseFloat((bucket.costUsd + costUsd).toFixed(6));
  ledger.embeddingCallsTotal += 1;
}

export function recordToolCall(params: RecordToolCallParams): void {
  const ledger = getLedger();
  if (!ledger) return;

  const provider = params.provider || 'unknown';
  if (!ledger.tools[provider]) {
    ledger.tools[provider] = {
      calls: 0,
      ok: 0,
      degraded: 0,
      failed: 0,
      cachedHits: 0,
      totalLatencyMs: 0,
    };
  }
  const bucket = ledger.tools[provider];
  bucket.calls += 1;
  incrementStatus(bucket, params.status);
  if (params.cached) bucket.cachedHits += 1;
  if (typeof params.latencyMs === 'number') {
    bucket.totalLatencyMs += params.latencyMs;
  }
  ledger.toolCallsTotal += 1;
}

function incrementStatus(bucket: ProviderToolUsage, status: ToolStatus): void {
  if (status === 'ok') bucket.ok += 1;
  else if (status === 'degraded') bucket.degraded += 1;
  else bucket.failed += 1;
}

/** Map tool `source` strings to stable provider keys for the usage panel. */
export function normalizeToolProvider(source: string): string {
  const s = source.toLowerCase();
  if (s.includes('searxng')) return 'searxng';
  if (s.includes('serpapi') || s.includes('google')) return 'serpapi';
  if (s.includes('firecrawl')) return 'firecrawl';
  if (s.includes('playwright')) return 'playwright';
  if (s.includes('scrape.do') || s.includes('scrapedo')) return 'scrape-do';
  if (s.includes('reddit')) return 'reddit';
  if (s.includes('hacker news') || s.includes('hn ') || s === 'hn') return 'hn';
  if (s.includes('apify') || s.includes('twitter') || s.includes('x.com')) return 'apify';
  if (s.includes('meta') || s.includes('facebook')) return 'meta-ads';
  if (s.includes('linkedin')) return 'linkedin-ads';
  if (s.includes('patent')) return 'patents';
  if (s.includes('mirofish')) return 'mirofish';
  return source.split(/[\s(/]/)[0]?.toLowerCase() || 'unknown';
}

export function snapshotUsage(): UsageBreakdown {
  const ledger = getLedger();
  if (!ledger) {
    return emptyUsageBreakdown();
  }

  let llmInputTokens = 0;
  let llmOutputTokens = 0;
  let llmCostUsd = 0;
  const byStage: UsageBreakdown['llm']['byStage'] = {};

  for (const [stage, data] of Object.entries(ledger.llmCalls) as [UsageStage, StageUsage][]) {
    llmInputTokens += data.inputTokens;
    llmOutputTokens += data.outputTokens;
    llmCostUsd += data.costUsd;
    byStage[stage] = {
      calls: data.calls,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      costUsd: data.costUsd,
    };
  }

  let embedTokens = 0;
  let embedCostUsd = 0;
  const byPurpose: UsageBreakdown['embeddings']['byPurpose'] = {};
  for (const [purpose, data] of Object.entries(ledger.embeddings) as [
    EmbeddingPurpose,
    EmbeddingPurposeUsage,
  ][]) {
    embedTokens += data.estimatedTokens;
    embedCostUsd += data.costUsd;
    byPurpose[purpose] = { ...data };
  }

  const totalCostUsd = Number.parseFloat(
    (llmCostUsd + embedCostUsd).toFixed(6),
  );

  return {
    llm: {
      calls: ledger.llmCallsTotal,
      inputTokens: llmInputTokens,
      outputTokens: llmOutputTokens,
      costUsd: Number.parseFloat(llmCostUsd.toFixed(6)),
      tokensEstimated: ledger.llmTokensEstimated,
      byStage,
    },
    embeddings: {
      calls: ledger.embeddingCallsTotal,
      estimatedTokens: embedTokens,
      costUsd: Number.parseFloat(embedCostUsd.toFixed(6)),
      byPurpose,
    },
    tools: {
      calls: ledger.toolCallsTotal,
      byProvider: { ...ledger.tools },
    },
    trace: {
      id: ledger.traceId,
      url: ledger.traceUrl,
    },
    totalCostUsd,
  };
}

export function emptyUsageBreakdown(): UsageBreakdown {
  return {
    llm: {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      tokensEstimated: false,
      byStage: {},
    },
    embeddings: {
      calls: 0,
      estimatedTokens: 0,
      costUsd: 0,
      byPurpose: {},
    },
    tools: { calls: 0, byProvider: {} },
    trace: {},
    totalCostUsd: 0,
  };
}

/** Live counters for streaming UI — safe to call without a ledger. */
export function getLiveLedgerCounts(): {
  geminiCallCount: number;
  toolCallCount: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
} {
  const u = snapshotUsage();
  return {
    geminiCallCount: u.llm.calls,
    toolCallCount: u.tools.calls,
    inputTokens: u.llm.inputTokens,
    outputTokens: u.llm.outputTokens,
    estimatedCostUsd: u.totalCostUsd,
  };
}
