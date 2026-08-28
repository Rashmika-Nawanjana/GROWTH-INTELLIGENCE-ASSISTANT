/**
 * Shared discovery pre-pass + research planner (1 LLM call).
 * Runs before agent fan-out so all specialists share local entities and queries.
 */

import { searchWeb, searchNews } from '../tools/serpapi';
import { discoverAndScrape } from '../tools/discover-and-scrape';
import { planQueries } from '../tools/query-planner';
import { filterRelevant, requirementsFromContext } from '../tools/relevance';
import { extractCandidates } from '../tools/candidate-discovery';
import { generateHuggingFaceJson } from './gemini';
import { localeFromGeography } from './search-locale';
import { isPlaceholderCompetitor } from './entity-url';
import type {
  AgentContext,
  IntelligenceDomain,
  LocalEntity,
  LocalEntityType,
} from './types';
import type { SearchResult } from '../tools/types';

const RESEARCH_DOMAINS: IntelligenceDomain[] = [
  'market-trends',
  'competitive',
  'win-loss',
  'pricing',
  'positioning',
  'adjacent',
];

/** Domains that need named local players to produce useful local evidence. */
export const ENTITY_DEPENDENT_DOMAINS: IntelligenceDomain[] = [
  'pricing',
  'win-loss',
];

const GLOBAL_BRAND_BLOCKLIST = new Set([
  'figma',
  'salesforce',
  'google',
  'microsoft',
  'amazon',
  'meta',
  'openai',
  'mistral',
  'anthropic',
  'adobe',
  'oracle',
  'ibm',
  'sap',
  'hubspot',
  'g2',
  'capterra',
  'john deere',
  'agco',
  'linkedin',
  'twitter',
  'reddit',
]);

export interface ResearchPlan {
  localEntities: LocalEntity[];
  perDomainQueries: Partial<Record<IntelligenceDomain, string[]>>;
  gapQueries: string[];
  applicableDomains: IntelligenceDomain[];
  notes: string[];
  searchedFor: string[];
  scrapedCount: number;
  searchCallCount: number;
}

const EMPTY_PLAN: ResearchPlan = {
  localEntities: [],
  perDomainQueries: {},
  gapQueries: [],
  applicableDomains: [...RESEARCH_DOMAINS],
  notes: ['Discovery pre-pass returned no local entities.'],
  searchedFor: [],
  scrapedCount: 0,
  searchCallCount: 0,
};

function withBudget<T>(
  work: Promise<T>,
  budgetMs: number,
): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work.then(value => ({ ok: true as const, value })),
    new Promise<{ ok: false }>(resolve => {
      timer = setTimeout(() => resolve({ ok: false }), budgetMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function normalizeEntityType(raw: unknown): LocalEntityType {
  if (raw === 'vendor' || raw === 'government' || raw === 'research' || raw === 'unclear') {
    return raw;
  }
  return 'unclear';
}

function isBlockedBrand(name: string): boolean {
  return GLOBAL_BRAND_BLOCKLIST.has(name.toLowerCase().trim());
}

/**
 * Normalize and sanitize planner LLM output. Never invent entities;
 * drop global brands; clamp query lists.
 */
export function normalizeResearchPlan(
  raw: Record<string, unknown>,
  fallback: {
    candidates: LocalEntity[];
    searchedFor: string[];
    scrapedCount: number;
    searchCallCount: number;
  },
): ResearchPlan {
  const localEntities: LocalEntity[] = [];
  const seen = new Set<string>();

  const pushEntity = (name: string, url?: string, type?: LocalEntityType) => {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 2) return;
    if (isBlockedBrand(trimmed)) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    localEntities.push({
      name: trimmed,
      url: url?.trim() || undefined,
      type: type ?? 'unclear',
    });
  };

  if (Array.isArray(raw.localEntities)) {
    for (const item of raw.localEntities) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.name !== 'string') continue;
      pushEntity(
        obj.name,
        typeof obj.url === 'string' ? obj.url : undefined,
        normalizeEntityType(obj.type),
      );
    }
  }

  // If LLM returned nothing, keep heuristic candidates (still filtered)
  if (localEntities.length === 0) {
    for (const c of fallback.candidates) {
      pushEntity(c.name, c.url, c.type);
    }
  }

  const perDomainQueries: Partial<Record<IntelligenceDomain, string[]>> = {};
  const rawQueries = raw.perDomainQueries;
  if (rawQueries && typeof rawQueries === 'object') {
    for (const domain of RESEARCH_DOMAINS) {
      const list = (rawQueries as Record<string, unknown>)[domain];
      if (!Array.isArray(list)) continue;
      const queries = list
        .filter((q): q is string => typeof q === 'string' && q.trim().length > 3)
        .map(q => q.trim())
        .slice(0, 2);
      if (queries.length > 0) perDomainQueries[domain] = queries;
    }
  }

  const gapQueries = Array.isArray(raw.gapQueries)
    ? raw.gapQueries
        .filter((q): q is string => typeof q === 'string' && q.trim().length > 3)
        .map(q => q.trim())
        .slice(0, 4)
    : [];

  let applicableDomains: IntelligenceDomain[] = [...RESEARCH_DOMAINS];
  if (Array.isArray(raw.applicableDomains)) {
    const filtered = raw.applicableDomains.filter(
      (d): d is IntelligenceDomain =>
        typeof d === 'string' && RESEARCH_DOMAINS.includes(d as IntelligenceDomain),
    );
    if (filtered.length >= 3) applicableDomains = filtered;
  }

  // When geo-constrained and no local entities, entity-dependent domains are not applicable
  const notes = Array.isArray(raw.notes)
    ? raw.notes.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).slice(0, 6)
    : [];

  if (localEntities.length === 0) {
    notes.push('No verified local organisations found in discovery signals.');
    applicableDomains = applicableDomains.filter(
      d => !ENTITY_DEPENDENT_DOMAINS.includes(d),
    );
    // Always keep competitive / market-trends / adjacent for discovery work
    for (const keep of ['competitive', 'market-trends', 'adjacent'] as IntelligenceDomain[]) {
      if (!applicableDomains.includes(keep)) applicableDomains.push(keep);
    }
  }

  return {
    localEntities,
    perDomainQueries,
    gapQueries,
    applicableDomains,
    notes: notes.length > 0 ? notes : fallback.searchedFor.length
      ? [`Searched: ${fallback.searchedFor.slice(0, 3).join(' | ')}`]
      : EMPTY_PLAN.notes,
    searchedFor: fallback.searchedFor,
    scrapedCount: fallback.scrapedCount,
    searchCallCount: fallback.searchCallCount,
  };
}

async function runDiscoveryPass(ctx: AgentContext): Promise<{
  hits: SearchResult[];
  excerpts: string[];
  searchedFor: string[];
  scrapedCount: number;
  searchCallCount: number;
  candidates: LocalEntity[];
}> {
  const locale = localeFromGeography(ctx.geography);
  const requirements = requirementsFromContext(ctx);
  const competitor =
    ctx.competitor && !isPlaceholderCompetitor(ctx.competitor)
      ? ctx.competitor
      : undefined;

  const bundle = planQueries({
    product: ctx.product,
    competitor: competitor ?? 'relevant competitors',
    domain: 'competitive',
    query: ctx.query,
    category: ctx.category,
    geography: ctx.geography,
    namedEntities: ctx.namedEntities,
    requiredTerms: ctx.requiredTerms,
  });

  const searchedFor = [bundle.broad, bundle.targeted, bundle.hypothesis].filter(Boolean);
  let searchCallCount = 0;
  let scrapedCount = 0;

  const settled = await Promise.allSettled([
    searchWeb(bundle.broad, locale),
    searchNews(bundle.hypothesis, locale),
    searchWeb(bundle.targeted, locale),
  ]);
  searchCallCount = settled.filter(r => r.status === 'fulfilled').length;

  const hits: SearchResult[] = [];
  const excerpts: string[] = [];

  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    const value = result.value;
    if (!Array.isArray(value?.data)) continue;
    const { kept } = filterRelevant(value.data, requirements, { limit: 6, minScore: 0.25 });
    for (const hit of kept) {
      hits.push(hit);
      excerpts.push(`${hit.title}: ${hit.snippet} (${hit.url})`);
    }
  }

  // Scrape top 2 relevant URLs
  if (hits.length > 0) {
    try {
      const disc = await discoverAndScrape(bundle.broad, {
        product: ctx.product,
        competitor: competitor ?? ctx.product,
        domain: 'competitive',
        topN: 2,
        keywords: bundle.keywords,
        locale,
        requirements,
        // Reuse already-filtered hits when possible
        prefetchedResults: hits.slice(0, 8),
      });
      searchCallCount += 1; // discoverAndScrape still may search unless prefetched
      for (const page of disc.pages) {
        if (page.status === 'failed' || !page.data.markdown?.trim()) continue;
        scrapedCount += 1;
        excerpts.push(
          `[SCRAPE] ${page.data.title || page.data.url}: ${page.data.excerpt?.slice(0, 400) ?? ''}`,
        );
      }
    } catch {
      /* scrape failure is non-fatal */
    }
  }

  const heuristic = extractCandidates(hits, {
    geographyName: ctx.geography?.name,
    exclude: [ctx.product, competitor ?? '', ...(ctx.namedEntities ?? [])].filter(Boolean),
    limit: 6,
  });

  const candidates: LocalEntity[] = heuristic
    .filter(c => !isBlockedBrand(c.name))
    .map(c => ({
      name: c.name,
      url: c.url,
      type:
        c.classification === 'government'
          ? 'government'
          : c.classification === 'research'
            ? 'research'
            : c.classification === 'global'
              ? 'unclear'
              : 'vendor',
    }));

  return {
    hits,
    excerpts,
    searchedFor,
    scrapedCount,
    searchCallCount,
    candidates,
  };
}

/**
 * Build a research plan: discovery tools + one LLM call.
 * Degrades to an empty/heuristic plan if the budget is exceeded.
 */
export async function buildResearchPlan(
  ctx: AgentContext,
  options?: {
    budgetMs?: number;
    onLog?: (message: string) => void;
  },
): Promise<ResearchPlan> {
  const budgetMs = options?.budgetMs ?? 12_000;
  options?.onLog?.('Discovering local players before fan-out…');

  const raced = await withBudget(
    (async () => {
      const discovery = await runDiscoveryPass(ctx);

      options?.onLog?.(
        `Discovery found ${discovery.hits.length} relevant hits, ${discovery.candidates.length} candidate orgs…`,
      );

      const geo = ctx.geography?.name;
      const category = ctx.category ?? ctx.product;

      let parsed: Record<string, unknown> = {};
      try {
        parsed = await generateHuggingFaceJson<Record<string, unknown>>(
          `You are a research planner for a growth intelligence system. You ONLY name organisations that appear in the supplied signals. Never invent local vendors. Exclude global SaaS brands (Figma, Salesforce, G2, John Deere, OpenAI, etc.).`,
          `User intent: ${ctx.query}
Product/category focus: ${ctx.product}
${geo ? `Geography (HARD constraint): ${geo}` : 'Geography: none'}
${category ? `Category: ${category}` : ''}
Named entities from query: ${(ctx.namedEntities ?? []).join(', ') || 'none'}

Heuristic candidates (may include noise — verify against signals):
${discovery.candidates.map(c => `- ${c.name} (${c.type}) ${c.url ?? ''}`).join('\n') || '(none)'}

Discovery signals:
${discovery.excerpts.slice(0, 20).join('\n') || '(no relevant signals)'}

Return JSON:
{
  "localEntities": [{ "name": string, "url": string | null, "type": "vendor" | "government" | "research" | "unclear" }],
  "perDomainQueries": {
    "market-trends": string[],
    "competitive": string[],
    "win-loss": string[],
    "pricing": string[],
    "positioning": string[],
    "adjacent": string[]
  },
  "gapQueries": string[],
  "applicableDomains": string[],
  "notes": string[]
}

Rules:
- localEntities: only orgs clearly present in signals${geo ? ` and related to ${geo}` : ''}. Empty array if none.
- perDomainQueries: 1-2 geo-qualified search queries per domain (omit domains you cannot support).
- gapQueries: up to 3 follow-up searches if evidence is thin (e.g. specific local org + pricing page).
- applicableDomains: domains that can produce useful answers from these signals.
- notes: short gaps / caveats.`,
          { maxNewTokens: 900, temperature: 0.1 },
        );
      } catch {
        parsed = {};
      }

      return normalizeResearchPlan(parsed, {
        candidates: discovery.candidates,
        searchedFor: discovery.searchedFor,
        scrapedCount: discovery.scrapedCount,
        searchCallCount: discovery.searchCallCount,
      });
    })(),
    budgetMs,
  );

  if (!raced.ok) {
    options?.onLog?.('Research planner timed out — continuing with empty plan.');
    return {
      ...EMPTY_PLAN,
      notes: ['Discovery/planner budget exceeded; agents will use template queries.'],
    };
  }

  const plan = raced.value;
  options?.onLog?.(
    plan.localEntities.length > 0
      ? `Planner locked ${plan.localEntities.length} local entities for fan-out.`
      : 'Planner found no local entities — entity-dependent domains will skip synthesis.',
  );
  return plan;
}

/**
 * Merge a ResearchPlan into AgentContext fields shared by all agents.
 */
export function applyPlanToContext(
  ctx: AgentContext,
  plan: ResearchPlan,
  domain: IntelligenceDomain,
): AgentContext {
  const entityNames = plan.localEntities.map(e => e.name);
  const namedEntities = [
    ...new Set([...(ctx.namedEntities ?? []), ...entityNames]),
  ];
  const requiredTerms = [
    ...new Set([
      ...(ctx.requiredTerms ?? []),
      ...entityNames,
      ...(ctx.geography?.name ? [ctx.geography.name] : []),
      ...(ctx.category ? [ctx.category] : []),
    ]),
  ];

  return {
    ...ctx,
    namedEntities: namedEntities.length > 0 ? namedEntities : ctx.namedEntities,
    requiredTerms: requiredTerms.length > 0 ? requiredTerms : ctx.requiredTerms,
    discoveredEntities: plan.localEntities,
    plannedQueries: plan.perDomainQueries[domain],
    gapQueries: plan.gapQueries,
    planNotes: plan.notes,
  };
}

/** Whether a domain should skip LLM synthesis given the plan + geography. */
export function shouldSkipDomainLlm(
  domain: IntelligenceDomain,
  plan: ResearchPlan,
  geography?: AgentContext['geography'],
  product?: string,
): boolean {
  if (!geography) return false;
  if (plan.localEntities.length > 0) return false;
  if (ENTITY_DEPENDENT_DOMAINS.includes(domain)) return true;
  // Positioning without a concrete product to analyse → skip
  if (domain === 'positioning') {
    const p = (product ?? '').toLowerCase();
    if (
      !p ||
      p.includes('platform') ||
      p.includes('category') ||
      p.includes('agricultural technology') ||
      p === 'the product' ||
      p === 'the current product'
    ) {
      return true;
    }
  }
  return false;
}
