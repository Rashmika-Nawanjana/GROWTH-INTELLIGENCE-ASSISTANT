import { getCached, setCache } from '../supabase';
import type { ToolResult } from './types';

const BASE_URL = 'https://graph.facebook.com/v19.0/ads_archive';
const ACCESS_TOKEN = process.env.META_ADS_TOKEN ?? '';

export interface MetaAd {
  id: string;
  page_name: string;
  ad_creative_body?: string;
  ad_creative_link_title?: string;
  ad_delivery_start_time?: string;
  spend?: { lower_bound: string; upper_bound: string };
  impressions?: { lower_bound: string; upper_bound: string };
  ad_snapshot_url?: string;
}

export async function searchMetaAds(
  advertiserName: string,
  country = 'US',
  limit = 15
): Promise<ToolResult<MetaAd[]>> {
  const cacheKey = `meta:${advertiserName}:${country}`;
  const cached = await getCached('meta_ads', cacheKey);
  if (cached) return { ...(cached as ToolResult<MetaAd[]>), cached: true };

  if (!ACCESS_TOKEN) {
    return {
      data: [],
      source: 'Meta Ad Library',
      timestamp: new Date().toISOString(),
      confidence: 0,
      cached: false,
    };
  }

  const params = new URLSearchParams({
    access_token: ACCESS_TOKEN,
    search_terms: advertiserName,
    ad_type: 'ALL',
    ad_reached_countries: country,
    limit: String(limit),
    fields: 'id,page_name,ad_creative_body,ad_creative_link_title,ad_delivery_start_time,spend,impressions,ad_snapshot_url',
  });

  try {
    const res = await fetch(`${BASE_URL}?${params}`);
    if (!res.ok) throw new Error(`Meta Ad Library ${res.status}`);

    const json = await res.json() as any;
    const ads: MetaAd[] = json.data ?? [];

    const result: ToolResult<MetaAd[]> = {
      data: ads,
      source: 'Meta Ad Library',
      sourceUrl: `https://www.facebook.com/ads/library/?q=${encodeURIComponent(advertiserName)}&type=all`,
      timestamp: new Date().toISOString(),
      confidence: ads.length > 0 ? 0.85 : 0,
      cached: false,
    };

    await setCache('meta_ads', cacheKey, result);
    return result;
  } catch {
    return {
      data: [],
      source: 'Meta Ad Library',
      timestamp: new Date().toISOString(),
      confidence: 0,
      cached: false,
    };
  }
}

export async function getAdMessaging(advertiserName: string): Promise<string[]> {
  const result = await searchMetaAds(advertiserName, 'US', 10);
  return result.data
    .map(ad => ad.ad_creative_body ?? ad.ad_creative_link_title ?? '')
    .filter(Boolean)
    .slice(0, 5);
}
