// Query planner — generates intent-aware query bundles from templates.
// Each bundle has: broad query, site-filtered query, hypothesis query,
// optional entity probes, and requiredTerms for relevance filtering.

import type { GeographyContext, IntelligenceDomain } from '../agents/types';
import { isPlaceholderCompetitor } from '../agents/entity-url';

export interface QueryBundle {
  broad: string;
  targeted: string;
  hypothesis: string;
  keywords: string[];
  /** Extra searches for named entities (e.g. "Govi Isuru" Sri Lanka agritech). */
  entityProbes: string[];
  /** Terms a relevant source should relate to. */
  requiredTerms: string[];
}

export interface QueryPlanContext {
  product: string;
  competitor?: string;
  domain: IntelligenceDomain;
  query: string;
  category?: string;
  audience?: string;
  geography?: GeographyContext;
  namedEntities?: string[];
  requiredTerms?: string[];
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

/** Never emit placeholder competitor strings as search terms. */
function resolveCompetitorLabel(ctx: QueryPlanContext): string {
  if (ctx.competitor?.trim() && !isPlaceholderCompetitor(ctx.competitor)) {
    return ctx.competitor.trim();
  }
  // Discovery mode: category + geography instead of "relevant competitors"
  return compactJoin([normalizeCategory(ctx), geoQualifier(ctx)]) || 'competitors';
}

export function geoQualifier(ctx: Pick<QueryPlanContext, 'geography'>): string {
  return ctx.geography?.name?.trim() || '';
}

function buildRequiredTerms(ctx: QueryPlanContext, keywords: string[]): string[] {
  const terms = [
    ...(ctx.requiredTerms ?? []),
    ...keywords,
    ctx.geography?.name,
    ctx.category,
    ctx.product,
    ...(ctx.namedEntities ?? []),
  ]
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 2)
    .map(t => t.trim());
  return [...new Set(terms)].slice(0, 12);
}

function buildEntityProbes(ctx: QueryPlanContext): string[] {
  const entities = ctx.namedEntities ?? [];
  const geo = geoQualifier(ctx);
  const category = normalizeCategory(ctx);
  return entities.slice(0, 4).map(e =>
    compactJoin([`"${e}"`, geo, category, 'platform startup company']),
  );
}

function withGeo(query: string, ctx: QueryPlanContext): string {
  const geo = geoQualifier(ctx);
  if (!geo) return query;
  if (query.toLowerCase().includes(geo.toLowerCase())) return query;
  return `${query} ${geo}`;
}

// Domain-specific query templates
const TEMPLATES: Record<IntelligenceDomain, (ctx: QueryPlanContext) => Omit<QueryBundle, 'entityProbes' | 'requiredTerms'>> = {
  'market-trends': (ctx) => {
    const { year, nextYear } = currentYears();
    const category = normalizeCategory(ctx);
    const geo = geoQualifier(ctx);
    return {
      broad: withGeo(`${ctx.product} market trends ${year} ${nextYear} growth industry`, ctx),
      targeted: compactJoin([
        `site:reddit.com OR site:indiehackers.com OR site:x.com OR site:twitter.com OR site:linkedin.com`,
        `"${ctx.product}"`,
        `"${category}"`,
        geo,
        'trending growth',
      ]),
      hypothesis: withGeo(
        `"${ctx.product}" OR "${category}" (accelerating OR consolidating OR emerging) adoption`,
        ctx,
      ),
      keywords: ['growth', 'trends', 'adoption', 'market', 'category', 'revenue', ...(geo ? [geo] : [])],
    };
  },

  competitive: (ctx) => {
    const { year, nextYear } = currentYears();
    const competitor = resolveCompetitorLabel(ctx);
    const category = normalizeCategory(ctx);
    const geo = geoQualifier(ctx);
    const discovery = isPlaceholderCompetitor(ctx.competitor);
    return {
      broad: discovery
        ? withGeo(`${category} startups companies platforms competitors`, ctx)
        : withGeo(`${competitor} ${ctx.product} features pricing positioning`, ctx),
      targeted: discovery
        ? compactJoin([
            `"${category}"`,
            geo,
            'startup OR platform OR company (agritech OR agriculture OR farming)',
          ])
        : compactJoin([
            `site:linkedin.com OR site:x.com OR site:twitter.com`,
            `"${competitor}"`,
            `("new feature" OR "just launched" OR positioning)`,
            String(year),
            String(nextYear),
            geo,
          ]),
      hypothesis: discovery
        ? withGeo(`${category} competitive landscape players comparison`, ctx)
        : withGeo(`${competitor} vs ${ctx.product} differentiation competitive advantage`, ctx),
      keywords: [
        'feature', 'competitor', 'pricing', 'positioning', 'launch',
        ...(geo ? [geo] : []),
        ...category.split(/[\s/]+/).filter(t => t.length > 3),
      ],
    };
  },

  'win-loss': (ctx) => {
    const competitor = resolveCompetitorLabel(ctx);
    const category = normalizeCategory(ctx);
    const discovery = isPlaceholderCompetitor(ctx.competitor);
    return {
      broad: discovery
        ? withGeo(`${category} buyer reviews feedback complaints`, ctx)
        : withGeo(`why choose ${competitor} over ${ctx.product} review comparison`, ctx),
      targeted: discovery
        ? withGeo(`${category} farmer review OR user feedback OR case study`, ctx)
        : `site:g2.com OR site:capterra.com "${ctx.product}" review pros cons`,
      hypothesis: discovery
        ? withGeo(`${category} switching reasons adoption barriers`, ctx)
        : withGeo(`buyers switching from ${ctx.product} to ${competitor} reasons`, ctx),
      keywords: ['review', 'comparison', 'alternative', 'why', 'better', 'difference'],
    };
  },

  pricing: (ctx) => {
    const competitor = resolveCompetitorLabel(ctx);
    const category = normalizeCategory(ctx);
    const discovery = isPlaceholderCompetitor(ctx.competitor);
    return {
      broad: discovery
        ? withGeo(`${category} pricing cost plans subscription`, ctx)
        : withGeo(`${ctx.product} pricing cost per seat willingness to pay ${competitor}`, ctx),
      targeted: discovery
        ? withGeo(`${category} pricing page OR "starting at" OR "per month" OR freemium`, ctx)
        : compactJoin([
            `site:reddit.com OR site:x.com OR site:linkedin.com`,
            `"${ctx.product}"`,
            'pricing (expensive OR cheap OR worth)',
            geoQualifier(ctx),
          ]),
      hypothesis: withGeo(`pricing model ${category} (ROI OR cost savings OR CAC)`, ctx),
      keywords: ['pricing', 'cost', 'willingness', 'CAC', 'ROI', 'plans'],
    };
  },

  positioning: (ctx) => {
    const competitor = resolveCompetitorLabel(ctx);
    const category = normalizeCategory(ctx);
    const discovery = isPlaceholderCompetitor(ctx.competitor);
    return {
      broad: discovery
        ? withGeo(`${category} messaging positioning brand USP`, ctx)
        : withGeo(`${ctx.product} messaging positioning brand USP vs ${competitor}`, ctx),
      targeted: compactJoin([
        `site:linkedin.com OR site:x.com OR site:twitter.com`,
        `"${ctx.product}"`,
        'brand message positioning',
        geoQualifier(ctx),
      ]),
      hypothesis: withGeo(`positioning gap ${ctx.product} ${category} market opportunity messaging`, ctx),
      keywords: ['positioning', 'messaging', 'USP', 'brand', 'audience', 'claim'],
    };
  },

  adjacent: (ctx) => {
    const { year, nextYear } = currentYears();
    const category = normalizeCategory(ctx);
    return {
      broad: withGeo(
        `companies disrupting ${category} adjacent market threat ${year} ${nextYear}`,
        ctx,
      ),
      targeted: withGeo(
        `site:crunchbase.com OR site:techcrunch.com "${category}" funding disruption threat`,
        ctx,
      ),
      hypothesis: withGeo(`platform expansion AI agents threat to ${category}`, ctx),
      keywords: ['threat', 'disruption', 'adjacent', 'platform', 'expansion', 'funding'],
    };
  },

  'execution-engine': (ctx) => {
    const category = normalizeCategory(ctx);
    return {
      broad: `${ctx.product} outreach email templates campaign copy examples`,
      targeted: `site:linkedin.com OR site:x.com OR site:instagram.com "${ctx.product}" campaign message copy best practices`,
      hypothesis: `high-performing ${category} outreach email hooks ROI angle`,
      keywords: ['outreach', 'copy', 'email', 'campaign', 'hook', 'variant'],
    };
  },

  mirofish: (ctx) => {
    const { year, nextYear } = currentYears();
    const category = normalizeCategory(ctx);
    return {
      broad: withGeo(`${ctx.product} forecast prediction market sizing TAM revenue projection`, ctx),
      targeted: withGeo(
        `site:crunchbase.com OR site:techcrunch.com "${category}" market size growth projection`,
        ctx,
      ),
      hypothesis: withGeo(
        `${ctx.product} category market expansion forecast ${year} ${nextYear} opportunity`,
        ctx,
      ),
      keywords: ['forecast', 'TAM', 'market size', 'projection', 'growth', 'opportunity'],
    };
  },

  'mirofish-live': (ctx) => {
    const { year, nextYear } = currentYears();
    const category = normalizeCategory(ctx);
    return {
      broad: withGeo(`${ctx.product} forecast prediction market sizing TAM revenue projection`, ctx),
      targeted: withGeo(
        `site:crunchbase.com OR site:techcrunch.com "${category}" market size growth projection`,
        ctx,
      ),
      hypothesis: withGeo(
        `${ctx.product} category market expansion forecast ${year} ${nextYear} opportunity`,
        ctx,
      ),
      keywords: ['forecast', 'TAM', 'market size', 'projection', 'growth', 'opportunity'],
    };
  },
};

/**
 * Generate a query bundle for an agent's domain.
 */
export function planQueries(ctx: QueryPlanContext): QueryBundle {
  const normalizedCtx: QueryPlanContext = {
    ...ctx,
    product: ctx.product.trim(),
    competitor: ctx.competitor?.trim() || undefined,
    category: ctx.category?.trim() || undefined,
    audience: ctx.audience?.trim() || undefined,
    query: compactJoin([ctx.query]).trim(),
    geography: ctx.geography,
    namedEntities: ctx.namedEntities,
    requiredTerms: ctx.requiredTerms,
  };
  const generator = TEMPLATES[ctx.domain];
  let base: Omit<QueryBundle, 'entityProbes' | 'requiredTerms'>;
  if (!generator) {
    base = {
      broad: withGeo(normalizedCtx.query, normalizedCtx),
      targeted: `${normalizedCtx.query} site:reddit.com OR site:linkedin.com OR site:x.com`,
      hypothesis: `${normalizedCtx.query} (ROI OR impact OR competitive)`,
      keywords: normalizedCtx.query.split(/\s+/).slice(0, 5),
    };
  } else {
    base = generator(normalizedCtx);
  }

  return {
    ...base,
    entityProbes: buildEntityProbes(normalizedCtx),
    requiredTerms: buildRequiredTerms(normalizedCtx, base.keywords),
  };
}

/**
 * Extract keywords from a query bundle for URL filtering.
 */
export function extractKeywords(bundle: QueryBundle): Set<string> {
  const allTerms = [
    ...bundle.keywords,
    ...(bundle.requiredTerms ?? []),
    ...bundle.broad.split(/\s+/),
    ...bundle.targeted.split(/\s+/),
    ...bundle.hypothesis.split(/\s+/),
  ]
    .map(t => t.toLowerCase())
    .filter(t => t.length > 3 && !['site', 'and', 'the', 'for', 'with', 'from'].includes(t));

  return new Set(allTerms.slice(0, 15));
}
