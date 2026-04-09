import { getCached, setCache } from '../supabase';
import type { ToolResult, SearchResult, TrendPoint } from './types';

const BASE_URL = 'https://serpapi.com/search';
const API_KEY = process.env.SERPAPI_KEY;

class SerpError extends Error {
  constructor(message: string) { super(message); this.name = 'SerpError'; }
}

async function serpFetch(params: Record<string, string>): Promise<unknown> {
  if (!API_KEY) throw new SerpError('SERPAPI_KEY not set');
  const url = new URL(BASE_URL);
  url.searchParams.set('api_key', API_KEY);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { next: { revalidate: 0 } });
  if (!res.ok) throw new SerpError(`SerpAPI ${res.status}: ${await res.text()}`);
  return res.json();
}

// Normalized empty result — always returned on failure instead of throwing,
// so callers never need try/catch around tool calls.
function emptySearchResult(source: string, query: string): ToolResult<SearchResult[]> {
  return {
    data: [],
    source: `${source} (failed)`,
    sourceUrl: `https://google.com/search?q=${encodeURIComponent(query)}`,
    timestamp: new Date().toISOString(),
    confidence: 0,
    cached: false,
  };
}

export async function searchWeb(query: string): Promise<ToolResult<SearchResult[]>> {
  const cacheKey = `web:${query}`;
  const cached = await getCached('serpapi_search', cacheKey);
  if (cached) {
    return { ...(cached as ToolResult<SearchResult[]>), cached: true };
  }

  try {
    const raw = await serpFetch({ engine: 'google', q: query, num: '10' }) as any;

    const results: SearchResult[] = (raw.organic_results ?? []).slice(0, 8).map((r: any) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet ?? '',
      date: r.date,
    }));

    const result: ToolResult<SearchResult[]> = {
      data: results,
      source: 'SerpAPI / Google',
      sourceUrl: `https://google.com/search?q=${encodeURIComponent(query)}`,
      timestamp: new Date().toISOString(),
      confidence: 0.85,
      cached: false,
    };

    await setCache('serpapi_search', cacheKey, result);
    return result;
  } catch {
    return emptySearchResult('SerpAPI / Google', query);
  }
}

export async function searchNews(query: string): Promise<ToolResult<SearchResult[]>> {
  const cacheKey = `news:${query}`;
  const cached = await getCached('serpapi_news', cacheKey);
  if (cached) {
    return { ...(cached as ToolResult<SearchResult[]>), cached: true };
  }

  try {
    const raw = await serpFetch({ engine: 'google', q: query, tbm: 'nws', num: '10' }) as any;

    const results: SearchResult[] = (raw.news_results ?? []).slice(0, 8).map((r: any) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet ?? '',
      date: r.date,
    }));

    const result: ToolResult<SearchResult[]> = {
      data: results,
      source: 'SerpAPI / Google News',
      sourceUrl: `https://news.google.com/search?q=${encodeURIComponent(query)}`,
      timestamp: new Date().toISOString(),
      confidence: 0.9,
      cached: false,
    };

    await setCache('serpapi_news', cacheKey, result);
    return result;
  } catch {
    return emptySearchResult('SerpAPI / Google News', query);
  }
}

export async function searchTrends(keywords: string[]): Promise<ToolResult<TrendPoint[]>> {
  const cacheKey = `trends:${keywords.join(',')}`;
  const cached = await getCached('serpapi_trends', cacheKey);
  if (cached) {
    return { ...(cached as ToolResult<TrendPoint[]>), cached: true };
  }

  try {
    const raw = await serpFetch({
      engine: 'google_trends',
      q: keywords.join(','),
      data_type: 'TIMESERIES',
      date: 'today 12-m',
    }) as any;

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

    const result: ToolResult<TrendPoint[]> = {
      data: points,
      source: 'SerpAPI / Google Trends',
      sourceUrl: `https://trends.google.com/trends/explore?q=${encodeURIComponent(keywords.join(','))}`,
      timestamp: new Date().toISOString(),
      confidence: 0.8,
      cached: false,
    };

    await setCache('serpapi_trends', cacheKey, result);
    return result;
  } catch {
    return {
      data: [],
      source: 'SerpAPI / Google Trends (failed)',
      sourceUrl: `https://trends.google.com/trends/explore?q=${encodeURIComponent(keywords.join(','))}`,
      timestamp: new Date().toISOString(),
      confidence: 0,
      cached: false,
    };
  }
}

export async function searchAdsTransparency(advertiser: string): Promise<ToolResult<SearchResult[]>> {
  // Google Ads Transparency via SerpAPI
  const cacheKey = `ads:${advertiser}`;
  const cached = await getCached('serpapi_search', cacheKey);
  if (cached) {
    return { ...(cached as ToolResult<SearchResult[]>), cached: true };
  }

  try {
    const raw = await serpFetch({
      engine: 'google',
      q: `"${advertiser}" site:adstransparency.google.com OR "${advertiser}" ads`,
      num: '5',
    }) as any;

    const results: SearchResult[] = (raw.organic_results ?? []).slice(0, 5).map((r: any) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet ?? '',
    }));

    const result: ToolResult<SearchResult[]> = {
      data: results,
      source: 'SerpAPI / Google Ads Transparency',
      timestamp: new Date().toISOString(),
      confidence: 0.7,
      cached: false,
    };

    await setCache('serpapi_search', cacheKey, result);
    return result;
  } catch {
    return emptySearchResult('SerpAPI / Google Ads Transparency', advertiser);
  }
}
