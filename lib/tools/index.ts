// ── Core tool functions ───────────────────────────────────────────────────────
export { searchWeb, searchNews, searchTrends, searchAdsTransparency } from './serpapi';
export { scrapePage, scrapeCompetitorPricing } from './firecrawl';
export { searchReddit, searchProductReviews, searchSubreddits } from './reddit';
export { searchHN, searchHNComments, getTechSentiment } from './hn-algolia';
export { searchMetaAds, getAdMessaging } from './meta-ads';
export { scrapeLinkedInAds, scrapeCompetitorLinkedInAds } from './linkedin-ads';
export { searchPatents, companyPatents } from './patents';

// ── Smart scraping utilities ──────────────────────────────────────────────────
export { planQueries, extractKeywords } from './query-planner';
export { assessScrapeQuality } from './scrape-quality';
export { rankUrls, deduplicateUrls, discoverUrls } from './url-discovery';
export { getPolicyForDomain, computeRetryDelay, describePolicyForLogging } from './retry-policy';
export { runScrapingWorkflow } from './scraping-workflow';

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

export type { QueryBundle, QueryPlanContext } from './query-planner';
export type { ScrapeQualityReport } from './scrape-quality';
export type { RankedUrl } from './url-discovery';
export type { RetryPolicy } from './retry-policy';
