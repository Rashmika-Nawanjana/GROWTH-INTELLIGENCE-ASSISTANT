// URL discovery and ranking — finds relevant URLs before scraping.
// Prioritizes URLs by relevance to intent keywords before making scrape requests.

import type { SearchResult } from './types';
import { extractKeywords } from './query-planner';
import type { QueryBundle } from './query-planner';

export interface RankedUrl {
  url: string;
  title: string;
  snippet: string;
  relevanceScore: number; // 0-1 based on keyword matching
  pageType: string;       // 'pricing', 'feature', 'blog', 'comparison', 'generic'
}

/**
 * Infer page type from URL and title.
 */
function inferPageType(url: string, title: string): string {
  const combined = `${url} ${title}`.toLowerCase();

  if (/pricing|plan|cost|billing/.test(combined)) return 'pricing';
  if (/feature|capability|product/.test(combined)) return 'feature';
  if (/compare|vs|versus|alternative/.test(combined)) return 'comparison';
  if (/case\s*study|testimonial|customer|success/.test(combined)) return 'case-study';
  if (/blog|news|article|post/.test(combined)) return 'blog';
  if (/changelog|release|update|new/.test(combined)) return 'changelog';
  if (/about|company|team|career/.test(combined)) return 'company';
  if (/doc|guide|help|tutorial/.test(combined)) return 'docs';

  return 'generic';
}

/**
 * Rank URLs by relevance to keywords.
 * Returns top N URLs sorted by relevance score.
 */
export function rankUrls(
  searchResults: SearchResult[],
  queryBundle: QueryBundle,
  topN: number = 5,
): RankedUrl[] {
  const keywords = extractKeywords(queryBundle);

  const ranked: RankedUrl[] = searchResults.map(result => {
    const combined = `${result.url} ${result.title} ${result.snippet}`.toLowerCase();
    const keywordMatches = Array.from(keywords).filter(kw => combined.includes(kw)).length;
    const relevanceScore = Math.min(1, keywordMatches / Math.max(keywords.size, 1));

    // Boost score for specific page types that match domain
    let boost = 0;
    if (combined.includes('pricing') && queryBundle.keywords.some(k => k.includes('pricing'))) boost = 0.15;
    if (combined.includes('competitor') && queryBundle.keywords.some(k => k.includes('competitor'))) boost = 0.15;
    if (combined.includes('review') && queryBundle.keywords.some(k => k.includes('review'))) boost = 0.1;

    return {
      url: result.url,
      title: result.title,
      snippet: result.snippet,
      relevanceScore: Math.min(1, relevanceScore + boost),
      pageType: inferPageType(result.url, result.title),
    };
  });

  // Sort by relevance, prioritize pricing/feature/comparison pages for research queries
  ranked.sort((a, b) => {
    const aScore = a.relevanceScore + (a.pageType === 'pricing' ? 0.1 : a.pageType === 'feature' ? 0.05 : 0);
    const bScore = b.relevanceScore + (b.pageType === 'pricing' ? 0.1 : b.pageType === 'feature' ? 0.05 : 0);
    return bScore - aScore;
  });

  return ranked.slice(0, topN);
}

/**
 * Deduplicate URLs by canonical domain/path.
 * Prevents scraping the same domain multiple times.
 */
export function deduplicateUrls(urls: RankedUrl[]): RankedUrl[] {
  const seen = new Set<string>();
  const result: RankedUrl[] = [];

  for (const url of urls) {
    // Extract domain + first path component as canonical form
    const u = new URL(url.url);
    const canonical = `${u.hostname}${u.pathname.split('/').slice(0, 3).join('/')}`;

    if (!seen.has(canonical)) {
      seen.add(canonical);
      result.push(url);
    }
  }

  return result;
}

/**
 * Filter URLs to exclude obvious non-content domains.
 */
function isContentDomain(url: string): boolean {
  const excluded = [
    'youtube.com',
    'facebook.com',
    'tiktok.com',
    'pinterest.com',
    'example.com',
    'stackoverflow.com/questions',
  ];

  return !excluded.some(domain => url.includes(domain));
}

/**
 * Discover and rank URLs for scraping.
 * Given search results, return top N deduplicated, ranked URLs.
 */
export function discoverUrls(
  searchResults: SearchResult[],
  queryBundle: QueryBundle,
  topN: number = 5,
): RankedUrl[] {
  const filtered = searchResults.filter(r => isContentDomain(r.url));
  const ranked = rankUrls(filtered, queryBundle, topN * 2); // get extra, deduplicate
  const deduplicated = deduplicateUrls(ranked);
  return deduplicated.slice(0, topN);
}
