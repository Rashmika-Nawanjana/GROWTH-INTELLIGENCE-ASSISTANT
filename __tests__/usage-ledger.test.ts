import { describe, it, expect } from 'vitest';
import {
  recordLlmCall,
  recordEmbeddingCall,
  recordToolCall,
  runWithUsageLedger,
  snapshotUsage,
} from '@/lib/observability/usage-ledger';

describe('usage-ledger', () => {
  it('records LLM, embedding, and tool calls', () => {
    runWithUsageLedger({ sessionId: 's1', userId: 'u1' }, () => {
      recordLlmCall({
        stage: 'classify',
        model: 'gemini-2.5-flash',
        inputTokens: 1000,
        outputTokens: 200,
        latencyMs: 50,
        ok: true,
      });
      recordEmbeddingCall({
        purpose: 'evidence-index',
        model: 'gemini-embedding-001',
        charCount: 400,
        latencyMs: 30,
        ok: true,
      });
      recordToolCall({
        provider: 'searxng',
        status: 'ok',
        latencyMs: 120,
        cached: false,
      });

      const usage = snapshotUsage();
      expect(usage.llm.calls).toBe(1);
      expect(usage.llm.inputTokens).toBe(1000);
      expect(usage.embeddings.calls).toBe(1);
      expect(usage.tools.calls).toBe(1);
      expect(usage.tools.byProvider.searxng?.ok).toBe(1);
      expect(usage.totalCostUsd).toBeGreaterThan(0);
    });
  });

  it('record* is no-op outside ledger', () => {
    recordLlmCall({
      stage: 'agent',
      model: 'gemini-2.5-flash',
      inputTokens: 100,
      outputTokens: 50,
      latencyMs: 10,
      ok: true,
    });
    const usage = snapshotUsage();
    expect(usage.llm.calls).toBe(0);
    expect(usage.tools.calls).toBe(0);
  });
});
