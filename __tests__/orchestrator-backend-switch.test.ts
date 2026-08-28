import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getOrchestratorBackend } from '@/lib/agents/orchestrator-backend';

describe('getOrchestratorBackend', () => {
  it('defaults to legacy', () => {
    expect(getOrchestratorBackend({})).toBe('legacy');
  });

  it('selects langgraph when env is set', () => {
    expect(getOrchestratorBackend({ ORCHESTRATOR_BACKEND: 'langgraph' })).toBe('langgraph');
  });

  it('treats unknown values as legacy', () => {
    expect(getOrchestratorBackend({ ORCHESTRATOR_BACKEND: 'experimental' })).toBe('legacy');
  });
});

describe('runOrchestration switch', () => {
  const original = process.env.ORCHESTRATOR_BACKEND;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.ORCHESTRATOR_BACKEND;
    else process.env.ORCHESTRATOR_BACKEND = original;
    vi.doUnmock('@/lib/agents/orchestrator');
    vi.doUnmock('@/lib/agents/langgraph/orchestrate');
  });

  it('calls legacy orchestrate by default', async () => {
    delete process.env.ORCHESTRATOR_BACKEND;

    const legacy = vi.fn().mockResolvedValue({
      query: 'q',
      product: 'p',
      agentRuns: [],
      outputs: [],
      synthesizedAnswer: 'legacy',
      topRecommendations: [],
      suggestedFollowUps: [],
      totalConfidence: 'medium',
      generatedAt: new Date().toISOString(),
    });

    vi.doMock('@/lib/agents/orchestrator', () => ({
      orchestrate: legacy,
      runMirofishAgent: vi.fn(),
      runMirofishLiveAgent: vi.fn(),
    }));

    const { runOrchestration } = await import('@/lib/agents/orchestrate-entry');
    const result = await runOrchestration('test query', []);
    expect(legacy).toHaveBeenCalledOnce();
    expect(result.synthesizedAnswer).toBe('legacy');
  });

  it('dynamically loads langgraph when flagged', async () => {
    process.env.ORCHESTRATOR_BACKEND = 'langgraph';

    const langgraph = vi.fn().mockResolvedValue({
      query: 'q',
      product: 'p',
      agentRuns: [],
      outputs: [],
      synthesizedAnswer: 'langgraph',
      topRecommendations: [],
      suggestedFollowUps: [],
      totalConfidence: 'medium',
      generatedAt: new Date().toISOString(),
    });

    vi.doMock('@/lib/agents/orchestrator', () => ({
      orchestrate: vi.fn(),
      runMirofishAgent: vi.fn(),
      runMirofishLiveAgent: vi.fn(),
    }));
    vi.doMock('@/lib/agents/langgraph/orchestrate', () => ({
      orchestrateLangGraph: langgraph,
    }));

    const { runOrchestration } = await import('@/lib/agents/orchestrate-entry');
    const result = await runOrchestration('test query', []);
    expect(langgraph).toHaveBeenCalledOnce();
    expect(result.synthesizedAnswer).toBe('langgraph');
  });
});
