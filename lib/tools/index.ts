// ── Core tool functions ───────────────────────────────────────────────────────
export { searchWeb, searchNews, searchTrends, searchAdsTransparency } from './serpapi';
export type { SearchLocaleOptions } from './serpapi';
export { searchSearxng, getSearxngBaseUrl, mapSearxngResults } from './searxng';
export { scrapePage, scrapeCompetitorPricing } from './firecrawl';
export { discoverAndScrape } from './discover-and-scrape';
export type { DiscoverAndScrapeResult, DiscoverAndScrapeOptions } from './discover-and-scrape';
export { isPlaywrightScrapeEnabled, scrapeWithPlaywright } from './playwright-scrape';
export { searchReddit, searchProductReviews, searchSubreddits } from './reddit';
export { searchHN, searchHNComments, getTechSentiment } from './hn-algolia';
export { searchMetaAds, getAdMessaging } from './meta-ads';
export { scrapeLinkedInAds, scrapeCompetitorLinkedInAds } from './linkedin-ads';
export { searchPatents, companyPatents } from './patents';
export { scrapeTwitterX } from './apify-twitter';
export {
  scoreRelevance,
  filterRelevant,
  requirementsFromContext,
} from './relevance';
export type { RelevanceRequirements } from './relevance';
export {
  extractCandidates,
  verifyCandidates,
  flattenVerifiedPages,
} from './candidate-discovery';

// ── Smart scraping utilities ──────────────────────────────────────────────────
export { planQueries, extractKeywords, geoQualifier } from './query-planner';
export { assessScrapeQuality } from './scrape-quality';
export { rankUrls, deduplicateUrls, discoverUrls } from './url-discovery';
export { getPolicyForDomain, computeRetryDelay, describePolicyForLogging } from './retry-policy';

// ── Source validation ────────────────────────────────────────────────────────
export { isValidSourceUrl, isTrustedSource, filterAndRankSources, filterDisplaySources } from './source-validator';

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
export type { ApifyTweet } from './apify-twitter';

export type { QueryBundle, QueryPlanContext } from './query-planner';
export type { ScrapeQualityReport } from './scrape-quality';
export type { RankedUrl } from './url-discovery';
export type { RetryPolicy } from './retry-policy';
