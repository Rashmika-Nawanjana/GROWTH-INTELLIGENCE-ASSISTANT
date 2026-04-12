// Uniform health classification for every tool call.
//   ok       — primary API returned usable data
//   degraded — fallback path used (HN substituted for Reddit, raw fetch for
//              Firecrawl, browser scrape for Meta Ads API, etc.)
//   failed   — no usable data came back from either path
// Optional on the type so legacy callers still compile; computeSignalQuality
// Penalty infers status from confidence when it's missing.
export type ToolStatus = 'ok' | 'degraded' | 'failed';

export interface ToolResult<T = unknown> {
  data: T;
  source: string;
  sourceUrl?: string;
  timestamp: string;
  confidence: number; // 0-1
  status?: ToolStatus;
  cached: boolean;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  date?: string;
}

export interface TrendPoint {
  date: string;
  value: number;
  keyword: string;
}

export interface RedditPost {
  title: string;
  subreddit: string;
  score: number;
  url: string;
  snippet: string;
  created: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

export interface HNPost {
  title: string;
  url: string;
  score: number;
  author: string;
  created: string;
  commentCount: number;
}

export interface ScrapedPage {
  url: string;
  title: string;
  markdown: string;
  excerpt: string;
}

export interface AdLibraryResult {
  advertiser: string;
  adCount: number;
  platform: string;
  themes: string[];
  estimatedSpend?: string;
}

// Meta Ad Library
export interface MetaAd {
  id: string;
  page_name: string;
  ad_creative_body?: string;
  ad_creative_link_title?: string;
  ad_delivery_start_time?: string;
  spend?: { lower_bound: string; upper_bound: string };
  ad_snapshot_url?: string;
}

// LinkedIn Ad Library
export interface LinkedInAd {
  advertiser: string;
  adCopy: string;
  url: string;
}

// USPTO Patents
export interface Patent {
  patent_number: string;
  patent_title: string;
  patent_abstract: string;
  patent_date: string;
  assignee_organization?: string;
  patent_url: string;
}
