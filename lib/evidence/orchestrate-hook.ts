import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentContext } from '@/lib/agents/types';
import type { ClassificationResult } from '@/lib/agents/orchestrator';
import { isEvidenceRagEnabled } from './config';
import { retrieveEvidenceWithTimeout } from './retrieve';
import type { EvidenceRetrieveResult } from './types';

export interface EvidenceOrchestrationContext extends EvidenceRetrieveResult {
  enabled: boolean;
}

export async function loadEvidenceForOrchestration(
  supabase: SupabaseClient | undefined,
  params: {
    userId?: string;
    query: string;
    classification: Pick<ClassificationResult, 'product'>;
  },
): Promise<EvidenceOrchestrationContext> {
  const empty: EvidenceOrchestrationContext = {
    enabled: false,
    hits: [],
    contextBlock: '',
  };

  if (!isEvidenceRagEnabled() || !supabase || !params.userId) {
    return empty;
  }

  const result = await retrieveEvidenceWithTimeout(supabase, {
    userId: params.userId,
    query: params.query,
    product: params.classification.product,
  });

  return {
    enabled: true,
    ...result,
  };
}

export function mergeEvidenceIntoAgentContext(
  ctx: AgentContext,
  evidence: EvidenceOrchestrationContext,
): AgentContext {
  if (!evidence.hits.length) return ctx;
  return {
    ...ctx,
    retrievedEvidence: evidence.hits,
  };
}

export function mergeEvidenceIntoSynthesisMemory(
  memoryContext: string | undefined,
  evidence: EvidenceOrchestrationContext,
): string | undefined {
  const parts = [memoryContext, evidence.contextBlock].filter(Boolean);
  return parts.length > 0 ? parts.join('\n\n') : undefined;
}
