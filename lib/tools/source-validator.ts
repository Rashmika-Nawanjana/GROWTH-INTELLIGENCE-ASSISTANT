import type { AgentSource } from '@/lib/agents/types';

// ── Blocked domains ─────────────────────────────────────────────────────────
// Search-engine result pages, our own app, and generic non-source URLs that
// should never appear as cited sources in intelligence output.
const BLOCKED_DOMAINS = [
  'growth-intelligence-assistant-ai.vercel.app',
  'localhost',
  '127.0.0.1',

  // Placeholder competitor / product URL guesses (never real brands)
  'maincompetitor.com',
  'relevantcompetitors.com',
  'theproduct.com',
  'thecurrentproduct.com',
  'ourproduct.com',
  'yourproduct.com',
  'peerproducts.com',

  // Search engine result pages (not primary sources)
  'google.com/search',
  'google.com/sorry',
  'www.google.com/search',
  'bing.com/search',
  'duckduckgo.com',
  'search.yahoo.com',

  // Search aggregator / API hub pages
  'hn.algolia.com',
  'serpapi.com',

  // Social media search pages (discussion URLs are fine, search pages are not)
  'reddit.com/search',
  'www.reddit.com/search',

  // Generic non-source pages
  'facebook.com/ads/library',
  'ads.google.com',
];

// Patterns that indicate a URL is a search/hub page rather than a real source
const BLOCKED_URL_PATTERNS = [
  /^https?:\/\/(www\.)?google\.\w+\/search/i,
  /^https?:\/\/hn\.algolia\.com\/?\?/i,
  /^https?:\/\/(www\.)?reddit\.com\/search/i,
  /^https?:\/\/(www\.)?bing\.com\/search/i,
  /^https?:\/\/search\.yahoo\.com/i,
  /^https?:\/\/duckduckgo\.com\/?\?/i,
  /^https?:\/\/trends\.google\.com\/trends\/explore/i,
  /^https?:\/\/growth-intelligence-assistant/i,
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\.0\.0\.1/i,
];

// Known legitimate source domains that should always pass
const TRUSTED_DOMAINS = [
  'techcrunch.com',
  'bloomberg.com',
  'reuters.com',
  'wsj.com',
  'ft.com',
  'forbes.com',
  'hbr.org',
  'mckinsey.com',
  'bain.com',
  'bcg.com',
  'gartner.com',
  'forrester.com',
  'statista.com',
  'crunchbase.com',
  'pitchbook.com',
  'g2.com',
  'capterra.com',
  'trustradius.com',
  'producthunt.com',
  'ycombinator.com',
  'news.ycombinator.com',
  'arxiv.org',
  'github.com',
  'medium.com',
  'substack.com',
  'nytimes.com',
  'theverge.com',
  'wired.com',
  'arstechnica.com',
  'cnbc.com',
  'businessinsider.com',
  'venturebeat.com',
  'semafor.com',
  'theinformation.com',
  'protocol.com',
  'zdnet.com',
  'infoworld.com',
  'ieee.org',
  'wikipedia.org',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'reddit.com',
  'sec.gov',
  'patents.google.com',
  'uspto.gov',
];

/**
 * Returns true if the URL looks like a valid, citable source.
 * Rejects search-engine result pages, our own app URL, empty/malformed
 * strings, and other non-primary-source URLs.
 */
export function isValidSourceUrl(url: string | undefined | null): boolean {
  if (!url || typeof url !== 'string') return false;

  const trimmed = url.trim();
  if (!trimmed) return false;

  // Must start with http(s)
  if (!/^https?:\/\//i.test(trimmed)) return false;

  // Block known bad patterns
  for (const pattern of BLOCKED_URL_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Block known bad domain fragments
  try {
    const parsed = new URL(trimmed);
    const hostPath = parsed.hostname + parsed.pathname;
    for (const blocked of BLOCKED_DOMAINS) {
      if (hostPath.includes(blocked)) return false;
    }
  } catch {
    return false;
  }

  return true;
}

/**
 * Check if a source URL belongs to a known trusted domain.
 * Trusted sources get priority when deduplicating and sorting.
 */
export function isTrustedSource(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return TRUSTED_DOMAINS.some(d => hostname === d || hostname.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Validate and clean a source title.
 * Strips junk titles like "Search results for..." or empty strings.
 */
function cleanSourceTitle(title: string, url: string): string {
  if (!title || title.length < 3) {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, '');
      return hostname;
    } catch {
      return 'Source';
    }
  }

  // Strip common junk prefixes from search result titles
  const junkPrefixes = [
    /^search results for:?\s*/i,
    /^results for:?\s*/i,
    /^google search:?\s*/i,
    /^about \d+ results/i,
  ];
  let cleaned = title;
  for (const prefix of junkPrefixes) {
    cleaned = cleaned.replace(prefix, '');
  }

  return cleaned.trim() || title;
}

/**
 * Filter, deduplicate, and rank an array of AgentSource objects.
 *
 * 1. Removes invalid/blocked URLs
 * 2. Deduplicates by URL (first occurrence wins)
 * 3. Prioritises trusted domains
 * 4. Cleans titles
 * 5. Caps to `limit` results
 */
export function filterAndRankSources(
  sources: AgentSource[],
  limit = 12,
): AgentSource[] {
  const seen = new Set<string>();
  const valid: (AgentSource & { _trusted: boolean })[] = [];

  for (const s of sources) {
    if (!isValidSourceUrl(s.url)) continue;

    // Normalise URL for dedup (strip trailing slash and fragment)
    let normalised: string;
    try {
      const parsed = new URL(s.url);
      parsed.hash = '';
      normalised = parsed.toString().replace(/\/+$/, '');
    } catch {
      continue;
    }

    if (seen.has(normalised)) continue;
    seen.add(normalised);

    valid.push({
      ...s,
      title: cleanSourceTitle(s.title, s.url),
      _trusted: isTrustedSource(s.url),
    });
  }

  // Trusted sources float to the top
  valid.sort((a, b) => {
    if (a._trusted && !b._trusted) return -1;
    if (!a._trusted && b._trusted) return 1;
    return 0;
  });

  return valid.slice(0, limit).map(({ _trusted, ...rest }) => rest);
}

/**
 * Lightweight version for frontend: filter an array of { title, url } links.
 */
export function filterDisplaySources(
  sources: { title: string; url: string }[],
  limit = 12,
): { title: string; url: string }[] {
  const seen = new Set<string>();
  const valid: { title: string; url: string; trusted: boolean }[] = [];

  for (const s of sources) {
    if (!isValidSourceUrl(s.url)) continue;

    let normalised: string;
    try {
      const parsed = new URL(s.url);
      parsed.hash = '';
      normalised = parsed.toString().replace(/\/+$/, '');
    } catch {
      continue;
    }

    if (seen.has(normalised)) continue;
    seen.add(normalised);

    valid.push({
      title: cleanSourceTitle(s.title, s.url),
      url: s.url,
      trusted: isTrustedSource(s.url),
    });
  }

  valid.sort((a, b) => {
    if (a.trusted && !b.trusted) return -1;
    if (!a.trusted && b.trusted) return 1;
    return 0;
  });

  return valid.slice(0, limit).map(({ trusted, ...rest }) => rest);
}
