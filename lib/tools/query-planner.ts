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

// Domain-specific query templates
const TEMPLATES: Record<IntelligenceDomain, (ctx: QueryPlanContext) => QueryBundle> = {
  'market-trends': (ctx) => ({
    broad: `${ctx.product} market trends 2025 2026 growth industry`,
    targeted: `site:reddit.com OR site:indiehackers.com "${ctx.product}" trending category growth`,
    hypothesis: `"${ctx.product}" OR "${ctx.category}" (accelerating OR consolidating OR emerging) adoption`,
    keywords: ['growth', 'trends', 'adoption', 'market', 'category', 'revenue'],
  }),

  competitive: (ctx) => ({
    broad: `${ctx.competitor || 'competitors'} ${ctx.product} features pricing positioning`,
    targeted: `site:linkedin.com "${ctx.competitor}" ("new feature" OR "just launched" OR positioning) 2025 2026`,
    hypothesis: `${ctx.competitor} vs ${ctx.product} differentiation competitive advantage`,
    keywords: ['feature', 'competitor', 'pricing', 'positioning', 'launch', 'announcement'],
  }),

  'win-loss': (ctx) => ({
    broad: `why choose ${ctx.competitor} over ${ctx.product} review comparison`,
    targeted: `site:g2.com OR site:capterra.com "${ctx.product}" review pros cons`,
    hypothesis: `buyers switching from ${ctx.product} to ${ctx.competitor} reasons`,
    keywords: ['review', 'comparison', 'alternative', 'why', 'better', 'difference'],
  }),

  pricing: (ctx) => ({
    broad: `${ctx.product} pricing cost per seat willingness to pay ${ctx.competitor}`,
    targeted: `site:reddit.com "${ctx.product}" pricing (expensive OR cheap OR worth)`,
    hypothesis: `pricing model SaaS ${ctx.category} (ROI OR cost savings OR CAC)`,
    keywords: ['pricing', 'cost', 'willingness', 'CAC', 'ROI', 'per-seat'],
  }),

  positioning: (ctx) => ({
    broad: `${ctx.product} messaging positioning brand USP vs ${ctx.competitor}`,
    targeted: `site:linkedin.com "${ctx.product}" brand message positioning ("think like" OR "move like")`,
    hypothesis: `positioning gap ${ctx.product} market opportunity messaging`,
    keywords: ['positioning', 'messaging', 'USP', 'brand', 'audience', 'claim'],
  }),

  adjacent: (ctx) => ({
    broad: `companies disrupting ${ctx.product} category adjacent market threat 2025 2026`,
    targeted: `site:crunchbase.com OR site:techcrunch.com "${ctx.category}" funding disruption threat`,
    hypothesis: `platform expansion AI agents threat to ${ctx.product} category`,
    keywords: ['threat', 'disruption', 'adjacent', 'platform', 'expansion', 'funding'],
  }),

  'execution-engine': (ctx) => ({
    broad: `${ctx.product} outreach email templates campaign copy examples`,
    targeted: `site:linkedin.com "${ctx.product}" campaign message copy best practices`,
    hypothesis: `high-performing ${ctx.category} outreach email hooks ROI angle`,
    keywords: ['outreach', 'copy', 'email', 'campaign', 'hook', 'variant'],
  }),

  mirofish: (ctx) => ({
    broad: `${ctx.product} forecast prediction market sizing TAM revenue projection`,
    targeted: `site:crunchbase.com OR site:techcrunch.com "${ctx.category}" market size growth projection`,
    hypothesis: `${ctx.product} category market expansion forecast 2026 2027 opportunity`,
    keywords: ['forecast', 'TAM', 'market size', 'projection', 'growth', 'opportunity'],
  }),
};

/**
 * Generate a query bundle for an agent's domain.
 * Uses templates + context to create 3 query variants (broad, targeted, hypothesis).
 * Agents typically run all 3 in parallel for best coverage.
 */
export function planQueries(ctx: QueryPlanContext): QueryBundle {
  const generator = TEMPLATES[ctx.domain];
  if (!generator) {
    // Fallback for unknown domains
    return {
      broad: ctx.query,
      targeted: `${ctx.query} site:reddit.com OR site:linkedin.com`,
      hypothesis: `${ctx.query} (ROI OR impact OR competitive)`,
      keywords: ctx.query.split(/\s+/).slice(0, 5),
    };
  }
  return generator(ctx);
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
