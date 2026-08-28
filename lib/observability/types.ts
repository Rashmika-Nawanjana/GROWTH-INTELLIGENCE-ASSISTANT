export type UsageStage =
  | 'classify'
  | 'research-plan'
  | 'agent'
  | 'execution'
  | 'synthesis'
  | 'mind-map'
  | 'mirofish'
  | 'mirofish-live'
  | 'workspace-explain'
  | 'refine'
  | 'steal-strategy'
  | 'embed-api'
  | 'guardrail-judge';

export type EmbeddingPurpose =
  | 'evidence-index'
  | 'evidence-retrieve'
  | 'workspace-index'
  | 'workspace-retrieve'
  | 'memory-recall'
  | 'embed-api'
  | 'unknown';

export type ToolStatus = 'ok' | 'degraded' | 'failed';

export interface StageUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface LlmUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  tokensEstimated: boolean;
  byStage: Partial<Record<UsageStage, StageUsage>>;
}

export interface EmbeddingPurposeUsage {
  calls: number;
  estimatedTokens: number;
  costUsd: number;
}

export interface EmbeddingsUsage {
  calls: number;
  estimatedTokens: number;
  costUsd: number;
  byPurpose: Partial<Record<EmbeddingPurpose, EmbeddingPurposeUsage>>;
}

export interface ProviderToolUsage {
  calls: number;
  ok: number;
  degraded: number;
  failed: number;
  cachedHits: number;
  totalLatencyMs: number;
}

export interface ToolsUsage {
  calls: number;
  byProvider: Record<string, ProviderToolUsage>;
}

export interface TraceInfo {
  id?: string;
  url?: string;
}

export interface UsageBreakdown {
  llm: LlmUsage;
  embeddings: EmbeddingsUsage;
  tools: ToolsUsage;
  trace: TraceInfo;
  totalCostUsd: number;
}

export interface UsageLedgerMeta {
  sessionId?: string;
  userId?: string;
  queryPreview?: string;
  product?: string;
  orchestratorBackend?: string;
}

export interface RecordLlmCallParams {
  stage: UsageStage;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  ok: boolean;
  tokensEstimated?: boolean;
}

export interface RecordEmbeddingCallParams {
  purpose: EmbeddingPurpose;
  model: string;
  charCount: number;
  latencyMs: number;
  ok: boolean;
  estimatedTokens?: number;
}

export interface RecordToolCallParams {
  provider: string;
  operation?: string;
  status: ToolStatus;
  latencyMs?: number;
  cached?: boolean;
}
