import { searchWeb, searchAdsTransparency } from '../tools/serpapi';
import { scrapePage } from '../tools/firecrawl';
import { searchReddit } from '../tools/reddit';
import { planQueries } from '../tools/query-planner';
import { filterRelevant, requirementsFromContext } from '../tools/relevance';
import { extractCandidates, verifyCandidates } from '../tools/candidate-discovery';
import { generateHuggingFaceJson } from './gemini';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  PositioningOutput,
  MessagingGap,
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
import type { SearchResult, ScrapedPage, ToolResult } from '../tools/types';
import type { discoverAndScrape } from '../tools/discover-and-scrape';

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
    domain: 'positioning',
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
    domain: 'positioning',
    requirements,
    budgetMs: 15_000,
    round1: () =>
      Promise.allSettled([
        compUrl ? scrapePage(compUrl) : skippedScrapePromise(),
        prodUrl ? scrapePage(prodUrl) : skippedScrapePromise(),
        isPlaceholderCompetitor(competitor)
          ? Promise.resolve({ data: [], timestamp: new Date().toISOString(), status: 'failed' as const, source: 'skip' })
          : searchAdsTransparency(competitorName),
        searchAdsTransparency(product),
        searchWeb(primaryQuery, locale),
        searchReddit(queryBundle.hypothesis),
        searchWeb(secondaryQuery, locale),
        ...entityProbes.slice(0, 1).map(q => searchWeb(q, locale)),
      ]),
    ingest: (settled, round) => {
      const sources: AgentSource[] = [];
      const rawContent: string[] = [];
      const allHits: SearchResult[] = [];

      const takeSearch = (
        result: PromiseSettledResult<unknown> | undefined,
        label: string,
        tool: AgentSource['tool'],
        limit: number,
      ) => {
        if (!result || result.status !== 'fulfilled') return;
        const value = result.value as ToolResult<SearchResult[]>;
        if (!Array.isArray(value?.data)) return;
        const asSearch = value.data.map(r => ({
          title: r.title,
          url: r.url,
          snippet: 'snippet' in r ? String((r as SearchResult).snippet ?? '') : '',
        }));
        const { kept } = filterRelevant(asSearch, requirements, { limit, minScore: geography ? 0.25 : 0.15 });
        kept.forEach(r => {
          allHits.push(r);
          sources.push({ url: r.url, title: r.title, timestamp: value.timestamp, tool });
          rawContent.push(`[${label}] ${r.title}: ${r.snippet}`);
        });
      };

      if (round === 1) {
        if (settled[0] && isUsableScrapePage(settled[0] as PromiseSettledResult<ToolResult<ScrapedPage>>)) {
          const page = (settled[0] as PromiseFulfilledResult<ToolResult<ScrapedPage>>).value.data;
          sources.push({ url: page.url, title: competitor ? `${competitor} — homepage` : 'Competitor homepage', timestamp: (settled[0] as PromiseFulfilledResult<ToolResult<ScrapedPage>>).value.timestamp, tool: 'firecrawl' });
          rawContent.push(`[COMPETITOR HOMEPAGE] ${page.excerpt}`);
        }
        if (settled[1] && isUsableScrapePage(settled[1] as PromiseSettledResult<ToolResult<ScrapedPage>>)) {
          const page = (settled[1] as PromiseFulfilledResult<ToolResult<ScrapedPage>>).value.data;
          sources.push({ url: page.url, title: product.length < 50 ? `${product} — homepage` : 'Product homepage', timestamp: (settled[1] as PromiseFulfilledResult<ToolResult<ScrapedPage>>).value.timestamp, tool: 'firecrawl' });
          rawContent.push(`[OUR HOMEPAGE] ${page.excerpt}`);
        }
        takeSearch(settled[2], 'COMPETITOR AD', 'serpapi', 3);
        takeSearch(settled[3], 'OUR AD', 'serpapi', 3);
        takeSearch(settled[4], 'MESSAGING SEARCH', 'serpapi', 4);
        takeSearch(settled[5], 'REDDIT PERCEPTION', 'reddit', 3);
        takeSearch(settled[6], 'SOCIAL VOICE', 'serpapi', 3);
        for (let i = 7; i < settled.length; i++) takeSearch(settled[i], 'ENTITY POSITIONING', 'serpapi', 3);
        candidates = extractCandidates(allHits, { geographyName: geography?.name, exclude: [product, competitorName], limit: 5 });
      } else {
        for (const s of settled) {
          if (s.status !== 'fulfilled') continue;
          const val = s.value as Awaited<ReturnType<typeof discoverAndScrape>> | ToolResult<SearchResult[]>;
          if (val && 'pages' in val && Array.isArray(val.pages)) {
            val.pages.forEach(pageResult => {
              if (pageResult.status === 'failed' || !pageResult.data.markdown?.trim()) return;
              sources.push({ url: pageResult.data.url, title: pageResult.data.title || 'Candidate', timestamp: pageResult.timestamp, tool: 'firecrawl' });
              rawContent.push(`[CANDIDATE SITE] ${pageResult.data.title}: ${pageResult.data.excerpt}`);
            });
          } else if (val && 'data' in val && Array.isArray(val.data)) {
            takeSearch(
              { status: 'fulfilled', value: val } as PromiseFulfilledResult<ToolResult<SearchResult[]>>,
              'GAP QUERY',
              'serpapi',
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
        category: category ?? 'positioning',
        maxCandidates: 2,
        topN: 1,
      });
      searchedFor.push(...queries);
      return settled;
    },
  });

  if (candidates.length) loop.evidence = { ...loop.evidence, candidates };

  const systemPrompt = `You are a brand positioning strategist. Positioning is how you talk about what exists.
${priorContext ? `\nPrior conversation context:\n${priorContext}` : ''}
${evidencePromptRules(geography, category)}`;

  const userPrompt = `Query: "${query}"
Our product: ${product}
Competitor: ${competitorName}
${geography ? `Geography: ${geography.name}` : ''}
Evidence status: ${loop.evidence.status}

Raw signals:
${loop.rawContent.join('\n') || '(no relevant positioning signals)'}

Produce JSON:
{
  "insufficientEvidence": boolean,
  "facts": string[],
  "interpretation": string[],
  "yourPositioning": string,
  "competitorPositioning": string,
  "gaps": [{ "dimension": string, "yourMessage": string, "competitorMessage": string, "gap": string, "opportunity": string }],
  "adThemes": string[],
  "synthesizedAnswer": string,
  "confidenceScore": number
}`;

  let parsed: Record<string, unknown> = {};
  try {
    parsed = await generateHuggingFaceJson(systemPrompt, userPrompt, { maxNewTokens: 1400, temperature: 0.2 });
  } catch {
    parsed = { insufficientEvidence: true, facts: [], interpretation: loop.evidence.gaps, gaps: [], adThemes: [], confidenceScore: 0.35 };
  }

  const gate = applyInsufficientGate(parsed, loop.evidence);
  if (gate.insufficient) loop.evidence = { ...loop.evidence, status: 'insufficient' };

  const confScore = Number.parseFloat(
    (gate.confidenceScore * computeSignalQualityPenalty(loop.toolResults, 7)).toFixed(2),
  );

  const output: PositioningOutput = {
    agentId: 'positioning',
    domain: 'positioning',
    artifactType: 'positioning-gap',
    confidence: scoreToLevel(confScore),
    confidenceScore: confScore,
    facts: gate.insufficient ? [] : (parsed.facts as string[] ?? []),
    interpretation: gate.insufficient ? loop.evidence.gaps : (parsed.interpretation as string[] ?? []),
    sources: loop.sources,
    generatedAt: new Date().toISOString(),
    competitor: competitorName,
    yourPositioning: gate.insufficient ? '' : (parsed.yourPositioning as string) ?? '',
    competitorPositioning: gate.insufficient ? '' : (parsed.competitorPositioning as string) ?? '',
    gaps: gate.insufficient ? [] : ((parsed.gaps ?? []) as MessagingGap[]),
    adThemes: gate.insufficient ? [] : (parsed.adThemes as string[] ?? []),
    evidence: loop.evidence,
    toolCallCount: loop.toolCallCount,
    searchCallCount: loop.searchCallCount,
    scrapeCallCount: loop.scrapeCallCount,
    droppedIrrelevantCount: loop.droppedIrrelevantCount,
  };

  return output;
}

export const positioningAgent: AgentConfig = {
  id: 'positioning',
  name: 'Positioning Agent',
  description: 'Analyses homepages, ads, and marketing copy to surface messaging gaps and positioning opportunities.',
  run,
};
