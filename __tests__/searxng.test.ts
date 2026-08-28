import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mapSearxngResults, getSearxngBaseUrl, searchSearxng } from '@/lib/tools/searxng';

describe('mapSearxngResults', () => {
  it('maps title/url/content to SearchResult', () => {
    const results = mapSearxngResults({
      results: [
        {
          title: 'Vector Agents',
          url: 'https://example.com/a',
          content: 'AI digital workers',
          publishedDate: '2026-01-01',
        },
        { title: 'Skip me', url: '' },
        { title: 'Alt link', link: 'https://example.com/b', snippet: 'snip' },
      ],
    });
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: 'Vector Agents',
      url: 'https://example.com/a',
      snippet: 'AI digital workers',
      date: '2026-01-01',
    });
    expect(results[1].url).toBe('https://example.com/b');
  });

  it('respects limit', () => {
    const results = mapSearxngResults(
      {
        results: Array.from({ length: 12 }, (_, i) => ({
          title: `T${i}`,
          url: `https://example.com/${i}`,
        })),
      },
      3,
    );
    expect(results).toHaveLength(3);
  });
});

describe('getSearxngBaseUrl', () => {
  it('trims trailing slash', () => {
    expect(getSearxngBaseUrl({ SEARXNG_BASE_URL: 'http://127.0.0.1:8080/' })).toBe(
      'http://127.0.0.1:8080',
    );
  });

  it('returns undefined when unset', () => {
    expect(getSearxngBaseUrl({})).toBeUndefined();
  });
});

describe('searchSearxng', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns failed when base URL missing', async () => {
    const result = await searchSearxng('q', {}, {});
    expect(result.status).toBe('failed');
    expect(result.data).toEqual([]);
  });

  it('parses JSON response from instance', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ title: 'Hit', url: 'https://ex.com', content: 'body' }],
      }),
    }) as unknown as typeof fetch;

    const result = await searchSearxng(
      'test',
      { categories: 'general' },
      { SEARXNG_BASE_URL: 'http://127.0.0.1:8080' },
    );

    expect(result.status).toBe('ok');
    expect(result.data[0].title).toBe('Hit');
    expect(result.source).toContain('SearXNG');
    expect(globalThis.fetch).toHaveBeenCalled();
    const calledUrl = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(calledUrl).toContain('format=json');
    expect(calledUrl).toContain('q=test');
  });

  it('returns failed on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }) as unknown as typeof fetch;

    const result = await searchSearxng('q', {}, { SEARXNG_BASE_URL: 'http://127.0.0.1:8080' });
    expect(result.status).toBe('failed');
    expect(result.source).toContain('403');
  });
});
