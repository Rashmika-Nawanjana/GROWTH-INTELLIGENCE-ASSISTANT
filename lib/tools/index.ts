// ── Core tool functions ───────────────────────────────────────────────────────
export { searchWeb, searchNews, searchTrends, searchAdsTransparency } from './serpapi';
export { scrapePage, scrapeCompetitorPricing } from './firecrawl';
export { searchReddit, searchProductReviews, searchSubreddits } from './reddit';
export { searchHN, searchHNComments, getTechSentiment } from './hn-algolia';
export { searchMetaAds, getAdMessaging } from './meta-ads';
export { scrapeLinkedInAds, scrapeCompetitorLinkedInAds } from './linkedin-ads';
export { searchPatents, companyPatents } from './patents';

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  ToolResult,
  SearchResult,
  TrendPoint,
  RedditPost,
  HNPost,
  ScrapedPage,
  AdLibraryResult,
  MetaAd,
  LinkedInAd,
  Patent,
} from './types';
