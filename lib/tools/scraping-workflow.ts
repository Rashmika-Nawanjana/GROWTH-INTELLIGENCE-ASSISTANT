// Scraping workflow helper — combines query planning, URL discovery, and scraping.
// Agents call this once to get a list of scraped pages for a research domain.

import { searchWeb } from './serpapi';
import { scrapePage } from './firecrawl';
import { planQueries, type QueryPlanContext } from './query-planner';
import { discoverUrls } from './url-discovery';
import type { ScrapedPage, ToolResult } from './types';

export interface ScrapingWorkflowResult {
  pages: ToolResult<ScrapedPage>[];
  urlsProcessed: number;
  urlsSkipped: number;
  totalContent: number;
}

/**
 * End-to-end scraping workflow:
 * 1. Plan queries (generate query bundle)
 * 2. Run all 3 queries in parallel (broad, targeted, hypothesis)
 * 3. Discover + rank URLs from combined results
 * 4. Deduplicate and scrape top N URLs
 * 5. Return list of scraped pages with quality info
 */
export async function runScrapingWorkflow(
  ctx: QueryPlanContext,
  maxUrls: number = 5,
): Promise<ScrapingWorkflowResult> {
  // Step 1: Plan queries
  const queryBundle = planQueries(ctx);

  // Step 2: Execute all 3 queries in parallel
  const [broadResults, targetedResults, hypothesisResults] = await Promise.allSettled([
    searchWeb(queryBundle.broad),
    searchWeb(queryBundle.targeted),
    searchWeb(queryBundle.hypothesis),
  ]);

  // Combine all search results
  const allSearchResults = [
    ...(broadResults.status === 'fulfilled' ? broadResults.value.data : []),
    ...(targetedResults.status === 'fulfilled' ? targetedResults.value.data : []),
    ...(hypothesisResults.status === 'fulfilled' ? hypothesisResults.value.data : []),
  ];

  // Step 3: Discover URLs
  const discoveredUrls = discoverUrls(allSearchResults, queryBundle, maxUrls);

  // Step 4: Scrape all discovered URLs in parallel
  const scrapePromises = discoveredUrls.map(ranked => scrapePage(ranked.url));
  const scrapeResults = await Promise.allSettled(scrapePromises);

  // Step 5: Collect results
  const pages: ToolResult<ScrapedPage>[] = scrapeResults
    .filter((r): r is PromiseFulfilledResult<ToolResult<ScrapedPage>> => r.status === 'fulfilled')
    .map(r => r.value);

  const urlsProcessed = discoveredUrls.length;
  const urlsSkipped = allSearchResults.length - urlsProcessed;
  const totalContent = pages.reduce((sum, p) => sum + p.data.markdown.length, 0);

  return { pages, urlsProcessed, urlsSkipped, totalContent };
}
