import { getCached, setCache } from '../supabase';
import type { ToolResult } from './types';
import { scrapePage } from './firecrawl';

export interface LinkedInAd {
  advertiser: string;
  adCopy: string;
  url: string;
}

export async function scrapeLinkedInAds(
  companyName: string
): Promise<ToolResult<LinkedInAd[]>> {
  const cacheKey = `linkedin-ads:${companyName}`;
  const cached = await getCached('linkedin_ads', cacheKey);
  if (cached) return { ...(cached as ToolResult<LinkedInAd[]>), cached: true };

  const searchUrl = `https://www.linkedin.com/ad-library/search?keywords=${encodeURIComponent(companyName)}`;

  try {
    const scraped = await scrapePage(searchUrl);
    const markdown = scraped.data.markdown ?? '';

    const ads: LinkedInAd[] = markdown
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 40 && !l.startsWith('#') && !l.startsWith('http'))
      .slice(0, 10)
      .map(line => ({ advertiser: companyName, adCopy: line, url: searchUrl }));

    const result: ToolResult<LinkedInAd[]> = {
      data: ads,
      source: 'LinkedIn Ad Library',
      sourceUrl: searchUrl,
      timestamp: new Date().toISOString(),
      confidence: ads.length > 0 ? 0.7 : 0.3,
      cached: false,
    };

    await setCache('linkedin_ads', cacheKey, result);
    return result;
  } catch {
    return {
      data: [],
      source: 'LinkedIn Ad Library (failed)',
      sourceUrl: searchUrl,
      timestamp: new Date().toISOString(),
      confidence: 0,
      cached: false,
    };
  }
}

export async function scrapeCompetitorLinkedInAds(
  competitors: string[]
): Promise<ToolResult<LinkedInAd[]>[]> {
  return Promise.all(competitors.map(c => scrapeLinkedInAds(c)));
}
