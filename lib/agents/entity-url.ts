import { buildToolResult } from '../tools/fallback';
import type { ScrapedPage, ToolResult } from '../tools/types';
import type { AgentContext } from './types';

/** Sentinel: homepage/pricing scrape skipped because competitor/product URL is unknown. */
export const SKIPPED_INFERRED_URL = 'skip-inferred-url';

export function skippedScrapePromise(): Promise<ToolResult<ScrapedPage>> {
  return Promise.resolve(
    buildToolResult<ScrapedPage>({
      data: { url: '', title: '', markdown: '', excerpt: '' },
      status: 'failed',
      source: SKIPPED_INFERRED_URL,
    }),
  );
}

export function isUsableScrapePage(
  result: PromiseSettledResult<ToolResult<ScrapedPage>>,
): result is PromiseFulfilledResult<ToolResult<ScrapedPage>> {
  if (result.status !== 'fulfilled') return false;
  const v = result.value;
  if (v.source === SKIPPED_INFERRED_URL) return false;
  const md = v.data.markdown?.trim().length ?? 0;
  return !!v.data.url && md > 40;
}

/** Classifier / fallback strings that must never become guessed .com URLs. */
const PLACEHOLDER_COMPETITOR = new Set([
  'main competitor',
  'competitor',
  'unknown',
  'n/a',
  'na',
  'none',
  'your competitor',
  'the competitor',
  'relevant competitors',
  'relevant competitor',
  'top competitors',
  'competitors',
  'peer products',
]);

const PLACEHOLDER_PRODUCT = new Set([
  'the product',
  'the current product',
  'our product',
  'your product',
  'product',
  'unknown',
  'n/a',
  'na',
]);

export function isPlaceholderCompetitor(name: string | undefined | null): boolean {
  if (!name?.trim()) return true;
  return PLACEHOLDER_COMPETITOR.has(name.toLowerCase().trim());
}

export function isPlaceholderProduct(name: string | undefined | null): boolean {
  if (!name?.trim()) return true;
  return PLACEHOLDER_PRODUCT.has(name.toLowerCase().trim());
}

/**
 * Only guess https://brand.com when we have a real competitor name from classification.
 * Otherwise return null — agents should rely on SerpAPI / Reddit / HN only.
 */
export function competitorSiteUrl(ctx: Pick<AgentContext, 'competitor' | 'competitorUrl'>): string | null {
  const explicit = ctx.competitorUrl?.trim();
  if (explicit && /^https?:\/\//i.test(explicit)) return explicit;
  if (isPlaceholderCompetitor(ctx.competitor)) return null;
  const name = ctx.competitor!.trim();
  const slug = name.toLowerCase().replace(/\s+/g, '');
  if (slug.length < 2 || slug.length > 40) return null;
  if (!/^[a-z0-9]+$/.test(slug)) return null;
  return `https://${slug}.com`;
}

/**
 * Guess product homepage only for short, brand-like names (not full sentences).
 */
export function productSiteUrl(ctx: Pick<AgentContext, 'product' | 'productUrl'>): string | null {
  const explicit = ctx.productUrl?.trim();
  if (explicit && /^https?:\/\//i.test(explicit)) return explicit;
  if (isPlaceholderProduct(ctx.product)) return null;
  const name = ctx.product!.trim();
  const words = name.split(/\s+/).length;
  if (name.length > 35 || words > 4) return null;
  const slug = name.toLowerCase().replace(/\s+/g, '');
  if (slug.length < 2 || slug.length > 40) return null;
  if (!/^[a-z0-9]+$/.test(slug)) return null;
  return `https://${slug}.com`;
}
