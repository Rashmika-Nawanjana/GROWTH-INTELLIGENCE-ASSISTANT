/**
 * Search → rank → scrape pipeline for deeper page evidence.
 */

import type { IntelligenceDomain } from '../agents/types';
import type { ToolResult, SearchResult, ScrapedPage } from './types';
import { searchWeb, type SearchLocaleOptions } from './serpapi';
import { scrapePage } from './firecrawl';
import { discoverUrls, type RankedUrl } from './url-discovery';
import type { QueryBundle } from './query-planner';
import {
  filterRelevant,
  type RelevanceRequirements,
} from './relevance';

export type DiscoverAndScrapeOptions = {
  product: string;
  domain: IntelligenceDomain;
  competitor?: string;
  topN?: number;
  /** Extra keywords for ranking (merged into query bundle). */
  keywords?: string[];
  /** Locale bias for searchWeb (geo-aware discovery). */
  locale?: SearchLocaleOptions;
  /** When set, filter hits before ranking/scraping. */
  requirements?: RelevanceRequirements;
  /**
   * Skip a fresh search and rank/scrape these results instead
   * (used by the research planner after a discovery pass).
   */
  prefetchedResults?: SearchResult[];
};

export type DiscoverAndScrapeResult = {
  search: ToolResult<SearchResult[]>;
  ranked: RankedUrl[];
  pages: ToolResult<ScrapedPage>[];
  droppedIrrelevantCount: number;
};

function buildBundle(
  query: string,
  options: DiscoverAndScrapeOptions,
): QueryBundle {
  const keywords = [
    options.product,
    options.competitor,
    ...(options.keywords ?? []),
  ].filter((k): k is string => Boolean(k?.trim()));

  return {
    broad: query,
    targeted: query,
    hypothesis: query,
    keywords: keywords.length > 0 ? keywords : query.split(/\s+/).slice(0, 6),
    entityProbes: [],
    requiredTerms: keywords.length > 0 ? keywords : query.split(/\s+/).slice(0, 6),
  };
}

/**
 * Run searchWeb (or use prefetched results), filter by relevance, rank URLs,
 * scrape top N pages in parallel.
 */
export async function discoverAndScrape(
  query: string,
  options: DiscoverAndScrapeOptions,
): Promise<DiscoverAndScrapeResult> {
  const topN = options.topN ?? 3;
  let droppedIrrelevantCount = 0;

  let search: ToolResult<SearchResult[]>;
  if (options.prefetchedResults && options.prefetchedResults.length > 0) {
    search = {
      data: options.prefetchedResults,
      source: 'prefetch',
      timestamp: new Date().toISOString(),
      confidence: 0.7,
      status: 'ok',
      cached: false,
    };
  } else {
    search = await searchWeb(query, options.locale);
  }

  let candidates = search.data ?? [];
  if (options.requirements) {
    const { kept, dropped } = filterRelevant(candidates, options.requirements, {
      minScore: 0.25,
      limit: Math.max(topN * 3, 8),
    });
    droppedIrrelevantCount = dropped.length;
    candidates = kept;
  }

  const ranked = discoverUrls(candidates, buildBundle(query, options), topN);

  const pages = await Promise.all(ranked.map(r => scrapePage(r.url)));

  return { search, ranked, pages, droppedIrrelevantCount };
}
