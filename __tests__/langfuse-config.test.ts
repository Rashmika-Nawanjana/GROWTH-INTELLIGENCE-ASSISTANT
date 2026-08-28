import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isLangfuseEnabled,
  getLangchainCallbacks,
  runWithLangfuseTrace,
  runAgentObservation,
} from '@/lib/observability/langfuse';

describe('langfuse-config', () => {
  const env = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...env };
  });

  afterEach(() => {
    process.env = env;
  });

  it('isLangfuseEnabled is false when keys missing', () => {
    process.env.LANGFUSE_ENABLED = 'true';
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    expect(isLangfuseEnabled()).toBe(false);
  });

  it('getLangchainCallbacks returns empty when disabled', async () => {
    process.env.LANGFUSE_ENABLED = 'false';
    const callbacks = await getLangchainCallbacks();
    expect(callbacks).toEqual([]);
  });

  it('runWithLangfuseTrace runs fn directly when disabled', async () => {
    process.env.LANGFUSE_ENABLED = 'false';
    const { result, traceId } = await runWithLangfuseTrace(
      { name: 'test-trace', input: { q: 'hi' } },
      async () => 42,
    );
    expect(result).toBe(42);
    expect(traceId).toBeUndefined();
  });

  it('runAgentObservation runs fn directly when disabled', async () => {
    process.env.LANGFUSE_ENABLED = 'false';
    const out = await runAgentObservation('market-trends', 'Market Trends', async () => 'ok');
    expect(out).toBe('ok');
  });
});
