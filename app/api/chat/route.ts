import { NextRequest } from 'next/server';
import { orchestrate } from '../../../lib/agents/orchestrator';
import { createClient } from '@/lib/supabase-server';
import type { ConversationMessage, AgentRun, OrchestratorOutput, ImageAttachment } from '../../../lib/agents/types';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 min budget for parallel agents

// ── Streaming chunk types ─────────────────────────────────────────────────────
interface LiveMetrics {
  elapsedMs: number;
  agentCount: number;
  completedAgentCount: number;
  failedAgentCount: number;
  runningAgentCount: number;
  estimatedCostUsd: number;
}

type StreamChunk =
  | { type: 'agent_update'; run: AgentRun; metrics: LiveMetrics }
  | { type: 'result'; output: OrchestratorOutput }
  | { type: 'error'; message: string };

// Mirror of orchestrator cost model — kept cheap and only used for the
// live per-chunk cost readout the UI shows while agents are running. The
// authoritative cost lands in the final `result` chunk.
const LIVE_COST_PER_AGENT = (2000 * (0.1 / 1_000_000)) + (1000 * (0.4 / 1_000_000));

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
  // ── Auth gate (parity with /api/feedback, /api/refine, /api/recall) ─────────
  // Orchestration spends real tokens and hits live APIs on every invocation,
  // so the endpoint must require a signed-in Supabase user before any work
  // starts. Unauthenticated callers get 401 *before* the stream opens.
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonError('Not authenticated', 401);
  }

  let body: { query: string; history: ConversationMessage[]; images?: ImageAttachment[]; memoryContext?: string };

  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { query, history = [], images = [], memoryContext } = body;

  if (!query?.trim()) {
    return jsonError('query is required', 400);
  }

  const encoder = new TextEncoder();
  // eslint-disable-next-line prefer-const
  let controller!: ReadableStreamDefaultController<Uint8Array>;

  const readable = new ReadableStream<Uint8Array>({
    start(c) { controller = c; },
  });

  const write = (chunk: StreamChunk) => {
    try { controller.enqueue(encoder.encode(encode(chunk))); } catch { /* stream closed */ }
  };

  // Live metrics accumulator — lets the UI show running cost + latency +
  // completed-agent count as agents finish. The authoritative RunMetrics
  // object (with per-agent latencies and Gemini-call totals) lands on the
  // final `result` chunk.
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
    // Each finished agent (completed or failed) = ~1 Gemini call for the
    // live readout. The final total also covers classification + synthesis
    // + mind map, which only land on the `result` chunk.
    const billedCalls = completed + failed;
    return {
      elapsedMs: Date.now() - orchestrationStart,
      agentCount: liveAgentState.size,
      completedAgentCount: completed,
      failedAgentCount: failed,
      runningAgentCount: running,
      estimatedCostUsd: Number.parseFloat((billedCalls * LIVE_COST_PER_AGENT).toFixed(5)),
    };
  };

  // Run orchestration in background, stream updates to frontend
  (async () => {
    try {
      const result = await orchestrate(
        query,
        history,
        (agentRun: AgentRun) => {
          liveAgentState.set(agentRun.agentId, agentRun.status);
          write({ type: 'agent_update', run: agentRun, metrics: computeLiveMetrics() });
        },
        images,
        memoryContext,
      );
      write({ type: 'result', output: result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      write({ type: 'error', message });
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
