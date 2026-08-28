import { filterAndRankSources } from '@/lib/tools/source-validator';
import { executionEngineAgent } from '../execution/execution-engine';
import {
  ALL_AGENTS,
  EST_COST_PER_MODEL_CALL,
  classifyQuery,
  generateMindMap,
  synthesize,
} from '../orchestrator';
import {
  applyPlanToContext,
  buildResearchPlan,
  shouldSkipDomainLlm,
  type ResearchPlan,
} from '../research-plan';
import { insufficientOutput } from '../skipped-output';
import { buildCitationIndex } from '../citations';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  AgentRun,
  ConfidenceLevel,
  EvidenceCandidate,
  IntelligenceDomain,
  RunMetrics,
} from '../types';
import { scoreToLevel } from '../types';
import type { OrchestratorCallbacks, OrchestratorStateType } from './state';

function selectAgentsToRun(
  classification: NonNullable<OrchestratorStateType['classification']>,
  options: OrchestratorStateType['options'],
): AgentConfig[] {
  const allowedAgents = new Set(
    options?.selectedAgents?.length ? options.selectedAgents : ALL_AGENTS.map(a => a.id),
  );
  const classifiedDomains = new Set(classification.domains ?? []);
  const availableResearchAgents = ALL_AGENTS.filter(agent => allowedAgents.has(agent.id));
  const targetedAgents = availableResearchAgents.filter(agent =>
    classifiedDomains.has(agent.id as IntelligenceDomain),
  );
  return options?.followUpMode === 'targeted'
    ? (targetedAgents.length > 0 ? targetedAgents : availableResearchAgents)
    : availableResearchAgents;
}

export function createClassifyNode(callbacks: OrchestratorCallbacks) {
  return async (state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> => {
    callbacks.onOrchestrationLog?.(
      'Reasoning about your query and selecting intelligence domains…',
    );
    const classification = await classifyQuery(
      state.query,
      state.history,
      state.images,
      state.memoryContext,
    );

    const { product, competitor, productUrl, competitorUrl, intent, runExecution } = classification;
    const allowedAgents = new Set(
      state.options?.selectedAgents?.length
        ? state.options.selectedAgents
        : ALL_AGENTS.map(a => a.id),
    );
    const executionEnabled = allowedAgents.has('execution-engine');
    const shouldRunExecution =
      executionEnabled && (runExecution || state.options?.forceExecution === true);

    const priorContext = state.history
      .slice(-4)
      .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.slice(0, 400)}`)
      .join('\n');

    const combinedPriorContext = [priorContext, state.options?.injectedContext]
      .filter(Boolean)
      .join('\n\n');

    const synthesisMemoryContext =
      [state.memoryContext, state.options?.injectedContext].filter(Boolean).join('\n\n') ||
      undefined;

    const agentContext: AgentContext = {
      query: intent,
      product,
      competitor,
      productUrl,
      competitorUrl,
      priorContext: combinedPriorContext || undefined,
      images: state.images.length > 0 ? state.images : undefined,
      memoryContext: state.memoryContext || undefined,
      geography: classification.geography,
      category: classification.category,
      namedEntities: classification.namedEntities,
      requiredTerms: classification.requiredTerms,
    };

    const agentsToRun = selectAgentsToRun(classification, state.options);

    return {
      classification,
      agentContext,
      agentsToRunIds: agentsToRun.map(a => a.id),
      shouldRunExecution,
      synthesisMemoryContext,
      agentRuns: [],
      modelCallCount: 1,
    };
  };
}

/**
 * Shared discovery + research planner before fan-out.
 */
export function createDiscoverNode(callbacks: OrchestratorCallbacks) {
  return async (state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> => {
    const agentContext = state.agentContext;
    if (!agentContext) {
      throw new Error('LangGraph discover node missing agentContext');
    }

    const plannerRun: AgentRun = {
      agentId: 'research-planner',
      name: 'Research Planner',
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    callbacks.onAgentUpdate?.(plannerRun);
    const start = Date.now();

    let plan: ResearchPlan;
    try {
      plan = await buildResearchPlan(agentContext, {
        budgetMs: 12_000,
        onLog: callbacks.onOrchestrationLog,
      });
      plannerRun.status = 'completed';
      plannerRun.completedAt = new Date().toISOString();
    } catch (err) {
      plan = {
        localEntities: [],
        perDomainQueries: {},
        gapQueries: [],
        applicableDomains: [
          'market-trends',
          'competitive',
          'win-loss',
          'pricing',
          'positioning',
          'adjacent',
        ],
        notes: ['Research planner failed; using template queries.'],
        searchedFor: [],
        scrapedCount: 0,
        searchCallCount: 0,
      };
      plannerRun.status = 'failed';
      plannerRun.completedAt = new Date().toISOString();
      plannerRun.error = err instanceof Error ? err.message : String(err);
    }
    callbacks.onAgentUpdate?.(plannerRun);

    const entityNames = plan.localEntities.map(e => e.name);
    const enriched: AgentContext = {
      ...agentContext,
      namedEntities: [...new Set([...(agentContext.namedEntities ?? []), ...entityNames])],
      requiredTerms: [
        ...new Set([
          ...(agentContext.requiredTerms ?? []),
          ...entityNames,
          ...(agentContext.geography?.name ? [agentContext.geography.name] : []),
        ]),
      ],
      discoveredEntities: plan.localEntities,
      gapQueries: plan.gapQueries,
      planNotes: plan.notes,
    };

    const agentsToRun = ALL_AGENTS.filter(a => state.agentsToRunIds.includes(a.id));
    const sweepLabel =
      state.options?.followUpMode === 'targeted' ? 'targeted follow-up' : 'full research sweep';
    callbacks.onOrchestrationLog?.(
      `Dividing work across ${agentsToRun.length} specialist agents (${sweepLabel})…`,
    );
    callbacks.onOrchestrationLog?.(
      'Orchestrating parallel research — search, fetch, and extract…',
    );

    const agentRuns: AgentRun[] = [
      plannerRun,
      ...agentsToRun.map(a => ({
        agentId: a.id,
        name: a.name,
        status: 'pending' as const,
      })),
    ];

    return {
      researchPlan: plan,
      agentContext: enriched,
      agentRuns,
      agentLatencies: { 'research-planner': Date.now() - start },
      modelCallCount: state.modelCallCount + 1,
    };
  };
}

/**
 * Single fan-out node using Promise.allSettled — 1:1 failure parity with legacy orchestrator.
 */
export function createResearchFanOutNode(callbacks: OrchestratorCallbacks) {
  return async (state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> => {
    const agentContext = state.agentContext;
    if (!agentContext) {
      throw new Error('LangGraph research node missing agentContext');
    }

    const plan = state.researchPlan;
    const agentsToRun = ALL_AGENTS.filter(a => state.agentsToRunIds.includes(a.id));
    const agentRuns = [...state.agentRuns];
    const agentLatencies: Record<string, number> = { ...state.agentLatencies };
    let skippedLlmCount = 0;

    const planCandidates: EvidenceCandidate[] = (plan?.localEntities ?? []).map(e => ({
      name: e.name,
      url: e.url,
      classification:
        e.type === 'government'
          ? 'government'
          : e.type === 'research'
            ? 'research'
            : e.type === 'vendor'
              ? 'potential'
              : 'global',
    }));

    // agentRuns[0] is research-planner; specialists start at index 1
    const offset = agentRuns[0]?.agentId === 'research-planner' ? 1 : 0;

    const agentPromises = agentsToRun.map(async (agent, i): Promise<AgentOutput | null> => {
      const runIndex = i + offset;
      const agentStart = Date.now();
      agentRuns[runIndex] = {
        ...agentRuns[runIndex],
        status: 'running',
        startedAt: new Date().toISOString(),
      };
      callbacks.onAgentUpdate?.(agentRuns[runIndex]);

      try {
        if (
          plan &&
          shouldSkipDomainLlm(
            agent.id as IntelligenceDomain,
            plan,
            state.classification?.geography,
            state.classification?.product,
          )
        ) {
          skippedLlmCount += 1;
          const output = insufficientOutput({
            domain: agent.id as IntelligenceDomain,
            searchedFor: plan.searchedFor,
            gaps: plan.notes,
            candidates: planCandidates,
            geographyName: state.classification?.geography?.name,
            category: state.classification?.category,
          });
          agentLatencies[agent.id] = Date.now() - agentStart;
          agentRuns[runIndex] = {
            ...agentRuns[runIndex],
            status: 'completed',
            completedAt: new Date().toISOString(),
          };
          callbacks.onAgentUpdate?.(agentRuns[runIndex]);
          return output;
        }

        const domainCtx = plan
          ? applyPlanToContext(agentContext, plan, agent.id as IntelligenceDomain)
          : agentContext;
        const output = await agent.run(domainCtx);
        agentLatencies[agent.id] = Date.now() - agentStart;
        agentRuns[runIndex] = {
          ...agentRuns[runIndex],
          status: 'completed',
          completedAt: new Date().toISOString(),
        };
        callbacks.onAgentUpdate?.(agentRuns[runIndex]);
        return output;
      } catch (err) {
        agentLatencies[agent.id] = Date.now() - agentStart;
        const error = err instanceof Error ? err.message : String(err);
        agentRuns[runIndex] = {
          ...agentRuns[runIndex],
          status: 'failed',
          completedAt: new Date().toISOString(),
          error,
        };
        callbacks.onAgentUpdate?.(agentRuns[runIndex]);
        return null;
      }
    });

    const settledOutputs = await Promise.allSettled(agentPromises);
    const outputs: AgentOutput[] = settledOutputs
      .filter(
        (r): r is PromiseFulfilledResult<AgentOutput> =>
          r.status === 'fulfilled' && r.value !== null,
      )
      .map(r => r.value as AgentOutput);

    return {
      agentRuns,
      outputs,
      agentLatencies,
      skippedLlmCount,
      modelCallCount: state.modelCallCount + agentsToRun.length - skippedLlmCount,
    };
  };
}

export function createExecutionNode(callbacks: OrchestratorCallbacks) {
  return async (state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> => {
    if (!state.shouldRunExecution || !state.agentContext) {
      return {};
    }

    callbacks.onOrchestrationLog?.(
      'Execution intent detected — running execution engine for deliverables…',
    );

    const execStart = Date.now();
    const agentRuns = [...state.agentRuns];
    const execRun: AgentRun = {
      agentId: 'execution-engine',
      name: 'Execution Engine',
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    agentRuns.push(execRun);
    callbacks.onAgentUpdate?.(execRun);

    const outputs = [...state.outputs];
    const agentLatencies = { ...state.agentLatencies };
    let modelCallCount = state.modelCallCount;

    try {
      const executionOutput = await executionEngineAgent.run({
        ...state.agentContext,
        researchOutputs: outputs,
      });
      agentLatencies['execution-engine'] = Date.now() - execStart;
      execRun.status = 'completed';
      execRun.completedAt = new Date().toISOString();
      outputs.push(executionOutput);
      modelCallCount += 3;
    } catch (err) {
      agentLatencies['execution-engine'] = Date.now() - execStart;
      execRun.status = 'failed';
      execRun.error = err instanceof Error ? err.message : String(err);
    }
    callbacks.onAgentUpdate?.(execRun);

    return {
      agentRuns,
      outputs,
      agentLatencies,
      modelCallCount,
    };
  };
}

export function createFinalizeNode(callbacks: OrchestratorCallbacks) {
  return async (state: OrchestratorStateType): Promise<Partial<OrchestratorStateType>> => {
    callbacks.onOrchestrationLog?.(
      'Reasoning over findings — synthesizing answer and strategic mind map…',
    );

    const product = state.classification?.product ?? 'the product';
    const outputs = [...state.outputs];
    const plan = state.researchPlan;

    for (const output of outputs) {
      output.sources = filterAndRankSources(output.sources, 8, {
        preferReviewSites: !state.classification?.geography,
      });
    }

    const citations = buildCitationIndex(outputs);

    const [synthesisResult, mindMapResult] = await Promise.all([
      synthesize(
        state.query,
        outputs,
        state.history,
        state.images,
        state.synthesisMemoryContext,
        citations,
      ),
      generateMindMap(state.query, product, outputs),
    ]);

    if (mindMapResult) {
      outputs.push(mindMapResult);
    }

    const avgConfidence =
      outputs.length > 0
        ? outputs.reduce((sum, o) => sum + o.confidenceScore, 0) / outputs.length
        : 0.5;
    const totalConfidence: ConfidenceLevel = scoreToLevel(avgConfidence);

    const modelCallCount = state.modelCallCount + 2;
    const completedAgents = state.agentRuns.filter(r => r.status === 'completed').length;
    const failedAgents = state.agentRuns.filter(r => r.status === 'failed').length;
    const toolCallCount =
      outputs.reduce((sum, o) => sum + (o.toolCallCount ?? 0), 0) +
        (plan?.searchCallCount ?? 0) +
        (plan?.scrapedCount ?? 0) ||
      completedAgents * 3;

    const metrics: RunMetrics = {
      totalLatencyMs: Date.now() - state.orchestrationStart,
      agentLatencies: state.agentLatencies,
      estimatedCostUsd: Number.parseFloat((modelCallCount * EST_COST_PER_MODEL_CALL).toFixed(5)),
      toolCallCount,
      geminiCallCount: modelCallCount,
      agentCount: state.agentRuns.length,
      completedAgentCount: completedAgents,
      failedAgentCount: failedAgents,
      searchCallCount:
        (plan?.searchCallCount ?? 0) +
        outputs.reduce((sum, o) => sum + (o.searchCallCount ?? 0), 0),
      scrapeCallCount:
        (plan?.scrapedCount ?? 0) +
        outputs.reduce((sum, o) => sum + (o.scrapeCallCount ?? 0), 0),
      droppedIrrelevantCount: outputs.reduce(
        (sum, o) => sum + (o.droppedIrrelevantCount ?? 0),
        0,
      ),
      localEntityCount: plan?.localEntities.length ?? 0,
    };

    const result = {
      query: state.query,
      product,
      competitor: state.classification?.competitor,
      agentRuns: state.agentRuns,
      outputs,
      synthesizedAnswer: synthesisResult.answer,
      topRecommendations: synthesisResult.recommendations,
      suggestedFollowUps: synthesisResult.followUps,
      totalConfidence,
      generatedAt: new Date().toISOString(),
      metrics,
      citations,
    };

    return {
      outputs,
      modelCallCount,
      synthesizedAnswer: synthesisResult.answer,
      recommendations: synthesisResult.recommendations,
      followUps: synthesisResult.followUps,
      result,
    };
  };
}
