import { getCached, setCache } from '../supabase';
import type { ToolResult, ScrapedPage } from './types';
import { buildToolResult } from './fallback';

const API_KEY = process.env.FIRECRAWL_API_KEY;
const BASE_URL = 'https://api.firecrawl.dev/v1';

export async function scrapePage(url: string): Promise<ToolResult<ScrapedPage>> {
  const cacheKey = `scrape:${url}`;
  const cached = await getCached('firecrawl', cacheKey);
  if (cached) {
    return { ...(cached as ToolResult<ScrapedPage>), cached: true };
  }

  if (!API_KEY) {
    // Fallback: basic fetch + strip HTML
    return scrapeBasic(url);
  }

  const res = await fetch(`${BASE_URL}/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown', 'extract'],
      extract: {
        prompt: 'Extract key product information, pricing, features, and any competitive claims.',
      },
    }),
  });

  if (!res.ok) {
    return scrapeBasic(url);
  }

  const raw = await res.json() as any;
  const markdown: string = raw.data?.markdown ?? '';

  const page: ScrapedPage = {
    url,
    title: raw.data?.metadata?.title ?? url,
    markdown,
    excerpt: markdown.slice(0, 500),
  };

  // Empty markdown (e.g. Firecrawl hit a JS wall) = degraded, not ok.
  const status = markdown.trim().length > 50 ? 'ok' : 'degraded';
  const result = buildToolResult<ScrapedPage>({
    data: page,
    status,
    source: 'Firecrawl',
    sourceUrl: url,
  });

  await setCache('firecrawl', cacheKey, result);
  return result;
}

async function scrapeBasic(url: string): Promise<ToolResult<ScrapedPage>> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthIntelBot/1.0)' },
    });
    const html = await res.text();
    // Strip tags naively
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);

    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1] : url;

    const page: ScrapedPage = {
      url,
      title,
      markdown: text,
      excerpt: text.slice(0, 500),
    };

    return buildToolResult<ScrapedPage>({
      data: page,
      status: 'degraded',
      source: 'Direct Scrape (fallback)',
      sourceUrl: url,
    });
  } catch {
    const page: ScrapedPage = {
      url,
      title: url,
      markdown: '',
      excerpt: 'Could not scrape this page.',
    };
    return buildToolResult<ScrapedPage>({
      data: page,
      status: 'failed',
      source: 'Direct Scrape (failed)',
      sourceUrl: url,
    });
  }
}

export async function scrapeCompetitorPricing(productUrl: string): Promise<ToolResult<ScrapedPage>> {
  // Append /pricing if it looks like a root domain
  const pricingUrl = productUrl.replace(/\/$/, '') + '/pricing';
  return scrapePage(pricingUrl);
}
