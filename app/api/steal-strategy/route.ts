import { NextRequest, after } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { runStealStrategyAgent } from '@/lib/agents/steal-strategy';
import { enrichRunMetrics } from '@/lib/observability/build-metrics';
import { flushLangfuse, runWithLangfuseTrace } from '@/lib/observability/langfuse';
import { runWithUsageLedger } from '@/lib/observability/usage-ledger';
import { persistRunUsage } from '@/lib/observability/persist-run';
import { toPublicError } from '@/lib/api/errors';
import type { AgentRun, StealPlaybookOutput } from '@/lib/agents/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

type StealStreamChunk =
  | { type: 'agent_update'; run: AgentRun }
  | { type: 'result'; output: StealPlaybookOutput }
  | { type: 'error'; message: string };

function encode(chunk: StealStreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function jsonError(message: string, status: number) {
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
    return jsonError('Invalid JSON', 400);
  }

  const { stealStrategyBodySchema, formatZodError } = await import('@/lib/validation/schemas');
  const parsed = stealStrategyBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(formatZodError(parsed.error), 400);
  }

  const { enforceUserQuotas, guardInput, logGuardrailEvent } = await import('@/lib/guardrails');
  const quota = await enforceUserQuotas(supabase, user.id, 'steal-strategy');
  if (!quota.allowed) {
    return jsonError(
      quota.reason === 'spend'
        ? 'Daily usage limit reached. Try again tomorrow.'
        : `Rate limit exceeded. Retry in ${quota.retryAfterSeconds ?? 60}s.`,
      429,
    );
  }

  // Guard each field separately so the redacted value can be reused directly —
  // no second pass needed.
  const companyVerdict = await guardInput(parsed.data.company);
  const newCoVerdict = parsed.data.newCompanyContext?.trim()
    ? await guardInput(parsed.data.newCompanyContext)
    : null;
  const marketVerdict = parsed.data.market?.trim()
    ? await guardInput(parsed.data.market)
    : null;

  if (companyVerdict.blocked || newCoVerdict?.blocked || marketVerdict?.blocked) {
    await logGuardrailEvent(supabase, {
      userId: user.id,
      route: 'steal-strategy',
      risk: 'high',
      blocked: true,
      findings: [
        ...companyVerdict.findings,
        ...(newCoVerdict?.findings ?? []),
        ...(marketVerdict?.findings ?? []),
      ],
    });
    return jsonError('Request blocked by safety policy.', 400);
  }

  const company = companyVerdict.redactedText.trim();
  const newCo = newCoVerdict?.redactedText.trim() ?? '';
  const market = marketVerdict?.redactedText.trim() ?? '';

  const query = `How did ${company} compete against rivals in ${market || 'its market'}, and how would a new entrant apply those patterns today?`;
  const startedAt = Date.now();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (chunk: StealStreamChunk) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encode(chunk)));
        } catch {
          closed = true;
        }
      };

      try {
        const { result } = await runWithLangfuseTrace(
          {
            name: 'steal-strategy',
            input: { company, market: market || undefined },
            userId: user.id,
            tags: ['steal-strategy', 'research'],
            metadata: { company, market: market || undefined },
            asType: 'span',
          },
          async () =>
            runWithUsageLedger(
              { userId: user.id, queryPreview: `Steal strategy: ${company}`.slice(0, 120) },
              async () => {
                const agentResult = await runStealStrategyAgent(
                  {
                    query,
                    product: company,
                    category: market || undefined,
                    priorContext: newCo || undefined,
                  },
                  run => send({ type: 'agent_update', run }),
                );

                const metrics = enrichRunMetrics({
                  totalLatencyMs: Date.now() - startedAt,
                  agentLatencies: { 'steal-strategy': Date.now() - startedAt },
                  estimatedCostUsd: 0,
                  toolCallCount: agentResult.output.toolCallCount ?? 0,
                  geminiCallCount: 1,
                  agentCount: 1,
                  completedAgentCount: 1,
                  failedAgentCount: 0,
                  searchCallCount: agentResult.output.searchCallCount,
                  scrapeCallCount: agentResult.output.scrapeCallCount,
                  safetyScore: agentResult.safetyScore,
                  guardrailRisk: companyVerdict.risk,
                });

                await persistRunUsage(supabase, {
                  userId: user.id,
                  sessionId: 'steal-strategy',
                  queryPreview: `Steal strategy: ${company}`,
                  metrics,
                }).catch(() => {});

                return agentResult.output;
              },
            ),
        );

        send({ type: 'result', output: result });
      } catch (e) {
        send({
          type: 'error',
          message: toPublicError(e, 'Strategy generation failed').message,
        });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
        after(async () => { await flushLangfuse(); });
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
