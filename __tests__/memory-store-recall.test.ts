// @ts-nocheck
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { recallSimilarTurns } from '@/lib/memory-store/recall';

vi.mock('@/lib/embeddings', () => ({
  embedText: vi.fn(),
}));

import { embedText } from '@/lib/embeddings';

function mockChain(data: unknown[] | null, error: Error | null = null) {
  const result = { data, error };
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.maybeSingle = vi.fn(async () => ({ data: { id: 'sess-1' }, error: null }));
  chain.rpc = vi.fn(async () => ({ data, error }));
  return chain;
}

describe('memory-store recall', () => {
  beforeEach(() => {
    vi.mocked(embedText).mockReset();
  });

  it('returns empty when embedding fails', async () => {
    vi.mocked(embedText).mockResolvedValue(null);
    const supabase = {
      from: vi.fn(() => mockChain(null)),
    };

    const result = await recallSimilarTurns(supabase as never, {
      sessionId: 'sess-1',
      query: 'pricing in Sri Lanka',
      userId: 'user-1',
    });

    expect(result.hits).toEqual([]);
    expect(result.contextBlock).toBe('');
  });

  it('returns empty when session is not owned by user', async () => {
    vi.mocked(embedText).mockResolvedValue([0.1, 0.2]);
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      })),
    };

    const result = await recallSimilarTurns(supabase as never, {
      sessionId: 'sess-other',
      query: 'test',
      userId: 'user-1',
    });

    expect(result.hits).toEqual([]);
    expect(result.contextBlock).toBe('');
  });

  it('builds contextBlock from rpc hits', async () => {
    vi.mocked(embedText).mockResolvedValue([0.1, 0.2]);
    const hits = [
      {
        id: '1',
        message_id: 'm1',
        role: 'user' as const,
        content: 'Focus on Sri Lanka agritech only',
        similarity: 0.9,
        created_at: new Date().toISOString(),
      },
    ];
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(async () => ({ data: { id: 'sess-1' }, error: null })),
      })),
      rpc: vi.fn(async () => ({ data: hits, error: null })),
    };

    const result = await recallSimilarTurns(supabase as never, {
      sessionId: 'sess-1',
      query: 'local competitors',
      userId: 'user-1',
    });

    expect(result.hits).toHaveLength(1);
    expect(result.contextBlock).toContain('[Relevant context from earlier in this chat]');
    expect(result.contextBlock).toContain('Sri Lanka agritech');
  });
});
