/**
 * Extract candidate organisation names from search titles/snippets and
 * verify them via discoverAndScrape (own-site investigation).
 */

import type { SearchResult } from './types';
import type { EvidenceCandidate, CandidateClassification } from '../agents/types';
import { discoverAndScrape } from './discover-and-scrape';
import type { ToolResult } from './types';
import type { ScrapedPage } from './types';

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'best', 'top', 'new',
  'how', 'what', 'why', 'are', 'was', 'were', 'will', 'your', 'our', 'into',
  'over', 'under', 'about', 'after', 'before', 'market', 'markets', 'platform',
  'platforms', 'software', 'review', 'reviews', 'pricing', 'features', 'guide',
  'versus', 'vs', 'alternative', 'alternatives', 'company', 'companies',
  'startup', 'startups', 'global', 'report', 'analysis', 'technology',
  'technologies', 'artificial', 'intelligence', 'agriculture', 'agricultural',
]);

const GENERIC_BRANDS = new Set([
  'figma', 'salesforce', 'google', 'microsoft', 'amazon', 'meta', 'openai',
  'mistral', 'anthropic', 'adobe', 'oracle', 'ibm', 'sap', 'hubspot',
  'linkedin', 'twitter', 'reddit', 'wikipedia', 'forbes', 'techcrunch',
  'g2', 'capterra', 'crunchbase', 'john deere', 'agco',
]);

function isCapitalizedPhrase(words: string[]): boolean {
  return words.every(w => /^[A-Z][a-z0-9'+-]*$/.test(w) || /^[A-Z]{2,}$/.test(w));
}

/**
 * Pull candidate org names from titles/snippets (capitalised n-grams).
 */
export function extractCandidates(
  results: Array<Pick<SearchResult, 'title' | 'snippet' | 'url'>>,
  opts: {
    geographyName?: string;
    exclude?: string[];
    limit?: number;
  } = {},
): EvidenceCandidate[] {
  const exclude = new Set(
    (opts.exclude ?? []).map(e => e.toLowerCase().trim()).filter(Boolean),
  );
  if (opts.geographyName) exclude.add(opts.geographyName.toLowerCase());

  const counts = new Map<string, { name: string; geoHits: number; count: number; url?: string }>();

  for (const r of results) {
    const text = `${r.title} ${r.snippet ?? ''}`;
    const geoHit = opts.geographyName
      ? text.toLowerCase().includes(opts.geographyName.toLowerCase())
      : false;

    // Match 1–4 consecutive Capitalized words
    const re = /\b([A-Z][a-z0-9'+-]*(?:\s+[A-Z][a-z0-9'+-]*){0,3})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim();
      const words = name.split(/\s+/);
      if (!isCapitalizedPhrase(words)) continue;
      if (words.every(w => STOP_WORDS.has(w.toLowerCase()))) continue;
      if (words.length === 1 && STOP_WORDS.has(name.toLowerCase())) continue;
      if (GENERIC_BRANDS.has(name.toLowerCase())) continue;
      if (exclude.has(name.toLowerCase())) continue;
      if (name.length < 3 || name.length > 48) continue;

      const key = name.toLowerCase();
      const prev = counts.get(key);
      if (prev) {
        prev.count += 1;
        if (geoHit) prev.geoHits += 1;
        if (!prev.url && r.url) prev.url = r.url;
      } else {
        counts.set(key, {
          name,
          count: 1,
          geoHits: geoHit ? 1 : 0,
          url: r.url,
        });
      }
    }
  }

  const ranked = [...counts.values()]
    .map(c => ({
      ...c,
      score: c.count + c.geoHits * 2,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 5);

  return ranked.map(c => ({
    name: c.name,
    url: c.url,
    classification: classifyCandidate(c.name, c.url, opts.geographyName),
  }));
}

function classifyCandidate(
  name: string,
  url: string | undefined,
  geographyName?: string,
): CandidateClassification {
  const hay = `${name} ${url ?? ''}`.toLowerCase();
  if (/gov\.|government|ministry|department of agriculture|doa\b/.test(hay)) {
    return 'government';
  }
  if (/university|\.edu|research|institute|lab\b/.test(hay)) {
    return 'research';
  }
  if (geographyName && hay.includes(geographyName.toLowerCase())) {
    return 'potential';
  }
  if (url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (/\.(lk|in|pk|bd|np)$/.test(host) || host.includes('sri')) {
        return 'adjacent';
      }
    } catch {
      /* ignore */
    }
  }
  return 'global';
}

/**
 * Verify top candidates by searching + scraping their likely pages.
 * Returns settled tool results (discoverAndScrape per candidate) for agent ingest.
 */
export async function verifyCandidates(
  candidates: EvidenceCandidate[],
  opts: {
    product: string;
    geographyName?: string;
    category?: string;
    topN?: number;
    maxCandidates?: number;
  },
): Promise<{
  settled: PromiseSettledResult<Awaited<ReturnType<typeof discoverAndScrape>>>[];
  candidates: EvidenceCandidate[];
  queries: string[];
}> {
  const max = opts.maxCandidates ?? 3;
  const slice = candidates.slice(0, max);
  const queries: string[] = [];

  const promises = slice.map(c => {
    const q = [
      `"${c.name}"`,
      opts.geographyName,
      opts.category || 'agriculture technology',
      'platform',
    ]
      .filter(Boolean)
      .join(' ');
    queries.push(q);
    return discoverAndScrape(q, {
      product: opts.product,
      competitor: c.name,
      domain: 'competitive',
      topN: opts.topN ?? 1,
      keywords: ['agriculture', 'agritech', 'farmer', 'pricing', 'features', ...(opts.geographyName ? [opts.geographyName] : [])],
    });
  });

  const settled = await Promise.allSettled(promises);
  return { settled, candidates: slice, queries };
}

/** Flatten discoverAndScrape settled results into scraped page tool results. */
export function flattenVerifiedPages(
  settled: PromiseSettledResult<Awaited<ReturnType<typeof discoverAndScrape>>>[],
): ToolResult<ScrapedPage>[] {
  const pages: ToolResult<ScrapedPage>[] = [];
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const page of s.value.pages) {
      pages.push(page);
    }
  }
  return pages;
}
