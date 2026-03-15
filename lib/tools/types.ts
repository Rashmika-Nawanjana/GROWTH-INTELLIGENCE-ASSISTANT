export interface ToolResult<T = unknown> {
  data: T;
  source: string;
  sourceUrl?: string;
  timestamp: string;
  confidence: number; // 0-1
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
