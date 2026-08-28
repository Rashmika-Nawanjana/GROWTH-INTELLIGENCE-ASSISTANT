import {
  getUsageLedgerMeta,
  setUsageTraceInfo,
} from './usage-ledger';

let spanProcessor: { forceFlush?: () => Promise<void> } | null = null;

export type LangfuseObservationType =
  | 'span'
  | 'generation'
  | 'agent'
  | 'tool'
  | 'chain'
  | 'embedding'
  | 'retriever';

export function isLangfuseEnabled(): boolean {
  if (process.env.LANGFUSE_ENABLED !== 'true') return false;
  const pk = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  const sk = process.env.LANGFUSE_SECRET_KEY?.trim();
  return Boolean(pk && sk);
}

export function getLangfuseBaseUrl(): string {
  return (
    process.env.LANGFUSE_BASE_URL?.trim() ||
    process.env.LANGFUSE_HOST?.trim() ||
    'https://cloud.langfuse.com'
  ).replace(/\/$/, '');
}

export function buildTraceUrl(traceId: string): string {
  return `${getLangfuseBaseUrl()}/trace/${traceId}`;
}

export function registerLangfuseSpanProcessor(
  processor: { forceFlush?: () => Promise<void> },
): void {
  spanProcessor = processor;
}

export async function flushLangfuse(): Promise<void> {
  if (!isLangfuseEnabled()) return;
  try {
    await spanProcessor?.forceFlush?.();
  } catch (err) {
    console.warn('[langfuse] flush failed:', err instanceof Error ? err.message : err);
  }
}

export type LangfuseCallbackContext = {
  sessionId?: string;
  userId?: string;
  tags?: string[];
  stage?: string;
};

export async function getLangchainCallbacks(
  ctx: LangfuseCallbackContext = {},
): Promise<unknown[]> {
  if (!isLangfuseEnabled()) return [];

  try {
    const { CallbackHandler } = await import('@langfuse/langchain');
    const meta = getUsageLedgerMeta();
    const tags = [
      ...(ctx.tags ?? ['growth-intelligence']),
      ...(ctx.stage ? [`stage:${ctx.stage}`] : []),
    ];
    return [
      new CallbackHandler({
        sessionId: ctx.sessionId ?? meta?.sessionId,
        userId: ctx.userId ?? meta?.userId,
        tags,
      }),
    ];
  } catch (err) {
    console.warn('[langfuse] CallbackHandler unavailable:', err instanceof Error ? err.message : err);
    return [];
  }
}

export type LangfuseTraceOptions = {
  name: string;
  /** Trace-level input — only user-relevant data, not secrets or full request bodies */
  input?: unknown;
  userId?: string;
  sessionId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  asType?: Extract<LangfuseObservationType, 'agent' | 'span' | 'chain'>;
};

export type LangfuseTraceResult<T> = {
  result: T;
  traceId?: string;
  traceUrl?: string;
};

/**
 * Root trace wrapper: sets active OTel context, propagates user/session/tags,
 * and nests LangChain generations + child spans correctly.
 */
export async function runWithLangfuseTrace<T>(
  options: LangfuseTraceOptions,
  fn: () => Promise<T>,
): Promise<LangfuseTraceResult<T>> {
  if (!isLangfuseEnabled()) {
    return { result: await fn() };
  }

  try {
    const {
      startActiveObservation,
      propagateAttributes,
      getActiveTraceId,
    } = await import('@langfuse/tracing');

    const asType = options.asType ?? 'agent';

    const execute = async (
      updateInput: (input: unknown) => void,
    ): Promise<LangfuseTraceResult<T>> => {
      if (options.input !== undefined) {
        updateInput(options.input);
      }

      return propagateAttributes(
        {
          userId: options.userId,
          sessionId: options.sessionId,
          tags: options.tags ?? ['growth-intelligence'],
          metadata: options.metadata as Record<string, string> | undefined,
          traceName: options.name,
        },
        async () => {
          const result = await fn();
          const traceId = getActiveTraceId();
          if (traceId) {
            const traceUrl = buildTraceUrl(traceId);
            setUsageTraceInfo(traceId, traceUrl);
            return { result, traceId, traceUrl };
          }
          return { result };
        },
      );
    };

    if (asType === 'agent') {
      return startActiveObservation(
        options.name,
        async (obs) => execute((input) => { obs.update({ input }); }),
        { asType: 'agent' },
      );
    }

    if (asType === 'chain') {
      return startActiveObservation(
        options.name,
        async (obs) => execute((input) => { obs.update({ input }); }),
        { asType: 'chain' },
      );
    }

    return startActiveObservation(
      options.name,
      async (obs) => execute((input) => { obs.update({ input }); }),
    );
  } catch (err) {
    console.warn('[langfuse] runWithLangfuseTrace failed:', err instanceof Error ? err.message : err);
    return { result: await fn() };
  }
}

/** @deprecated Prefer runWithLangfuseTrace — keeps chat route migration incremental */
export type RootObservation = {
  traceId: string;
  traceUrl: string;
  end: (output?: unknown) => void;
};

/** @deprecated Prefer runWithLangfuseTrace */
export function startRootObservation(
  name: string,
  input?: unknown,
  meta?: Record<string, unknown>,
): RootObservation | null {
  if (!isLangfuseEnabled()) return null;

  void meta;

  try {
    const { startObservation, getActiveTraceId } = require('@langfuse/tracing') as {
      startObservation: (
        n: string,
        attrs?: { input?: unknown },
        opts?: { asType?: string },
      ) => { traceId: string; end: (output?: unknown) => void; update: (a: unknown) => void };
      getActiveTraceId: () => string | undefined;
    };

    const obs = startObservation(name, { input }, { asType: 'agent' });
    const traceId = obs.traceId ?? getActiveTraceId() ?? 'unknown';
    const traceUrl = buildTraceUrl(traceId);
    setUsageTraceInfo(traceId, traceUrl);

    return {
      traceId,
      traceUrl,
      end: (output?: unknown) => {
        try {
          obs.end(output);
        } catch {
          // non-fatal
        }
      },
    };
  } catch (err) {
    console.warn('[langfuse] startObservation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Wrap a specialist agent run as an `agent` observation (Agent Graph + per-agent latency).
 */
export async function runAgentObservation<T>(
  agentId: string,
  agentName: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isLangfuseEnabled()) return fn();

  try {
    const { startActiveObservation } = await import('@langfuse/tracing');
    return startActiveObservation(
      `agent:${agentId}`,
      async (agent) => {
        agent.update({
          input: { agentId, name: agentName },
          metadata: { agentId, agentName },
        });
        try {
          const result = await fn();
          agent.update({ output: { status: 'completed' } });
          return result;
        } catch (err) {
          agent.update({
            level: 'ERROR',
            statusMessage: err instanceof Error ? err.message : String(err),
            output: { status: 'failed' },
          });
          throw err;
        }
      },
      { asType: 'agent' },
    );
  } catch {
    return fn();
  }
}

export type ChildSpanOptions = {
  asType?: LangfuseObservationType;
  input?: Record<string, unknown>;
};

export function startChildSpan(
  name: string,
  input?: Record<string, unknown>,
  options?: ChildSpanOptions,
): { end: (output?: unknown) => void } | null {
  if (!isLangfuseEnabled()) return null;

  const asType = options?.asType ?? 'span';
  const spanInput = options?.input ?? input;

  try {
    const { startObservation } = require('@langfuse/tracing') as {
      startObservation: (
        n: string,
        attrs?: { input?: unknown },
        opts?: { asType?: LangfuseObservationType },
      ) => { end: (output?: unknown) => void };
    };
    const span = startObservation(
      name,
      spanInput ? { input: spanInput } : undefined,
      { asType },
    );
    return { end: (output?: unknown) => span.end(output) };
  } catch {
    return null;
  }
}
