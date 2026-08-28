import { describe, it, expect, vi, beforeEach } from 'vitest';
import { discoverAndScrape } from '@/lib/tools/discover-and-scrape';
import { searchWeb } from '@/lib/tools/serpapi';
import { scrapePage } from '@/lib/tools/firecrawl';

vi.mock('@/lib/tools/serpapi', () => ({
  searchWeb: vi.fn(async () => ({
    data: [
      {
        title: 'Govi Isuru AI farming Sri Lanka',
        url: 'https://dailynews.lk/govi-isuru',
        snippet: 'Sri Lankan agritech platform',
      },
      {
        title: 'Plans & Pricing - Figma',
        url: 'https://www.figma.com/pricing/',
        snippet: 'Figma pricing',
      },
      {
        title: 'Best Precision Agriculture Software',
        url: 'https://www.g2.com/categories/precision-agriculture',
        snippet: 'G2 category',
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

describe('discoverAndScrape locale + relevance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards locale to searchWeb', async () => {
    await discoverAndScrape('agritech Sri Lanka', {
      product: 'agritech',
      domain: 'competitive',
      topN: 2,
      locale: { gl: 'lk', hl: 'en', location: 'Sri Lanka' },
    });

    expect(searchWeb).toHaveBeenCalledWith(
      'agritech Sri Lanka',
      expect.objectContaining({ gl: 'lk', hl: 'en' }),
    );
  });

  it('filters generic pages before scrape when requirements set', async () => {
    const result = await discoverAndScrape('agritech Sri Lanka', {
      product: 'AI agriculture platforms',
      domain: 'competitive',
      topN: 2,
      locale: { gl: 'lk', hl: 'en' },
      requirements: {
        geography: { name: 'Sri Lanka', countryCode: 'lk', hl: 'en' },
        category: 'agritech',
        requiredTerms: ['Sri Lanka', 'agriculture'],
      },
    });

    expect(result.droppedIrrelevantCount).toBeGreaterThan(0);
    expect(result.ranked.every(r => !r.url.includes('figma.com'))).toBe(true);
    expect(result.ranked.every(r => !r.url.includes('g2.com/categories'))).toBe(true);
    expect(scrapePage).toHaveBeenCalled();
    for (const call of vi.mocked(scrapePage).mock.calls) {
      const url = call[0] as string;
      expect(url).not.toContain('figma.com');
      expect(url).not.toMatch(/g2\.com\/categories/);
    }
  });

  it('uses prefetched results without calling searchWeb', async () => {
    vi.mocked(searchWeb).mockClear();
    const result = await discoverAndScrape('ignored', {
      product: 'x',
      domain: 'competitive',
      topN: 1,
      prefetchedResults: [
        {
          title: 'Local agritech Colombo',
          url: 'https://economy.lk/agritech',
          snippet: 'Sri Lanka startups',
        },
      ],
      requirements: {
        geography: { name: 'Sri Lanka', countryCode: 'lk' },
      },
    });

    expect(searchWeb).not.toHaveBeenCalled();
    expect(result.search.source).toBe('prefetch');
    expect(result.pages.length).toBeGreaterThanOrEqual(0);
  });
});
