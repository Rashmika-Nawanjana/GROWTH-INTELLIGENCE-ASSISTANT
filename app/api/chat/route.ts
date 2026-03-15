import { NextRequest } from 'next/server';
import { orchestrate } from '../../../lib/agents/orchestrator';
import type { ConversationMessage, AgentRun, OrchestratorOutput, ImageAttachment } from '../../../lib/agents/types';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 min budget for parallel agents

// ── Streaming chunk types ─────────────────────────────────────────────────────
type StreamChunk =
  | { type: 'agent_update'; run: AgentRun }
  | { type: 'result'; output: OrchestratorOutput }
  | { type: 'error'; message: string };

function encode(chunk: StreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export async function POST(req: NextRequest) {
  let body: { query: string; history: ConversationMessage[]; images?: ImageAttachment[]; memoryContext?: string };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { query, history = [], images = [], memoryContext } = body;

  if (!query?.trim()) {
    return new Response(JSON.stringify({ error: 'query is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
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

  // Run orchestration in background, stream updates to frontend
  (async () => {
    try {
      const result = await orchestrate(
        query,
        history,
        (agentRun: AgentRun) => { write({ type: 'agent_update', run: agentRun }); },
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
