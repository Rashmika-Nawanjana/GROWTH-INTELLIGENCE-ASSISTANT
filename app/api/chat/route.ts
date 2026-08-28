import { NextRequest, after } from 'next/server';
import {
  runOrchestration,
  runMirofishAgent,
  runMirofishLiveAgent,
} from '../../../lib/agents/orchestrate-entry';
import { createClient } from '@/lib/supabase-server';
import { toolGetPastOutcomesForChat } from '@/lib/mcp/memory-tools';
import { indexRunEvidence, isEvidenceRagEnabled } from '@/lib/evidence';
import { getOrchestratorBackend } from '@/lib/agents/orchestrator-backend';
import { enrichRunMetrics } from '@/lib/observability/build-metrics';
import { flushLangfuse, runWithLangfuseTrace } from '@/lib/observability/langfuse';
import { getLiveLedgerCounts, runWithUsageLedger } from '@/lib/observability/usage-ledger';
import { persistRunUsage } from '@/lib/observability/persist-run';
import type {
  ConversationMessage,
  AgentRun,
  OrchestratorOutput,
  ImageAttachment,
  AgentOutput,
  RunMetrics,
} from '../../../lib/agents/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

interface LiveMetrics {
  elapsedMs: number;
  agentCount: number;
  completedAgentCount: number;
  failedAgentCount: number;
  runningAgentCount: number;
  estimatedCostUsd: number;
  geminiCallCount: number;
  toolCallCount: number;
  inputTokens?: number;
  outputTokens?: number;
}

type StreamChunk =
  | { type: 'agent_update'; run: AgentRun; metrics: LiveMetrics }
  | { type: 'orchestration_log'; line: string }
  | { type: 'result'; output: OrchestratorOutput }
  | { type: 'metrics_update'; metrics: RunMetrics }
  | { type: 'mirofish_result'; output: AgentOutput }
  | { type: 'mirofish_live_result'; output: AgentOutput }
  | { type: 'error'; message: string };

function encode(chunk: StreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonError('Not authenticated', 401);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { chatBodySchema, formatZodError } = await import('@/lib/validation/schemas');
  const parsed = chatBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(formatZodError(parsed.error), 400);
  }

  const history: ConversationMessage[] = parsed.data.history
    .filter((m): m is { role: 'user' | 'assistant'; content: string; timestamp?: string } =>
      m.role === 'user' || m.role === 'assistant',
    )
    .map(m => ({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp ?? new Date().toISOString(),
    }));

  const {
    query: rawQuery,
    images,
    sessionId,
    includeMirofish,
    includeMirofishLive,
    followUpMode,
    selectedAgents,
  } = parsed.data;

  // Rate limit + daily spend cap before any LLM spend
  const { enforceUserQuotas, guardInput, logGuardrailEvent } = await import('@/lib/guardrails');
  const quota = await enforceUserQuotas(supabase, user.id, 'chat');
  if (!quota.allowed) {
    const msg =
      quota.reason === 'spend'
        ? 'Daily usage limit reached. Try again tomorrow.'
        : `Rate limit exceeded. Retry in ${quota.retryAfterSeconds ?? 60}s.`;
    return jsonError(msg, 429);
  }

  // Input gate — redact PII, detect injection/malicious content
  const verdict = await guardInput(rawQuery);
  if (verdict.findings.length > 0 || verdict.blocked) {
    await logGuardrailEvent(supabase, {
      userId: user.id,
      route: 'chat',
      risk: verdict.risk,
      blocked: verdict.blocked,
      findings: verdict.findings,
      judged: verdict.judged,
      reason: verdict.reason,
    });
  }
  if (verdict.blocked) {
    return jsonError('Request blocked by safety policy.', 400);
  }

  const query = verdict.redactedText;

  // Trust boundary: load memory from DB — ignore client memoryContext
  const { getUserMemoryWithContext } = await import('@/lib/memory-store/user-memory');
  const { contextBlock: memoryContext } = await getUserMemoryWithContext(supabase, user.id);

  const encoder = new TextEncoder();
  // eslint-disable-next-line prefer-const
  let controller!: ReadableStreamDefaultController<Uint8Array>;

  const readable = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });

  const write = (chunk: StreamChunk) => {
    try { controller.enqueue(encoder.encode(encode(chunk))); } catch { /* stream closed */ }
  };

  const orchestrationStart = Date.now();
  const liveAgentState = new Map<string, AgentRun['status']>();

  const computeLiveMetrics = (): LiveMetrics => {
    let completed = 0;
    let failed = 0;
    let running = 0;
    for (const status of liveAgentState.values()) {
      if (status === 'completed') completed += 1;
      else if (status === 'failed') failed += 1;
      else if (status === 'running') running += 1;
    }
    const ledger = getLiveLedgerCounts();
    return {
      elapsedMs: Date.now() - orchestrationStart,
      agentCount: liveAgentState.size,
      completedAgentCount: completed,
      failedAgentCount: failed,
      runningAgentCount: running,
      estimatedCostUsd: ledger.estimatedCostUsd,
      geminiCallCount: ledger.geminiCallCount || completed + failed + 1,
      toolCallCount: ledger.toolCallCount,
      inputTokens: ledger.inputTokens,
      outputTokens: ledger.outputTokens,
    };
  };

  const emitMetricsUpdate = (base?: RunMetrics) => {
    const partial: RunMetrics = base ?? {
      totalLatencyMs: Date.now() - orchestrationStart,
      agentLatencies: {},
      estimatedCostUsd: 0,
      toolCallCount: 0,
      geminiCallCount: 0,
      agentCount: liveAgentState.size,
      completedAgentCount: 0,
      failedAgentCount: 0,
    };
    const metrics = enrichRunMetrics({
      ...partial,
      totalLatencyMs: Date.now() - orchestrationStart,
    });
    write({ type: 'metrics_update', metrics });
    return metrics;
  };

  (async () => {
    try {
      await runWithLangfuseTrace(
        {
          name: 'chat-orchestration',
          input: { query: query.slice(0, 200) },
          userId: user.id,
          sessionId: sessionId ?? undefined,
          tags: ['chat', getOrchestratorBackend()],
          metadata: { orchestratorBackend: getOrchestratorBackend() },
          asType: 'agent',
        },
        async () => {
          await runWithUsageLedger(
            {
              sessionId: sessionId ?? undefined,
              userId: user.id,
              queryPreview: query.slice(0, 120),
            },
            async () => {
              write({ type: 'orchestration_log', line: 'Starting orchestration…' });

              let injectedContext: string | undefined;
              if (sessionId) {
                const outcomes = await toolGetPastOutcomesForChat(
                  { supabase, userId: user.id },
                  sessionId,
                );
                if (outcomes.summaryBlock.trim()) {
                  injectedContext = outcomes.summaryBlock;
                  write({ type: 'orchestration_log', line: 'Loaded prior feedback and variant outcomes for this session.' });
                }
              }

              const result = await runOrchestration(
                query,
                history,
                (agentRun: AgentRun) => {
                  liveAgentState.set(agentRun.agentId, agentRun.status);
                  write({ type: 'agent_update', run: agentRun, metrics: computeLiveMetrics() });
                },
                images,
                memoryContext || undefined,
                {
                  followUpMode,
                  selectedAgents,
                  injectedContext,
                  userId: user.id,
                  onOrchestrationLog: (line: string) => write({ type: 'orchestration_log', line }),
                  guardrailConstraints: verdict.constraints,
                  guardrailRisk: verdict.risk,
                },
                supabase,
              );

              write({ type: 'result', output: result });
              let latestMetrics = result.metrics;

              if (isEvidenceRagEnabled()) {
                after(async () => {
                  try {
                    await indexRunEvidence(supabase, {
                      userId: user.id,
                      outputs: result.outputs,
                      classification: {
                        product: result.product,
                        category: undefined,
                        geography: undefined,
                      },
                    });
                  } catch (err) {
                    console.error('[evidence index after]', err instanceof Error ? err.message : err);
                  }
                });
              }

              if (includeMirofish) {
                try {
                  const mirofishOutput = await runMirofishAgent(
                    query,
                    history,
                    (agentRun: AgentRun) => {
                      liveAgentState.set(agentRun.agentId, agentRun.status);
                      write({ type: 'agent_update', run: agentRun, metrics: computeLiveMetrics() });
                    },
                    images,
                    memoryContext || undefined,
                    (line: string) => write({ type: 'orchestration_log', line }),
                  );
                  if (mirofishOutput) {
                    write({ type: 'mirofish_result', output: mirofishOutput });
                  }
                } catch {
                  // non-fatal
                }
              }

              if (includeMirofishLive) {
                try {
                  const mirofishLiveOutput = await runMirofishLiveAgent(
                    query,
                    history,
                    (agentRun: AgentRun) => {
                      liveAgentState.set(agentRun.agentId, agentRun.status);
                      write({ type: 'agent_update', run: agentRun, metrics: computeLiveMetrics() });
                    },
                    images,
                    memoryContext || undefined,
                    (line: string) => write({ type: 'orchestration_log', line }),
                  );
                  if (mirofishLiveOutput) {
                    write({ type: 'mirofish_live_result', output: mirofishLiveOutput });
                  }
                } catch {
                  // non-fatal
                }
              }

              latestMetrics = emitMetricsUpdate(latestMetrics);

              after(async () => {
                await flushLangfuse();
                if (latestMetrics && sessionId) {
                  try {
                    await persistRunUsage(supabase, {
                      userId: user.id,
                      sessionId,
                      queryPreview: query.slice(0, 200),
                      metrics: {
                        ...latestMetrics,
                        safetyScore: latestMetrics.safetyScore ?? result.metrics?.safetyScore,
                        guardrailRisk: verdict.risk,
                      },
                    });
                  } catch (err) {
                    console.error('[persistRunUsage]', err instanceof Error ? err.message : err);
                  }
                }
              });
            },
          );
        },
      );
    } catch (err) {
      const { toPublicError } = await import('@/lib/api/errors');
      const { message } = toPublicError(err, 'Analysis failed. Please try again.');
      write({ type: 'error', message });
      after(async () => { await flushLangfuse(); });
    } finally {
      try { controller.close(); } catch { /* already closed */ }
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
