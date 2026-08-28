import { END, START, StateGraph } from '@langchain/langgraph';
import {
  createClassifyNode,
  createDiscoverNode,
  createExecutionNode,
  createFinalizeNode,
  createResearchFanOutNode,
} from './nodes';
import { OrchestratorState, type OrchestratorCallbacks } from './state';

/**
 * Build the orchestration graph. Discover runs after classify; research fan-out
 * stays one node with Promise.allSettled so failure semantics match legacy.
 */
export function buildOrchestratorGraph(callbacks: OrchestratorCallbacks = {}) {
  const graph = new StateGraph(OrchestratorState)
    .addNode('classify', createClassifyNode(callbacks))
    .addNode('discover', createDiscoverNode(callbacks))
    .addNode('researchFanOut', createResearchFanOutNode(callbacks))
    .addNode('execution', createExecutionNode(callbacks))
    .addNode('finalize', createFinalizeNode(callbacks))
    .addEdge(START, 'classify')
    .addEdge('classify', 'discover')
    .addEdge('discover', 'researchFanOut')
    .addEdge('researchFanOut', 'execution')
    .addEdge('execution', 'finalize')
    .addEdge('finalize', END);

  return graph.compile();
}
