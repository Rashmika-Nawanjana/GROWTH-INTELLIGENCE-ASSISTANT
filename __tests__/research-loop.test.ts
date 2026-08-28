import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/tools/firecrawl', () => ({
  scrapePage: vi.fn(async () => ({
    data: { url: 'https://x.lk', title: 'x', markdown: 'body', excerpt: 'body' },
    source: 'mock',
    timestamp: new Date().toISOString(),
    confidence: 0.8,
    status: 'ok' as const,
    cached: false,
  })),
}));

import { runResearchLoop } from '@/lib/agents/research-loop';
import type { AgentSource } from '@/lib/agents/types';
import type { ToolResult } from '@/lib/tools/types';

function emptyIngest(searchedFor: string[]) {
  return {
    sources: [] as AgentSource[],
    rawContent: [] as string[],
    toolResults: [] as ToolResult<unknown>[],
    searchedFor,
    relevantSourceCount: 0,
  };
}

describe('runResearchLoop', () => {
  it('fires gapRound when evidence is insufficient', async () => {
    const gapRound = vi.fn(async () => {
      return [
        {
          status: 'fulfilled' as const,
          value: { data: [], timestamp: new Date().toISOString(), status: 'ok' as const, source: 'gap' },
        },
      ];
    });

    const result = await runResearchLoop({
      domain: 'competitive',
      requirements: { geography: { name: 'Sri Lanka', countryCode: 'lk' } },
      budgetMs: 5_000,
      round1: async () => [
        {
          status: 'fulfilled' as const,
          value: { data: [], timestamp: new Date().toISOString(), status: 'ok' as const, source: 'r1' },
        },
      ],
      ingest: (_settled, round) => {
        if (round === 2) {
          return {
            sources: [
              {
                url: 'https://news.lk/agritech',
                title: 'Agritech Sri Lanka',
                timestamp: new Date().toISOString(),
                tool: 'firecrawl',
              },
            ],
            rawContent: ['[CANDIDATE] Agritech'],
            toolResults: [],
            searchedFor: ['gap'],
            relevantSourceCount: 1,
          };
        }
        return emptyIngest(['round1']);
      },
      gapRound,
    });

    expect(gapRound).toHaveBeenCalledOnce();
    expect(result.round).toBe(2);
    expect(result.toolCallCount).toBeGreaterThanOrEqual(1);
  });

  it('skips gapRound when evidence is already sufficient', async () => {
    const gapRound = vi.fn(async () => []);

    const result = await runResearchLoop({
      domain: 'pricing',
      requirements: {},
      round1: async () => [
        { status: 'fulfilled' as const, value: {} },
        { status: 'fulfilled' as const, value: {} },
        { status: 'fulfilled' as const, value: {} },
        { status: 'fulfilled' as const, value: {} },
      ],
      ingest: () => ({
        sources: [
          { url: 'https://a.com', title: 'a', timestamp: '', tool: 'serpapi' },
          { url: 'https://b.com', title: 'b', timestamp: '', tool: 'serpapi' },
          { url: 'https://c.com', title: 'c', timestamp: '', tool: 'serpapi' },
          { url: 'https://d.com', title: 'd', timestamp: '', tool: 'serpapi' },
        ],
        rawContent: ['x', 'y', 'z', 'w'],
        toolResults: [],
        searchedFor: ['q'],
        relevantSourceCount: 4,
      }),
      gapRound,
    });

    expect(gapRound).not.toHaveBeenCalled();
    expect(result.round).toBe(1);
    expect(result.evidence.status).toBe('sufficient');
  });

  it('aborts gapRound when budget is exceeded', async () => {
    const gapRound = vi.fn(
      () =>
        new Promise<PromiseSettledResult<unknown>[]>(resolve => {
          setTimeout(() => resolve([]), 200);
        }),
    );

    const result = await runResearchLoop({
      domain: 'win-loss',
      requirements: { geography: { name: 'Sri Lanka' } },
      budgetMs: 30,
      round1: async () => [{ status: 'fulfilled' as const, value: {} }],
      ingest: () => emptyIngest(['r1']),
      gapRound,
    });

    expect(result.round).toBe(1);
    expect(result.evidence.gaps.some(g => /budget/i.test(g))).toBe(true);
  });
});
