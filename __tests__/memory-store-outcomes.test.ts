// @ts-nocheck
import { describe, expect, it, vi } from 'vitest';
import { getPastOutcomes, recordOutcome, MAX_SUMMARY_BLOCK_CHARS } from '@/lib/memory-store/outcomes';

function mockChain(data: unknown[] | null, error: Error | null = null) {
  const result = { data, error };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.order = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.insert = vi.fn(async () => ({ error: null }));
  chain.then = (resolve: (v: typeof result) => void) => resolve(result);
  return chain;
}

function createMockSupabase(tables: {
  feedback?: unknown[];
  actions?: unknown[];
  variantResults?: unknown[];
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'recommendation_feedback') return mockChain(tables.feedback ?? []);
      if (table === 'recommendation_actions') return mockChain(tables.actions ?? []);
      if (table === 'variant_results') return mockChain(tables.variantResults ?? []);
      return mockChain([]);
    }),
  };
}

describe('memory-store outcomes', () => {
  it('builds summaryBlock with rejected titles and variant metrics', async () => {
    const supabase = createMockSupabase({
      feedback: [{ rating: 'down', title: 'Lead with ROI calculator', note: 'Buyers hate ROI-first' }],
      actions: [],
      variantResults: [
        { variant_id: 'V1', variant_angle: 'ROI', reply_rate: 0.8, hypothesis_confirmed: 'no' },
      ],
    });

    const result = await getPastOutcomes(supabase as never, {
      sessionId: 'sess-1',
      scope: 'session',
      userId: 'user-1',
    });

    expect(result.feedback).toHaveLength(1);
    expect(result.summaryBlock).toContain('rejected: Lead with ROI calculator');
    expect(result.summaryBlock).toContain('Buyers hate ROI-first');
    expect(result.summaryBlock).toContain('V1 (ROI)');
    expect(result.summaryBlock).toContain('reply=0.8%');
  });

  it('returns empty when session scope missing sessionId', async () => {
    const supabase = createMockSupabase({});
    const result = await getPastOutcomes(supabase as never, {
      scope: 'session',
      userId: 'user-1',
    });
    expect(result.summaryBlock).toBe('');
    expect(result.feedback).toEqual([]);
  });

  it('truncates very long summary blocks', async () => {
    const longNote = 'x'.repeat(MAX_SUMMARY_BLOCK_CHARS + 500);
    const supabase = createMockSupabase({
      feedback: [{ rating: 'down', title: 'Bad angle', note: longNote }],
    });

    const result = await getPastOutcomes(supabase as never, {
      sessionId: 'sess-1',
      scope: 'session',
      userId: 'user-1',
    });

    expect(result.summaryBlock.length).toBeLessThanOrEqual(MAX_SUMMARY_BLOCK_CHARS + 20);
    expect(result.summaryBlock).toContain('[truncated]');
  });

  it('recordOutcome inserts recommendation feedback', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const supabase = {
      from: vi.fn(() => ({
        insert,
      })),
    };

    await recordOutcome(supabase as never, 'user-1', {
      kind: 'recommendation-feedback',
      sessionId: 'sess-1',
      recommendationKey: 'key-1',
      title: 'Test rec',
      rating: 'up',
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-1',
        rating: 'up',
        title: 'Test rec',
      }),
    );
  });
});
