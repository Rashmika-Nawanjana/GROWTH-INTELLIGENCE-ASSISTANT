import { getCached, setCache } from '../supabase';
import type { ToolResult, SearchResult, TrendPoint } from './types';
import { buildToolResult } from './fallback';
import { getSearxngBaseUrl, searchSearxng } from './searxng';

const BASE_URL = 'https://serpapi.com/search';

/** Optional locale for geo-grounded search (SerpAPI gl/hl + SearXNG language). */
export type SearchLocaleOptions = {
  gl?: string;       // country code, e.g. "lk"
  hl?: string;       // language, e.g. "en"
  location?: string; // free-text location bias
};

class SerpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SerpError';
  }
}

async function serpFetch(params: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new SerpError('SERPAPI_KEY not set');
  const url = new URL(BASE_URL);
  url.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    next: { revalidate: 0 },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new SerpError(`SerpAPI ${res.status}: ${await res.text()}`);
  return res.json();
}

function emptySearchResult(source: string, query: string): ToolResult<SearchResult[]> {
  return buildToolResult<SearchResult[]>({
    data: [],
    status: 'failed',
    source: `${source} (failed)`,
    sourceUrl: `https://google.com/search?q=${encodeURIComponent(query)}`,
  });
}

function hasSerpApiKey(): boolean {
  return Boolean(process.env.SERPAPI_KEY?.trim());
}

function localeCacheSuffix(locale?: SearchLocaleOptions): string {
  if (!locale) return '';
  const parts = [locale.gl, locale.hl, locale.location].filter(Boolean);
  return parts.length ? `:loc:${parts.join(',')}` : '';
}

function applyLocaleParams(
  base: Record<string, string>,
  locale?: SearchLocaleOptions,
): Record<string, string> {
  if (!locale) return base;
  const out = { ...base };
  if (locale.gl?.trim()) out.gl = locale.gl.trim().toLowerCase();
  if (locale.hl?.trim()) out.hl = locale.hl.trim().toLowerCase();
  if (locale.location?.trim()) out.location = locale.location.trim();
  return out;
}

/**
 * Prefer SearXNG when configured; fall back to SerpAPI Google organic.
 */
async function searchWebViaSerpApi(
  query: string,
  locale?: SearchLocaleOptions,
): Promise<ToolResult<SearchResult[]>> {
  try {
    const raw = (await serpFetch(
      applyLocaleParams({ engine: 'google', q: query, num: '10' }, locale),
    )) as {
      organic_results?: Array<{ title: string; link: string; snippet?: string; date?: string }>;
    };

    const results: SearchResult[] = (raw.organic_results ?? []).slice(0, 8).map(r => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet ?? '',
      date: r.date,
    }));

    return buildToolResult<SearchResult[]>({
      data: results,
      status: results.length > 0 ? 'ok' : 'failed',
      source: 'SerpAPI / Google',
      sourceUrl: `https://google.com/search?q=${encodeURIComponent(query)}`,
    });
  } catch {
    return emptySearchResult('SerpAPI / Google', query);
  }
}

async function searchNewsViaSerpApi(
  query: string,
  locale?: SearchLocaleOptions,
): Promise<ToolResult<SearchResult[]>> {
  try {
    const raw = (await serpFetch(
      applyLocaleParams(
        {
          engine: 'google',
          q: query,
          tbm: 'nws',
          num: '10',
        },
        locale,
      ),
    )) as {
      news_results?: Array<{ title: string; link: string; snippet?: string; date?: string }>;
    };

    const results: SearchResult[] = (raw.news_results ?? []).slice(0, 8).map(r => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet ?? '',
      date: r.date,
    }));

    return buildToolResult<SearchResult[]>({
      data: results,
      status: results.length > 0 ? 'ok' : 'failed',
      source: 'SerpAPI / Google News',
      sourceUrl: `https://news.google.com/search?q=${encodeURIComponent(query)}`,
    });
  } catch {
    return emptySearchResult('SerpAPI / Google News', query);
  }
}

export async function searchWeb(
  query: string,
  locale?: SearchLocaleOptions,
): Promise<ToolResult<SearchResult[]>> {
  const cacheKey = `web:${query}${localeCacheSuffix(locale)}`;
  const cached = await getCached('serpapi_search', cacheKey);
  if (cached) {
    return { ...(cached as ToolResult<SearchResult[]>), cached: true };
  }

  const searxLanguage = locale?.hl?.trim() || undefined;

  if (getSearxngBaseUrl()) {
    const searx = await searchSearxng(query, {
      categories: 'general',
      language: searxLanguage,
    });
    if (searx.data.length > 0 && searx.status !== 'failed') {
      await setCache('serpapi_search', cacheKey, searx);
      return searx;
    }
    if (hasSerpApiKey()) {
      const serp = await searchWebViaSerpApi(query, locale);
      if (serp.data.length > 0) {
        const degraded = buildToolResult<SearchResult[]>({
          data: serp.data,
          status: 'degraded',
          source: `${serp.source} (SearXNG miss)`,
          sourceUrl: serp.sourceUrl,
        });
        await setCache('serpapi_search', cacheKey, degraded);
        return degraded;
      }
      await setCache('serpapi_search', cacheKey, serp);
      return serp;
    }
    await setCache('serpapi_search', cacheKey, searx);
    return searx;
  }

  if (!hasSerpApiKey()) {
    return emptySearchResult('SerpAPI / Google', query);
  }

  const result = await searchWebViaSerpApi(query, locale);
  await setCache('serpapi_search', cacheKey, result);
  return result;
}

export async function searchNews(
  query: string,
  locale?: SearchLocaleOptions,
): Promise<ToolResult<SearchResult[]>> {
  const cacheKey = `news:${query}${localeCacheSuffix(locale)}`;
  const cached = await getCached('serpapi_news', cacheKey);
  if (cached) {
    return { ...(cached as ToolResult<SearchResult[]>), cached: true };
  }

  const searxLanguage = locale?.hl?.trim() || undefined;

  if (getSearxngBaseUrl()) {
    const searx = await searchSearxng(query, {
      categories: 'news',
      language: searxLanguage,
    });
    if (searx.data.length > 0 && searx.status !== 'failed') {
      await setCache('serpapi_news', cacheKey, searx);
      return searx;
    }
    if (hasSerpApiKey()) {
      const serp = await searchNewsViaSerpApi(query, locale);
      if (serp.data.length > 0) {
        const degraded = buildToolResult<SearchResult[]>({
          data: serp.data,
          status: 'degraded',
          source: `${serp.source} (SearXNG miss)`,
          sourceUrl: serp.sourceUrl,
        });
        await setCache('serpapi_news', cacheKey, degraded);
        return degraded;
      }
      await setCache('serpapi_news', cacheKey, serp);
      return serp;
    }
    await setCache('serpapi_news', cacheKey, searx);
    return searx;
  }

  if (!hasSerpApiKey()) {
    return emptySearchResult('SerpAPI / Google News', query);
  }

  const result = await searchNewsViaSerpApi(query, locale);
  await setCache('serpapi_news', cacheKey, result);
  return result;
}

export async function searchTrends(keywords: string[]): Promise<ToolResult<TrendPoint[]>> {
  const cacheKey = `trends:${keywords.join(',')}`;
  const cached = await getCached('serpapi_trends', cacheKey);
  if (cached) {
    return { ...(cached as ToolResult<TrendPoint[]>), cached: true };
  }

  try {
    const raw = (await serpFetch({
      engine: 'google_trends',
      q: keywords.join(','),
      data_type: 'TIMESERIES',
      date: 'today 12-m',
    })) as {
      interest_over_time?: {
        timeline_data?: Array<{
          date: string;
          values?: Array<{ value?: string; query: string }>;
        }>;
      };
    };

    const points: TrendPoint[] = [];
    const timeline = raw.interest_over_time?.timeline_data ?? [];

    for (const point of timeline) {
      for (const kw of point.values ?? []) {
        points.push({
          date: point.date,
          value: Number.parseInt(kw.value ?? '0', 10),
          keyword: kw.query,
        });
      }
    }

    const result = buildToolResult<TrendPoint[]>({
      data: points,
      status: points.length > 0 ? 'ok' : 'failed',
      source: 'SerpAPI / Google Trends',
      sourceUrl: `https://trends.google.com/trends/explore?q=${encodeURIComponent(keywords.join(','))}`,
    });

    await setCache('serpapi_trends', cacheKey, result);
    return result;
  } catch {
    return buildToolResult<TrendPoint[]>({
      data: [],
      status: 'failed',
      source: 'SerpAPI / Google Trends (failed)',
      sourceUrl: `https://trends.google.com/trends/explore?q=${encodeURIComponent(keywords.join(','))}`,
    });
  }
}

export async function searchAdsTransparency(advertiser: string): Promise<ToolResult<SearchResult[]>> {
  const cacheKey = `ads:${advertiser}`;
  const cached = await getCached('serpapi_search', cacheKey);
  if (cached) {
    return { ...(cached as ToolResult<SearchResult[]>), cached: true };
  }

  try {
    const raw = (await serpFetch({
      engine: 'google',
      q: `"${advertiser}" site:adstransparency.google.com OR "${advertiser}" ads`,
      num: '5',
    })) as {
      organic_results?: Array<{ title: string; link: string; snippet?: string }>;
    };

    const results: SearchResult[] = (raw.organic_results ?? []).slice(0, 5).map(r => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet ?? '',
    }));

    const result = buildToolResult<SearchResult[]>({
      data: results,
      status: results.length > 0 ? 'ok' : 'failed',
      source: 'SerpAPI / Google Ads Transparency',
    });

    await setCache('serpapi_search', cacheKey, result);
    return result;
  } catch {
    return emptySearchResult('SerpAPI / Google Ads Transparency', advertiser);
  }
}
