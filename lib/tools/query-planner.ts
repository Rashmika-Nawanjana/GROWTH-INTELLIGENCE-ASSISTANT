// Query planner — generates intent-aware query bundles from templates.
// Each bundle has: broad query, site-filtered query, hypothesis query.
// Agents call this once per intent, then distribute queries to searchWeb.

import type { IntelligenceDomain } from '../agents/types';

export interface QueryBundle {
  broad: string;        // generic market/category query
  targeted: string;     // site-filtered or source-specific query
  hypothesis: string;   // intent/hypothesis-specific query
  keywords: string[];   // extracted key terms for URL filtering
}

export interface QueryPlanContext {
  product: string;
  competitor?: string;
  domain: IntelligenceDomain;
  query: string;
  category?: string;    // inferred category (e.g. "AI SDR", "vector database")
  audience?: string;    // inferred audience (e.g. "Series A founders")
}

function currentYears(): { year: number; nextYear: number } {
  const year = new Date().getFullYear();
  return { year, nextYear: year + 1 };
}

function compactJoin(parts: Array<string | undefined | null>): string {
  return parts
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ');
}

function normalizeCategory(ctx: QueryPlanContext): string {
  return ctx.category?.trim() || `${ctx.product} category`;
}

function normalizeCompetitor(ctx: QueryPlanContext): string {
  return ctx.competitor?.trim() || 'top competitors';
}

// Domain-specific query templates
const TEMPLATES: Record<IntelligenceDomain, (ctx: QueryPlanContext) => QueryBundle> = {
  'market-trends': (ctx) => {
    const { year, nextYear } = currentYears();
    const category = normalizeCategory(ctx);
    return {
    broad: `${ctx.product} market trends ${year} ${nextYear} growth industry`,
    targeted: `site:reddit.com OR site:indiehackers.com OR site:x.com OR site:twitter.com OR site:linkedin.com OR site:instagram.com "${ctx.product}" "${category}" trending growth`,
    hypothesis: `"${ctx.product}" OR "${category}" (accelerating OR consolidating OR emerging) adoption`,
    keywords: ['growth', 'trends', 'adoption', 'market', 'category', 'revenue', 'x.com', 'linkedin', 'instagram'],
  };
  },

  competitive: (ctx) => {
    const { year, nextYear } = currentYears();
    const competitor = normalizeCompetitor(ctx);
    return {
    broad: `${competitor} ${ctx.product} features pricing positioning`,
    targeted: `site:linkedin.com OR site:x.com OR site:twitter.com OR site:instagram.com "${competitor}" ("new feature" OR "just launched" OR positioning) ${year} ${nextYear}`,
    hypothesis: `${competitor} vs ${ctx.product} differentiation competitive advantage`,
    keywords: ['feature', 'competitor', 'pricing', 'positioning', 'launch', 'announcement', 'linkedin', 'x.com', 'instagram'],
  };
  },

  'win-loss': (ctx) => {
    const competitor = normalizeCompetitor(ctx);
    return {
    broad: `why choose ${competitor} over ${ctx.product} review comparison`,
    targeted: `site:g2.com OR site:capterra.com "${ctx.product}" review pros cons`,
    hypothesis: `buyers switching from ${ctx.product} to ${competitor} reasons`,
    keywords: ['review', 'comparison', 'alternative', 'why', 'better', 'difference'],
  };
  },

  pricing: (ctx) => {
    const competitor = normalizeCompetitor(ctx);
    const category = normalizeCategory(ctx);
    return {
    broad: `${ctx.product} pricing cost per seat willingness to pay ${competitor}`,
    targeted: `site:reddit.com OR site:x.com OR site:linkedin.com OR site:instagram.com "${ctx.product}" pricing (expensive OR cheap OR worth)`,
    hypothesis: `pricing model SaaS ${category} (ROI OR cost savings OR CAC)`,
    keywords: ['pricing', 'cost', 'willingness', 'CAC', 'ROI', 'per-seat', 'x.com', 'linkedin', 'instagram'],
  };
  },

  positioning: (ctx) => {
    const competitor = normalizeCompetitor(ctx);
    return {
    broad: `${ctx.product} messaging positioning brand USP vs ${competitor}`,
    targeted: `site:linkedin.com OR site:x.com OR site:twitter.com OR site:instagram.com "${ctx.product}" brand message positioning ("think like" OR "move like")`,
    hypothesis: `positioning gap ${ctx.product} market opportunity messaging`,
    keywords: ['positioning', 'messaging', 'USP', 'brand', 'audience', 'claim', 'x.com', 'linkedin', 'instagram'],
  };
  },

  adjacent: (ctx) => {
    const { year, nextYear } = currentYears();
    const category = normalizeCategory(ctx);
    return {
    broad: `companies disrupting ${ctx.product} category adjacent market threat ${year} ${nextYear}`,
    targeted: `site:crunchbase.com OR site:techcrunch.com "${category}" funding disruption threat`,
    hypothesis: `platform expansion AI agents threat to ${ctx.product} category`,
    keywords: ['threat', 'disruption', 'adjacent', 'platform', 'expansion', 'funding'],
  };
  },

  'execution-engine': (ctx) => {
    const category = normalizeCategory(ctx);
    return {
    broad: `${ctx.product} outreach email templates campaign copy examples`,
    targeted: `site:linkedin.com OR site:x.com OR site:instagram.com "${ctx.product}" campaign message copy best practices`,
    hypothesis: `high-performing ${category} outreach email hooks ROI angle`,
    keywords: ['outreach', 'copy', 'email', 'campaign', 'hook', 'variant', 'linkedin', 'x.com', 'instagram'],
  };
  },

  mirofish: (ctx) => {
    const { year, nextYear } = currentYears();
    const category = normalizeCategory(ctx);
    return {
      broad: `${ctx.product} forecast prediction market sizing TAM revenue projection`,
      targeted: `site:crunchbase.com OR site:techcrunch.com "${category}" market size growth projection`,
      hypothesis: `${ctx.product} category market expansion forecast ${year} ${nextYear} opportunity`,
      keywords: ['forecast', 'TAM', 'market size', 'projection', 'growth', 'opportunity'],
    };
  },

  'mirofish-live': (ctx) => {
    const { year, nextYear } = currentYears();
    const category = normalizeCategory(ctx);
    return {
      broad: `${ctx.product} forecast prediction market sizing TAM revenue projection`,
      targeted: `site:crunchbase.com OR site:techcrunch.com "${category}" market size growth projection`,
      hypothesis: `${ctx.product} category market expansion forecast ${year} ${nextYear} opportunity`,
      keywords: ['forecast', 'TAM', 'market size', 'projection', 'growth', 'opportunity'],
    };
  },
};

/**
 * Generate a query bundle for an agent's domain.
 * Uses templates + context to create 3 query variants (broad, targeted, hypothesis).
 * Agents typically run all 3 in parallel for best coverage.
 */
export function planQueries(ctx: QueryPlanContext): QueryBundle {
  const normalizedCtx: QueryPlanContext = {
    ...ctx,
    product: ctx.product.trim(),
    competitor: ctx.competitor?.trim() || undefined,
    category: ctx.category?.trim() || undefined,
    audience: ctx.audience?.trim() || undefined,
    query: compactJoin([ctx.query]).trim(),
  };
  const generator = TEMPLATES[ctx.domain];
  if (!generator) {
    // Fallback for unknown domains
    return {
      broad: normalizedCtx.query,
      targeted: `${normalizedCtx.query} site:reddit.com OR site:linkedin.com OR site:x.com OR site:twitter.com OR site:instagram.com`,
      hypothesis: `${normalizedCtx.query} (ROI OR impact OR competitive)`,
      keywords: normalizedCtx.query.split(/\s+/).slice(0, 5),
    };
  }
  return generator(normalizedCtx);
}

/**
 * Extract keywords from a query bundle for URL filtering.
 * Used downstream to rank scraped URLs by relevance before fetching.
 */
export function extractKeywords(bundle: QueryBundle): Set<string> {
  const allTerms = [
    ...bundle.keywords,
    ...bundle.broad.split(/\s+/),
    ...bundle.targeted.split(/\s+/),
    ...bundle.hypothesis.split(/\s+/),
  ]
    .map(t => t.toLowerCase())
    .filter(t => t.length > 3 && !['site', 'and', 'the', 'for', 'with', 'from'].includes(t));

  return new Set(allTerms.slice(0, 15)); // top 15 unique keywords
}
