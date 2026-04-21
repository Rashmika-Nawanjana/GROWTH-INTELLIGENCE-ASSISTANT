import { getCached, setCache } from '../supabase';
import type { ToolResult, ScrapedPage } from './types';
import { buildToolResult } from './fallback';
import { assessScrapeQuality } from './scrape-quality';
import { getPolicyForDomain, computeRetryDelay } from './retry-policy';

const BASE_URL = 'https://api.firecrawl.dev/v1';

// Extraction prompt templates by page type
const EXTRACT_PROMPTS: Record<string, string> = {
  pricing: 'Extract pricing tiers, features per tier, costs, and billing periods. Highlight any discounts or special offers.',
  features: 'Extract product features, capabilities, technical details, and key differentiators.',
  competitor: 'Extract positioning, USPs, target audience, and competitive claims.',
  review: 'Extract review ratings, sentiment, pros/cons, and buyer feedback.',
  generic: 'Extract key product information, pricing, features, and any competitive claims.',
};

/**
 * Infer extraction profile from URL to use targeted prompts.
 */
function selectExtractPrompt(url: string): string {
  const lower = url.toLowerCase();
  if (/pricing|plan|billing|cost/.test(lower)) return EXTRACT_PROMPTS.pricing;
  if (/feature|capability|docs|technical/.test(lower)) return EXTRACT_PROMPTS.features;
  if (/review|g2|capterra|comparison/.test(lower)) return EXTRACT_PROMPTS.review;
  if (/competitor|vs|alternative/.test(lower)) return EXTRACT_PROMPTS.competitor;
  return EXTRACT_PROMPTS.generic;
}

/**
 * Call Firecrawl with standard options.
 */
async function firecrwlFetch(url: string, extractPrompt: string, apiKey: string, isStrict = false): Promise<{ markdown: string; title: string } | null> {
  try {
    const res = await fetch(`${BASE_URL}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ['markdown', 'extract'],
        extract: { prompt: extractPrompt },
        ...(isStrict && { waitForSelector: 'body', onlyMainContent: true, removeTags: ['script', 'style'] }),
      }),
    });

    if (!res.ok) return null;

    const raw = await res.json() as any;
    const markdown: string = raw.data?.markdown ?? '';
    const title: string = raw.data?.metadata?.title ?? url;

    return markdown.trim().length > 50 ? { markdown, title } : null;
  } catch {
    return null;
  }
}

export async function scrapePage(url: string): Promise<ToolResult<ScrapedPage>> {
  const cacheKey = `scrape:${url}`;
  const cached = await getCached('firecrawl', cacheKey);
  if (cached) {
    return { ...(cached as ToolResult<ScrapedPage>), cached: true };
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    // Fallback: basic fetch + strip HTML
    return scrapeBasic(url);
  }

  const policy = getPolicyForDomain(url);
  const extractPrompt = selectExtractPrompt(url);
  let markdown = '';
  let title = url;
  let attemptsMade = 0;

  // ── Multi-attempt strategy with escalating fallbacks ─────────────────────
  // Attempt 1: Standard Firecrawl
  let result = await firecrwlFetch(url, extractPrompt, apiKey, false);
  attemptsMade++;

  if (!result && policy.useFirecrawlStrict && attemptsMade < policy.maxAttempts) {
    // Attempt 2: Strict Firecrawl (for flaky sites like LinkedIn)
    await new Promise(resolve => setTimeout(resolve, computeRetryDelay(attemptsMade)));
    result = await firecrwlFetch(url, extractPrompt, apiKey, true);
    attemptsMade++;
  }

  if (!result && attemptsMade < policy.maxAttempts) {
    // Attempt 3: Direct fetch fallback
    await new Promise(resolve => setTimeout(resolve, computeRetryDelay(attemptsMade)));
    result = await (async () => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthIntelBot/1.0)' },
        });
        const html = await res.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 5000);

        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
        const pageTitle = titleMatch ? titleMatch[1] : url;

        return text.trim().length > 50 ? { markdown: text, title: pageTitle } : null;
      } catch {
        return null;
      }
    })();
    attemptsMade++;
  }

  if (result) {
    markdown = result.markdown;
    title = result.title;
  }

  // ── Quality assessment ──────────────────────────────────────────────────
  const quality = assessScrapeQuality(markdown, url);

  // ── Build result with quality metadata ──────────────────────────────────
  const page: ScrapedPage = {
    url,
    title,
    markdown,
    excerpt: markdown.slice(0, 500),
  };

  // Determine status based on quality + attempts
  let status: 'ok' | 'degraded' | 'failed' = 'ok';
  let confidence = 0.85;

  if (!markdown || markdown.trim().length === 0) {
    status = 'failed';
    confidence = 0.15;
  } else if (quality.isBlockPage) {
    status = 'degraded';
    confidence = 0.35;
  } else if (!quality.isValid) {
    status = 'degraded';
    confidence = quality.qualityScore * 0.7; // cap degraded at ~0.7
  } else if (attemptsMade > 1) {
    status = 'degraded';
    confidence = 0.7; // fallback used but content ok
  }

  const result_final = buildToolResult<ScrapedPage>({
    data: page,
    status,
    source: 'Firecrawl',
    sourceUrl: url,
    confidenceOverride: confidence,
  });

  await setCache('firecrawl', cacheKey, result_final);
  return result_final;
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
