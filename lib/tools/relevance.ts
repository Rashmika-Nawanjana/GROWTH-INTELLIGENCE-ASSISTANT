/**
 * Relevance scoring for search hits under geography / entity constraints.
 * Prevents generic global pages (G2 categories, Figma pricing, etc.) from
 * entering agent rawContent when a local market was requested.
 */

import type { GeographyContext } from '../agents/types';
import type { SearchResult } from './types';

export interface RelevanceRequirements {
  geography?: GeographyContext;
  category?: string;
  namedEntities?: string[];
  requiredTerms?: string[];
  product?: string;
  competitor?: string;
}

/** Known-generic pages that score zero when a geo or entity constraint exists. */
const GENERIC_PAGE_PATTERNS: RegExp[] = [
  /g2\.com\/categories\//i,
  /g2\.com\/best-software/i,
  /g2\.com\/best\//i,
  /capterra\.com\/categories\//i,
  /capterra\.com\/directory\//i,
  /figma\.com\/pricing/i,
  /salesforce\.com\/.*(pricing|agentforce)/i,
  /patents\.google\.com/i,
  /techcrunch\.com\/.*mistral/i,
];

const UNRELATED_VENDOR_HOSTS = [
  'figma.com',
  'salesforce.com',
  'adobe.com',
  'notion.so',
  'slack.com',
  'atlassian.com',
  'monday.com',
  'asana.com',
  'hubspot.com',
];

function haystack(r: Pick<SearchResult, 'title' | 'url' | 'snippet'>): string {
  return `${r.title} ${r.snippet ?? ''} ${r.url}`.toLowerCase();
}

function geoAliases(geo: GeographyContext): string[] {
  const name = geo.name.toLowerCase().trim();
  const aliases = new Set<string>([name]);
  if (geo.countryCode) aliases.add(`.${geo.countryCode.toLowerCase()}`);
  // Common expansions
  if (name.includes('sri lanka')) {
    aliases.add('sri lankan');
    aliases.add('colombo');
    aliases.add('.lk');
  }
  if (name === 'india' || name.includes('india')) {
    aliases.add('indian');
    aliases.add('.in');
  }
  return [...aliases];
}

function hasGeoMatch(
  text: string,
  url: string,
  geo: GeographyContext,
): boolean {
  const aliases = geoAliases(geo);
  if (aliases.some(a => text.includes(a) || url.toLowerCase().includes(a))) {
    return true;
  }
  // TLD match e.g. .lk
  if (geo.countryCode) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host.endsWith(`.${geo.countryCode.toLowerCase()}`)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

function isGenericPage(url: string): boolean {
  return GENERIC_PAGE_PATTERNS.some(p => p.test(url));
}

function isUnrelatedVendor(url: string, req: RelevanceRequirements): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const productSlug = req.product?.toLowerCase().replace(/\s+/g, '') ?? '';
    const competitorSlug = req.competitor?.toLowerCase().replace(/\s+/g, '') ?? '';
    return UNRELATED_VENDOR_HOSTS.some(v => {
      if (!(host === v || host.endsWith(`.${v}`))) return false;
      // Allow if the vendor name is itself the product/competitor under study
      const vendorBase = v.split('.')[0];
      return vendorBase !== productSlug && vendorBase !== competitorSlug;
    });
  } catch {
    return false;
  }
}

/**
 * Score 0–1. When geography is set, missing geo → 0 (hard fail).
 * Generic category/pricing pages → 0 under any geo or entity constraint.
 */
export function scoreRelevance(
  r: Pick<SearchResult, 'title' | 'url' | 'snippet'>,
  req: RelevanceRequirements,
): number {
  const text = haystack(r);
  const hasConstraint = Boolean(
    req.geography || (req.namedEntities && req.namedEntities.length > 0),
  );

  if (hasConstraint && isGenericPage(r.url)) return 0;
  if (hasConstraint && isUnrelatedVendor(r.url, req)) return 0;

  if (req.geography && !hasGeoMatch(text, r.url, req.geography)) {
    // Soft exception: named entity explicitly present (company page may omit country)
    const entityHit = (req.namedEntities ?? []).some(e =>
      text.includes(e.toLowerCase()),
    );
    if (!entityHit) return 0;
  }

  let score = 0.35;

  if (req.geography && hasGeoMatch(text, r.url, req.geography)) {
    score += 0.35;
  }

  for (const entity of req.namedEntities ?? []) {
    if (entity.trim() && text.includes(entity.toLowerCase())) {
      score += 0.2;
      break;
    }
  }

  const terms = [
    ...(req.requiredTerms ?? []),
    ...(req.category ? req.category.split(/[\s/]+/).filter(t => t.length > 3) : []),
    ...(req.product && req.product.length < 40 ? [req.product] : []),
  ].map(t => t.toLowerCase());

  let termHits = 0;
  for (const t of terms) {
    if (t.length > 2 && text.includes(t)) termHits++;
  }
  if (terms.length > 0) {
    score += Math.min(0.25, (termHits / Math.min(terms.length, 4)) * 0.25);
  } else {
    score += 0.1;
  }

  return Math.min(1, Number.parseFloat(score.toFixed(3)));
}

export interface FilterRelevantOptions {
  minScore?: number;
  limit?: number;
}

export function filterRelevant<T extends Pick<SearchResult, 'title' | 'url' | 'snippet'>>(
  items: T[],
  req: RelevanceRequirements,
  opts: FilterRelevantOptions = {},
): { kept: T[]; dropped: T[] } {
  const minScore = opts.minScore ?? 0.25;
  const kept: T[] = [];
  const dropped: T[] = [];

  const scored = items
    .map(item => ({ item, score: scoreRelevance(item, req) }))
    .sort((a, b) => b.score - a.score);

  for (const { item, score } of scored) {
    if (score >= minScore) kept.push(item);
    else dropped.push(item);
  }

  if (opts.limit !== undefined && kept.length > opts.limit) {
    const overflow = kept.splice(opts.limit);
    dropped.push(...overflow);
  }

  return { kept, dropped };
}

/** Build RelevanceRequirements from AgentContext-like fields. */
export function requirementsFromContext(ctx: {
  geography?: GeographyContext;
  category?: string;
  namedEntities?: string[];
  requiredTerms?: string[];
  product?: string;
  competitor?: string;
}): RelevanceRequirements {
  return {
    geography: ctx.geography,
    category: ctx.category,
    namedEntities: ctx.namedEntities,
    requiredTerms: ctx.requiredTerms,
    product: ctx.product,
    competitor: ctx.competitor,
  };
}
