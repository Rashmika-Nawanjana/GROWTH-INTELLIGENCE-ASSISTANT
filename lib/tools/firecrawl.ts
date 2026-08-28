import { getCached, setCache } from '../supabase';
import type { ToolResult, ScrapedPage } from './types';
import { buildToolResult } from './fallback';
import { assessScrapeQuality } from './scrape-quality';
import { getPolicyForDomain, computeRetryDelay } from './retry-policy';
import { isPlaywrightScrapeEnabled, scrapeWithPlaywright } from './playwright-scrape';

const BASE_URL = 'https://api.firecrawl.dev/v1';

// Extraction prompt templates by page type
const EXTRACT_PROMPTS: Record<string, string> = {
  pricing: 'Extract pricing tiers, features per tier, costs, and billing periods. Highlight any discounts or special offers.',
  features: 'Extract product features, capabilities, technical details, and key differentiators.',
  competitor: 'Extract positioning, USPs, target audience, and competitive claims.',
  review: 'Extract review ratings, sentiment, pros/cons, and buyer feedback.',
  generic: 'Extract key product information, pricing, features, and any competitive claims.',
};

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms);
  });
}

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
  try {
    const { assertSafeUrl } = await import('@/lib/guardrails');
    await assertSafeUrl(url);
  } catch {
    return buildToolResult({
      data: { url, title: '', markdown: '', excerpt: '' },
      status: 'failed',
      source: 'url-policy',
      sourceUrl: url,
      operation: 'scrapePage',
    });
  }

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
    await delay(computeRetryDelay(policy, attemptsMade));
    result = await firecrwlFetch(url, extractPrompt, apiKey, true);
    attemptsMade++;
  }

  let usedPlaywright = false;
  if (
    !result &&
    policy.useBrowserFallback &&
    isPlaywrightScrapeEnabled() &&
    attemptsMade < policy.maxAttempts
  ) {
    await delay(computeRetryDelay(policy, attemptsMade));
    const pw = await scrapeWithPlaywright(url);
    attemptsMade++;
    if (pw) {
      result = { markdown: pw.markdown, title: pw.title };
      usedPlaywright = true;
    }
  }

  if (!result && attemptsMade < policy.maxAttempts) {
    // Scrape.do (free tier — anti-bot, proxy rotation, optional JS render)
    await delay(computeRetryDelay(policy, attemptsMade));
    result = await scrapeDoFetch(url);
    attemptsMade++;
  }

  if (!result && attemptsMade < policy.maxAttempts) {
    // Smart direct fetch (rotating UA, realistic headers, structured extraction)
    await delay(computeRetryDelay(policy, attemptsMade));
    result = await smartDirectFetch(url);
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
  let sourceLabel = 'Firecrawl';

  if (!markdown || markdown.trim().length === 0) {
    status = 'failed';
    confidence = 0.15;
  } else if (quality.isBlockPage) {
    status = 'degraded';
    confidence = 0.35;
  } else if (!quality.isValid) {
    status = 'degraded';
    confidence = quality.qualityScore * 0.7; // cap degraded at ~0.7
  } else if (usedPlaywright) {
    status = 'degraded';
    confidence = 0.75;
    sourceLabel = 'Playwright';
  } else if (attemptsMade > 1) {
    status = 'degraded';
    confidence = 0.7; // fallback used but content ok
  }

  const result_final = buildToolResult<ScrapedPage>({
    data: page,
    status,
    source: sourceLabel,
    sourceUrl: url,
    confidenceOverride: confidence,
  });

  await setCache('firecrawl', cacheKey, result_final);
  return result_final;
}

// ── Scrape.do fallback (free tier: 1000 req/month, anti-bot + proxy rotation) ──
const SCRAPE_DO_BASE = 'https://api.scrape.do';

function needsJsRender(url: string): boolean {
  const spaPatterns = [
    /facebook\.com/i, /linkedin\.com/i, /twitter\.com/i, /x\.com/i,
    /app\./i, /dashboard\./i, /portal\./i,
  ];
  return spaPatterns.some(p => p.test(url));
}

async function scrapeDoFetch(url: string): Promise<{ markdown: string; title: string } | null> {
  try {
    const { assertSafeUrl } = await import('@/lib/guardrails');
    await assertSafeUrl(url);
  } catch {
    return null;
  }

  const token = process.env.SCRAPE_DO_TOKEN;
  if (!token) return null;

  try {
    const params = new URLSearchParams({
      token,
      url,
      output: 'markdown',
    });
    if (needsJsRender(url)) {
      params.set('render', 'true');
      params.set('waitUntil', 'domcontentloaded');
    }

    const res = await fetch(`${SCRAPE_DO_BASE}/?${params.toString()}`, {
      signal: AbortSignal.timeout(25_000),
    });

    if (!res.ok) return null;

    const markdown = await res.text();
    if (!markdown || markdown.trim().length < 50) return null;

    const titleMatch = markdown.match(/^#\s+(.+)$/m);
    const title = titleMatch?.[1]?.trim() || url;

    return { markdown: markdown.trim().slice(0, 8000), title };
  } catch {
    return null;
  }
}

// ── Smart direct fetch with rotating UA + structured extraction ──────────────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function extractMainContent(html: string): string {
  // Try to extract from semantic containers first
  const mainSelectors = [
    /<main[^>]*>([\s\S]*?)<\/main>/gi,
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<div[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
  ];

  for (const selector of mainSelectors) {
    const match = selector.exec(html);
    if (match?.[1] && match[1].length > 200) {
      return stripHtmlToText(match[1]);
    }
  }

  // Fallback: strip everything but remove nav/header/footer first
  const cleaned = html
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  return stripHtmlToText(cleaned);
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function smartDirectFetch(url: string): Promise<{ markdown: string; title: string } | null> {
  try {
    const { assertSafeUrl } = await import('@/lib/guardrails');
    await assertSafeUrl(url);
  } catch {
    return null;
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': randomUA(),
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return null;

    const html = await res.text();
    const text = extractMainContent(html).slice(0, 6000);

    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const metaDesc = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
    const pageTitle = titleMatch?.[1]?.trim() || url;

    if (text.length < 50) return null;

    const markdown = metaDesc?.[1]
      ? `${metaDesc[1].trim()}\n\n${text}`
      : text;

    return { markdown, title: pageTitle };
  } catch {
    return null;
  }
}

async function scrapeBasic(url: string): Promise<ToolResult<ScrapedPage>> {
  const policy = getPolicyForDomain(url);

  if (policy.useBrowserFallback && isPlaywrightScrapeEnabled()) {
    const pw = await scrapeWithPlaywright(url);
    if (pw) {
      const page: ScrapedPage = {
        url,
        title: pw.title,
        markdown: pw.markdown,
        excerpt: pw.markdown.slice(0, 500),
      };
      return buildToolResult<ScrapedPage>({
        data: page,
        status: 'degraded',
        source: 'Playwright (no Firecrawl key)',
        sourceUrl: url,
      });
    }
  }

  // Try Scrape.do first (if token available), then smart direct fetch
  const scrapeDo = await scrapeDoFetch(url);
  if (scrapeDo) {
    const page: ScrapedPage = { url, title: scrapeDo.title, markdown: scrapeDo.markdown, excerpt: scrapeDo.markdown.slice(0, 500) };
    return buildToolResult<ScrapedPage>({ data: page, status: 'degraded', source: 'Scrape.do (no Firecrawl key)', sourceUrl: url });
  }

  const direct = await smartDirectFetch(url);
  if (direct) {
    const page: ScrapedPage = { url, title: direct.title, markdown: direct.markdown, excerpt: direct.markdown.slice(0, 500) };
    return buildToolResult<ScrapedPage>({ data: page, status: 'degraded', source: 'Direct Scrape (fallback)', sourceUrl: url });
  }

  const page: ScrapedPage = { url, title: url, markdown: '', excerpt: 'Could not scrape this page.' };
  return buildToolResult<ScrapedPage>({ data: page, status: 'failed', source: 'Direct Scrape (failed)', sourceUrl: url });
}

export async function scrapeCompetitorPricing(productUrl: string): Promise<ToolResult<ScrapedPage>> {
  // Append /pricing if it looks like a root domain
  const pricingUrl = productUrl.replace(/\/$/, '') + '/pricing';
  return scrapePage(pricingUrl);
}
