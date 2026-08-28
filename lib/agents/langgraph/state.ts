import { Annotation } from '@langchain/langgraph';
import type {
  AgentContext,
  AgentOutput,
  AgentRun,
  ConversationMessage,
  ImageAttachment,
  OrchestratorOutput,
  Recommendation,
  RetrievedEvidenceHit,
} from '../types';
import type { ClassificationResult, OrchestrateOptions } from '../orchestrator';
import type { ResearchPlan } from '../research-plan';

/**
 * LangGraph orchestration state. Callbacks live in a closure (not in state)
 * so they stay non-serializable and in-process only.
 */
export const OrchestratorState = Annotation.Root({
  query: Annotation<string>,
  history: Annotation<ConversationMessage[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  images: Annotation<ImageAttachment[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  memoryContext: Annotation<string | undefined>,
  options: Annotation<OrchestrateOptions | undefined>,
  classification: Annotation<ClassificationResult | undefined>,
  agentContext: Annotation<AgentContext | undefined>,
  researchPlan: Annotation<ResearchPlan | undefined>,
  agentsToRunIds: Annotation<string[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  shouldRunExecution: Annotation<boolean>({
    reducer: (_left, right) => right ?? false,
    default: () => false,
  }),
  synthesisMemoryContext: Annotation<string | undefined>,
  retrievedEvidence: Annotation<RetrievedEvidenceHit[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  agentRuns: Annotation<AgentRun[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  outputs: Annotation<AgentOutput[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  agentLatencies: Annotation<Record<string, number>>({
    reducer: (_left, right) => right ?? {},
    default: () => ({}),
  }),
  modelCallCount: Annotation<number>({
    reducer: (_left, right) => right ?? 0,
    default: () => 0,
  }),
  skippedLlmCount: Annotation<number>({
    reducer: (_left, right) => right ?? 0,
    default: () => 0,
  }),
  synthesizedAnswer: Annotation<string>({
    reducer: (_left, right) => right ?? '',
    default: () => '',
  }),
  recommendations: Annotation<Recommendation[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  followUps: Annotation<string[]>({
    reducer: (_left, right) => right ?? [],
    default: () => [],
  }),
  orchestrationStart: Annotation<number>,
  result: Annotation<OrchestratorOutput | undefined>,
});

export type OrchestratorStateType = typeof OrchestratorState.State;

export type OrchestratorCallbacks = {
  onAgentUpdate?: (run: AgentRun) => void;
  onOrchestrationLog?: (message: string) => void;
};
