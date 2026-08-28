import type {
  AgentRun,
  ConversationMessage,
  ImageAttachment,
  OrchestratorOutput,
} from '../types';
import type { OrchestrateOptions } from '../orchestrator';
import { buildOrchestratorGraph } from './graph';

/**
 * LangGraph-backed orchestrator with the same signature as legacy `orchestrate`.
 */
export async function orchestrateLangGraph(
  query: string,
  history: ConversationMessage[],
  onAgentUpdate?: (run: AgentRun) => void,
  images: ImageAttachment[] = [],
  memoryContext?: string,
  options?: OrchestrateOptions,
): Promise<OrchestratorOutput> {
  const graph = buildOrchestratorGraph({
    onAgentUpdate,
    onOrchestrationLog: options?.onOrchestrationLog,
  });

  // LangSmith auto-traces when LANGCHAIN_TRACING_V2=true + LANGCHAIN_API_KEY.
  // Tags/metadata only attach when tracing is on; safe no-op otherwise.
  const tracingEnabled = process.env.LANGCHAIN_TRACING_V2 === 'true';
  const finalState = await graph.invoke(
    {
      query,
      history,
      images,
      memoryContext,
      options,
      orchestrationStart: Date.now(),
    },
    tracingEnabled
      ? {
          runName: 'orchestrateLangGraph',
          tags: ['orchestrator', 'langgraph'],
          metadata: {
            queryPreview: query.slice(0, 120),
            historyLength: history.length,
            hasImages: images.length > 0,
            hasMemory: Boolean(memoryContext),
          },
        }
      : undefined,
  );

  if (!finalState.result) {
    throw new Error('LangGraph orchestration completed without a result payload');
  }

  return finalState.result;
}
