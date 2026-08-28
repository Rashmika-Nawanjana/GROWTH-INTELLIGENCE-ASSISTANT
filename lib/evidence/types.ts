import type { IntelligenceDomain, RetrievedEvidenceHit } from '@/lib/agents/types';
import type { ClassificationResult } from '@/lib/agents/orchestrator';

export interface EvidenceChunkDraft {
  kind: 'page' | 'fact';
  chunkIndex: number;
  content: string;
}

export interface EvidenceDocumentDraft {
  url: string;
  title?: string;
  sourceTool: string;
  domain?: IntelligenceDomain | string;
  product?: string;
  category?: string;
  geography?: string;
  contentHash: string;
  fetchedAt: string;
  chunks: EvidenceChunkDraft[];
}

export interface EvidenceRetrieveResult {
  hits: RetrievedEvidenceHit[];
  contextBlock: string;
}

export interface IndexRunEvidenceInput {
  userId: string;
  outputs: import('@/lib/agents/types').AgentOutput[];
  classification: Pick<
    ClassificationResult,
    'product' | 'category' | 'geography'
  >;
}

export type { RetrievedEvidenceHit };
