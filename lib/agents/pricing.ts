import { searchWeb } from '../tools/serpapi';
import { scrapeCompetitorPricing } from '../tools/firecrawl';
import { searchReddit } from '../tools/reddit';
import { planQueries } from '../tools/query-planner';
import { filterRelevant, requirementsFromContext } from '../tools/relevance';
import { extractCandidates, verifyCandidates } from '../tools/candidate-discovery';
import { generateHuggingFaceJson } from './gemini';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  PricingOutput,
  PricingTier,
  AgentSource,
  ConfidenceLevel,
  EvidenceCandidate,
} from './types';
import { scoreToLevel } from './types';
import { computeSignalQualityPenalty, extractToolResults } from '../tools/fallback';
import {
  competitorSiteUrl,
  isPlaceholderCompetitor,
  isUsableScrapePage,
  productSiteUrl,
  skippedScrapePromise,
} from './entity-url';
import { runResearchLoop } from './research-loop';
import { applyInsufficientGate, evidencePromptRules } from './evidence-gate';
import { localeFromGeography } from './search-locale';
import {
  resolveEntityProbes,
  resolveGapQueries,
  resolveSearchQueries,
} from './plan-queries';
import type { DiscoverAndScrapeResult } from '../tools/discover-and-scrape';
import type { SearchResult, ScrapedPage, ToolResult } from '../tools/types';

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext, geography, category, namedEntities, requiredTerms } = ctx;

  const competitorName =
    competitor && !isPlaceholderCompetitor(competitor) ? competitor : 'discovered competitors';
  const compUrl = competitorSiteUrl(ctx);
  const prodUrl = productSiteUrl(ctx);
  const locale = localeFromGeography(geography);
  const requirements = requirementsFromContext(ctx);

  const queryBundle = planQueries({
    product,
    competitor,
    domain: 'pricing',
    query,
    category,
    geography,
    namedEntities,
    requiredTerms,
  });

  const planned = resolveSearchQueries(ctx, [queryBundle.broad, queryBundle.targeted], 2);
  const primaryQuery = planned[0] ?? queryBundle.broad;
  const secondaryQuery = planned[1] ?? queryBundle.hypothesis;
  const entityProbes = resolveEntityProbes(ctx, queryBundle.entityProbes, 2);
  const gapQueries = resolveGapQueries(ctx, 3);

  const searchedFor = [
    primaryQuery,
    secondaryQuery,
    queryBundle.hypothesis,
    ...entityProbes,
    ...gapQueries,
  ];

  let candidates: EvidenceCandidate[] = [];

  const loop = await runResearchLoop({
    domain: 'pricing',
    requirements,
    budgetMs: 15_000,
    round1: () =>
      Promise.allSettled([
        searchWeb(primaryQuery, locale),
        compUrl ? scrapeCompetitorPricing(compUrl) : skippedScrapePromise(),
        prodUrl ? scrapeCompetitorPricing(prodUrl) : skippedScrapePromise(),
        searchReddit(queryBundle.hypothesis),
        searchWeb(secondaryQuery, locale),
        ...entityProbes.map(q =>
          searchWeb(`${q} pricing cost plans`, locale),
        ),
      ]),
    ingest: (settled, round) => {
      const sources: AgentSource[] = [];
      const rawContent: string[] = [];
      const allHits: SearchResult[] = [];

      const takeSearch = (
        result: PromiseSettledResult<unknown> | undefined,
        label: string,
        limit: number,
      ) => {
        if (!result || result.status !== 'fulfilled') return;
        const value = result.value as ToolResult<SearchResult[]>;
        if (!Array.isArray(value?.data)) return;
        const { kept } = filterRelevant(value.data, requirements, { limit, minScore: 0.25 });
        kept.forEach(r => {
          allHits.push(r);
          sources.push({ url: r.url, title: r.title, timestamp: value.timestamp, tool: 'serpapi' });
          rawContent.push(`[${label}] ${r.title}: ${r.snippet}`);
        });
      };

      const takeScrape = (
        result: PromiseSettledResult<unknown> | undefined,
        title: string,
      ) => {
        if (!result || !isUsableScrapePage(result as PromiseSettledResult<ToolResult<ScrapedPage>>)) {
          return;
        }
        const fulfilled = result as PromiseFulfilledResult<ToolResult<ScrapedPage>>;
        const page = fulfilled.value.data;
        sources.push({
          url: page.url,
          title,
          timestamp: fulfilled.value.timestamp,
          tool: 'firecrawl',
        });
        rawContent.push(`[PRICING PAGE] ${title}: ${page.excerpt}`);
      };

      if (round === 1) {
        takeSearch(settled[0], 'PRICING WEB', 5);
        takeScrape(settled[1], competitor ? `${competitor} — pricing` : 'Competitor pricing');
        takeScrape(settled[2], product.length < 50 ? `${product} — pricing` : 'Product pricing');
        if (settled[3]?.status === 'fulfilled') {
          const reddit = settled[3].value as ToolResult<Array<{
            url: string; title: string; created: string; snippet: string; sentiment?: string;
          }>>;
          (reddit.data ?? []).slice(0, 4).forEach(p => {
            sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'reddit' });
            rawContent.push(`[REDDIT PRICING] ${p.title}: ${p.snippet}`);
          });
        }
        takeSearch(settled[4], 'PRICING TARGETED', 3);
        for (let i = 5; i < settled.length; i++) {
          takeSearch(settled[i], 'ENTITY PRICING', 3);
        }
        candidates = extractCandidates(allHits, {
          geographyName: geography?.name,
          exclude: [product, competitorName],
          limit: 5,
        });
      } else {
        for (const s of settled) {
          if (s.status !== 'fulfilled') continue;
          const val = s.value as DiscoverAndScrapeResult | ToolResult<SearchResult[]>;
          if (val && 'pages' in val && Array.isArray(val.pages)) {
            val.pages.forEach(pageResult => {
              if (pageResult.status === 'failed' || !pageResult.data.markdown?.trim()) return;
              sources.push({
                url: pageResult.data.url,
                title: pageResult.data.title || 'Candidate pricing',
                timestamp: pageResult.timestamp,
                tool: 'firecrawl',
              });
              rawContent.push(`[CANDIDATE PRICING] ${pageResult.data.title}: ${pageResult.data.excerpt}`);
            });
          } else if (val && 'data' in val && Array.isArray(val.data)) {
            takeSearch(
              { status: 'fulfilled', value: val } as PromiseFulfilledResult<ToolResult<SearchResult[]>>,
              'GAP QUERY',
              4,
            );
          }
        }
      }

      return {
        sources,
        rawContent,
        toolResults: extractToolResults(settled as PromiseSettledResult<ToolResult<unknown>>[]),
        searchedFor,
        relevantSourceCount: sources.length,
        relevantHits: allHits,
        scrapedPageCount: sources.filter(s => s.tool === 'firecrawl').length,
      };
    },
    gapRound: async () => {
      if (gapQueries.length > 0) {
        const settled = await Promise.allSettled(
          gapQueries.slice(0, 2).map(q => searchWeb(q, locale)),
        );
        searchedFor.push(...gapQueries.slice(0, 2));
        return settled;
      }

      const { settled, queries } = await verifyCandidates(candidates, {
        product,
        geographyName: geography?.name,
        category: category ?? 'pricing',
        maxCandidates: 2,
        topN: 1,
      });
      searchedFor.push(...queries.map(q => `${q} pricing`));
      return settled;
    },
  });

  if (candidates.length) {
    loop.evidence = { ...loop.evidence, candidates };
  }

  const systemPrompt = `You are a pricing strategist who analyses pricing models and willingness-to-pay. Extract only concrete pricing data from signals.
${priorContext ? `\nPrior conversation context:\n${priorContext}` : ''}
${evidencePromptRules(geography, category)}`;

  const userPrompt = `Query: "${query}"
Our product: ${product}
Competitor: ${competitorName}
${geography ? `Geography: ${geography.name}` : ''}
Evidence status: ${loop.evidence.status}

Raw signals:
${loop.rawContent.join('\n') || '(no relevant pricing signals)'}

Produce JSON:
{
  "insufficientEvidence": boolean,
  "facts": string[],
  "interpretation": string[],
  "competitorPricing": [{ "tierName": string, "price": string, "features": string[], "targetSegment": string }],
  "yourPricing": [{ "tierName": string, "price": string, "features": string[], "targetSegment": string }],
  "willingnessToPay": "premium" | "mid-market" | "price-sensitive",
  "pricingSignals": string[],
  "recommendation": string,
  "synthesizedAnswer": string,
  "confidenceScore": number
}

If insufficientEvidence, leave pricing arrays empty — do NOT invent tiers or cite unrelated vendors.`;

  let parsed: Record<string, unknown> = {};
  try {
    parsed = await generateHuggingFaceJson(systemPrompt, userPrompt, {
      maxNewTokens: 1400,
      temperature: 0.2,
    });
  } catch {
    parsed = {
      insufficientEvidence: true,
      facts: [],
      interpretation: loop.evidence.gaps,
      competitorPricing: [],
      yourPricing: [],
      willingnessToPay: 'mid-market',
      pricingSignals: [],
      recommendation: '',
      confidenceScore: 0.35,
    };
  }

  const gate = applyInsufficientGate(parsed, loop.evidence);
  if (gate.insufficient) loop.evidence = { ...loop.evidence, status: 'insufficient' };

  const confScore = Number.parseFloat(
    (gate.confidenceScore * computeSignalQualityPenalty(loop.toolResults, 5)).toFixed(2),
  );
  const confidence: ConfidenceLevel = scoreToLevel(confScore);

  const output: PricingOutput = {
    agentId: 'pricing',
    domain: 'pricing',
    artifactType: 'pricing-table',
    confidence,
    confidenceScore: confScore,
    facts: gate.insufficient ? [] : (parsed.facts as string[] ?? []),
    interpretation: gate.insufficient ? loop.evidence.gaps : (parsed.interpretation as string[] ?? []),
    sources: loop.sources,
    generatedAt: new Date().toISOString(),
    competitorPricing: gate.insufficient ? [] : ((parsed.competitorPricing ?? []) as PricingTier[]),
    yourPricing: gate.insufficient ? [] : ((parsed.yourPricing ?? []) as PricingTier[]),
    willingnessToPay: (parsed.willingnessToPay as PricingOutput['willingnessToPay']) ?? 'mid-market',
    pricingSignals: gate.insufficient ? [] : (parsed.pricingSignals as string[] ?? []),
    recommendation: gate.insufficient
      ? loop.evidence.gaps[0] ?? 'Insufficient pricing evidence.'
      : (parsed.recommendation as string) ?? '',
    evidence: loop.evidence,
    toolCallCount: loop.toolCallCount,
    searchCallCount: loop.searchCallCount,
    scrapeCallCount: loop.scrapeCallCount,
    droppedIrrelevantCount: loop.droppedIrrelevantCount,
  };

  return output;
}

export const pricingAgent: AgentConfig = {
  id: 'pricing',
  name: 'Pricing Agent',
  description: 'Scrapes pricing pages and buyer discussions to map pricing models and willingness-to-pay signals.',
  run,
};
