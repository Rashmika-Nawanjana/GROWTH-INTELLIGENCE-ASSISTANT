import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AgentRun,
  ConversationMessage,
  ImageAttachment,
  OrchestratorOutput,
} from './types';
import { orchestrate, type OrchestrateOptions } from './orchestrator';
import {
  getOrchestratorBackend,
  type OrchestratorBackend,
} from './orchestrator-backend';

export type { OrchestratorBackend };
export { getOrchestratorBackend };

/**
 * Single entry for chat + refine. Defaults to legacy orchestrator.
 * LangGraph is loaded dynamically so the default path stays lean.
 */
export async function runOrchestration(
  query: string,
  history: ConversationMessage[],
  onAgentUpdate?: (run: AgentRun) => void,
  images: ImageAttachment[] = [],
  memoryContext?: string,
  options?: OrchestrateOptions,
  supabase?: SupabaseClient,
): Promise<OrchestratorOutput> {
  if (getOrchestratorBackend() === 'langgraph') {
    const { orchestrateLangGraph } = await import('./langgraph/orchestrate');
    return orchestrateLangGraph(
      query,
      history,
      onAgentUpdate,
      images,
      memoryContext,
      options,
      supabase,
    );
  }

  return orchestrate(query, history, onAgentUpdate, images, memoryContext, options, supabase);
}

// Re-export MiroFish runners from the legacy module so routes can import one place.
export { runMirofishAgent, runMirofishLiveAgent } from './orchestrator';
