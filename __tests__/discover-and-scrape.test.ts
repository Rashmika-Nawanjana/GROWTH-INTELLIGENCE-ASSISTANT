import { describe, expect, it, vi, beforeEach } from 'vitest';
import { discoverAndScrape } from '@/lib/tools/discover-and-scrape';

vi.mock('@/lib/tools/serpapi', () => ({
  searchWeb: vi.fn(async () => ({
    data: [
      {
        title: 'Competitor Pricing',
        url: 'https://competitor.example/pricing',
        snippet: 'Plans from $49',
      },
      {
        title: 'Feature comparison',
        url: 'https://blog.example/compare-vector',
        snippet: 'vs Vector Agents',
      },
    ],
    source: 'mock',
    timestamp: new Date().toISOString(),
    confidence: 0.9,
    status: 'ok' as const,
    cached: false,
  })),
}));

vi.mock('@/lib/tools/firecrawl', () => ({
  scrapePage: vi.fn(async (url: string) => ({
    data: {
      url,
      title: `Page ${url}`,
      markdown: 'Scraped body content long enough to count as real.',
      excerpt: 'Scraped body',
    },
    source: 'mock-scrape',
    timestamp: new Date().toISOString(),
    confidence: 0.8,
    status: 'ok' as const,
    cached: false,
  })),
}));

describe('discoverAndScrape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('searches, ranks, and scrapes top N pages', async () => {
    const result = await discoverAndScrape('competitor pricing Vector Agents', {
      product: 'Vector Agents',
      domain: 'competitive',
      topN: 2,
      keywords: ['pricing', 'competitor'],
    });

    expect(result.search.data.length).toBeGreaterThan(0);
    expect(result.ranked.length).toBeLessThanOrEqual(2);
    expect(result.pages).toHaveLength(result.ranked.length);
    expect(result.pages.every(p => p.data.markdown.length > 0)).toBe(true);
  });
});
