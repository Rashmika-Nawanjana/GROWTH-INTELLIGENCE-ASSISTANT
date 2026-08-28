/**
 * SearXNG Search API client.
 * @see https://docs.searxng.org/dev/search_api.html
 */

import type { ToolResult, SearchResult } from './types';
import { buildToolResult } from './fallback';

export type SearxngSearchOptions = {
  categories?: string;
  pageno?: number;
  language?: string;
  time_range?: 'day' | 'month' | 'year';
};

type SearxngRawResult = {
  title?: string;
  url?: string;
  link?: string;
  content?: string;
  snippet?: string;
  publishedDate?: string;
  pubdate?: string;
};

type SearxngRawResponse = {
  results?: SearxngRawResult[];
};

export function getSearxngBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env.SEARXNG_BASE_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, '');
}

/** Pure mapper — exported for unit tests. */
export function mapSearxngResults(raw: SearxngRawResponse, limit = 8): SearchResult[] {
  const rows = Array.isArray(raw.results) ? raw.results : [];
  return rows
    .map((r): SearchResult | null => {
      const url = (r.url ?? r.link ?? '').trim();
      const title = (r.title ?? '').trim();
      if (!url || !title) return null;
      return {
        title,
        url,
        snippet: (r.content ?? r.snippet ?? '').trim(),
        date: r.publishedDate ?? r.pubdate,
      };
    })
    .filter((r): r is SearchResult => r !== null)
    .slice(0, limit);
}

function emptyResult(query: string, reason: string): ToolResult<SearchResult[]> {
  return buildToolResult<SearchResult[]>({
    data: [],
    status: 'failed',
    source: `SearXNG (${reason})`,
    sourceUrl: `search?q=${encodeURIComponent(query)}`,
  });
}

/**
 * Query a self-hosted SearXNG instance with format=json.
 */
export async function searchSearxng(
  query: string,
  options: SearxngSearchOptions = {},
  env: Record<string, string | undefined> = process.env,
): Promise<ToolResult<SearchResult[]>> {
  const base = getSearxngBaseUrl(env);
  if (!base) {
    return emptyResult(query, 'SEARXNG_BASE_URL not set');
  }

  const categories =
    options.categories?.trim() ||
    env.SEARXNG_CATEGORIES?.trim() ||
    'general';

  const url = new URL(`${base}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('categories', categories);
  if (options.pageno) url.searchParams.set('pageno', String(options.pageno));
  if (options.language) url.searchParams.set('language', options.language);
  if (options.time_range) url.searchParams.set('time_range', options.time_range);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      return emptyResult(query, `HTTP ${res.status}`);
    }

    const raw = (await res.json()) as SearxngRawResponse;
    const results = mapSearxngResults(raw);

    return buildToolResult<SearchResult[]>({
      data: results,
      status: results.length > 0 ? 'ok' : 'failed',
      source: `SearXNG / ${categories}`,
      sourceUrl: url.toString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'request failed';
    return emptyResult(query, msg);
  }
}
