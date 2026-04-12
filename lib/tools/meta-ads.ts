import { getCached, setCache } from '../supabase';
import { scrapePage } from './firecrawl';
import type { ToolResult, MetaAd } from './types';
import { buildToolResult } from './fallback';

// ── Meta Ad Library — browser scrape via Firecrawl ───────────────────────────
// The official API only covers political/EU ads.
// The public Ad Library page covers all advertisers with no token required.

const AD_LIBRARY_BASE = 'https://www.facebook.com/ads/library';

function buildAdLibraryUrl(advertiserName: string): string {
  const params = new URLSearchParams({
    active_status: 'all',
    ad_type: 'all',
    country: 'US',
    q: advertiserName,
    search_type: 'keyword_unordered',
  });
  return `${AD_LIBRARY_BASE}/?${params}`;
}

// Extract ad copy snippets from scraped markdown
function parseAdsFromMarkdown(markdown: string, advertiserName: string): MetaAd[] {
  const ads: MetaAd[] = [];

  // Split on common ad boundary patterns in the scraped content
  const blocks = markdown
    .split(/\n{2,}/)
    .map(b => b.trim())
    .filter(b => b.length > 30 && b.length < 1000);

  blocks.slice(0, 15).forEach((block, i) => {
    // Skip nav/footer noise
    if (/cookie|privacy|terms|sign in|log in/i.test(block)) return;

    ads.push({
      id: `scraped-${i}`,
      page_name: advertiserName,
      ad_creative_body: block,
      ad_snapshot_url: buildAdLibraryUrl(advertiserName),
    });
  });

  return ads.slice(0, 8);
}

export async function searchMetaAds(
  advertiserName: string,
  _country = 'US',
  _limit = 15,
): Promise<ToolResult<MetaAd[]>> {
  const cacheKey = `meta:browser:${advertiserName}`;
  const cached = await getCached('meta_ads', cacheKey);
  if (cached) return { ...(cached as ToolResult<MetaAd[]>), cached: true };

  const url = buildAdLibraryUrl(advertiserName);

  try {
    const scraped = await scrapePage(url);
    const ads = parseAdsFromMarkdown(scraped.data.markdown, advertiserName);

    const result = buildToolResult<MetaAd[]>({
      data: ads,
      status: ads.length > 0 ? 'degraded' : 'failed',
      source: 'Meta Ad Library (browser scrape)',
      sourceUrl: url,
    });

    await setCache('meta_ads', cacheKey, result);
    return result;
  } catch {
    return buildToolResult<MetaAd[]>({
      data: [],
      status: 'failed',
      source: 'Meta Ad Library (browser scrape)',
      sourceUrl: url,
    });
  }
}

export async function getAdMessaging(advertiserName: string): Promise<string[]> {
  const result = await searchMetaAds(advertiserName);
  return result.data
    .map(ad => ad.ad_creative_body ?? ad.ad_creative_link_title ?? '')
    .filter(Boolean)
    .slice(0, 5);
}
