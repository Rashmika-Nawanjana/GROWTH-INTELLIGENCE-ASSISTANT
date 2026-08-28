import { searchWeb } from '../tools/serpapi';
import { scrapePage } from '../tools/firecrawl';
import { searchReddit, searchProductReviews } from '../tools/reddit';
import { searchHN } from '../tools/hn-algolia';
import { discoverAndScrape } from '../tools/discover-and-scrape';
import { planQueries } from '../tools/query-planner';
import { filterRelevant, requirementsFromContext } from '../tools/relevance';
import { extractCandidates, verifyCandidates } from '../tools/candidate-discovery';
import { generateHuggingFaceJson } from './gemini';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  WinLossOutput,
  WinReason,
  AgentSource,
  ConfidenceLevel,
  EvidenceCandidate,
} from './types';
import { scoreToLevel } from './types';
import { computeSignalQualityPenalty, extractToolResults } from '../tools/fallback';
import { isPlaceholderCompetitor, isUsableScrapePage, skippedScrapePromise } from './entity-url';
import { runResearchLoop } from './research-loop';
import { applyInsufficientGate, evidencePromptRules } from './evidence-gate';
import { localeFromGeography } from './search-locale';
import {
  resolveEntityProbes,
  resolveGapQueries,
  resolveSearchQueries,
} from './plan-queries';
import type { SearchResult, ScrapedPage, ToolResult } from '../tools/types';

function g2ReviewsUrl(competitorBrand: string): string {
  const slug = competitorBrand.toLowerCase().replace(/\s+/g, '-');
  return `https://www.g2.com/products/${slug}/reviews`;
}

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext, geography, category, namedEntities, requiredTerms } = ctx;

  const competitorName =
    competitor && !isPlaceholderCompetitor(competitor) ? competitor : 'discovered competitors';
  const g2Url =
    !isPlaceholderCompetitor(competitor) && competitor?.trim()
      ? g2ReviewsUrl(competitor)
      : null;
  // Skip G2 scrape when geography is set — G2 rarely covers local agritech
  const useG2 = Boolean(g2Url) && !geography;

  const locale = localeFromGeography(geography);
  const requirements = requirementsFromContext(ctx);

  const queryBundle = planQueries({
    product,
    competitor,
    domain: 'win-loss',
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
    domain: 'win-loss',
    requirements,
    budgetMs: 15_000,
    round1: () =>
      Promise.allSettled([
        searchWeb(primaryQuery, locale),
        searchProductReviews(product),
        isPlaceholderCompetitor(competitor)
          ? Promise.resolve({ data: [], timestamp: new Date().toISOString(), status: 'failed' as const, source: 'skip' })
          : searchProductReviews(competitorName),
        searchHN(`${product} ${geography?.name ?? ''} review`.trim()),
        useG2 && g2Url ? scrapePage(g2Url) : skippedScrapePromise(),
        searchWeb(secondaryQuery, locale),
        discoverAndScrape(queryBundle.hypothesis, {
          product,
          competitor: competitorName,
          domain: 'win-loss',
          topN: 2,
          keywords: queryBundle.keywords,
          locale,
          requirements,
        }),
        searchReddit(queryBundle.hypothesis),
        ...entityProbes.slice(0, 1).map(q => searchWeb(`${q} review feedback`, locale)),
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
        // Reddit/HN posts may lack snippet — coerce
        const asSearch = value.data.map(r => ({
          title: r.title,
          url: r.url,
          snippet: ('snippet' in r ? String((r as SearchResult).snippet ?? '') : ''),
        }));
        const { kept } = filterRelevant(asSearch, requirements, {
          limit,
          minScore: geography ? 0.25 : 0.15,
        });
        kept.forEach(r => {
          allHits.push(r);
          const orig = value.data.find(d => d.url === r.url);
          sources.push({
            url: r.url,
            title: r.title,
            timestamp: (orig && 'created' in orig ? String((orig as { created: string }).created) : value.timestamp),
            tool,
          });
          rawContent.push(`[${label}] ${r.title}: ${r.snippet}`);
        });
      };

      if (round === 1) {
        takeSearch(settled[0], 'REVIEW SEARCH', 'serpapi', 5);
        takeSearch(settled[1], `REDDIT ${product}`, 'reddit', 4);
        takeSearch(settled[2], `REDDIT ${competitorName}`, 'reddit', 4);
        takeSearch(settled[3], 'HN', 'hn', 3);
        if (settled[4] && isUsableScrapePage(settled[4] as PromiseSettledResult<ToolResult<ScrapedPage>>) && competitor) {
          const page = (settled[4] as PromiseFulfilledResult<ToolResult<ScrapedPage>>).value.data;
          sources.push({
            url: page.url,
            title: `${competitor} — G2 reviews`,
            timestamp: (settled[4] as PromiseFulfilledResult<ToolResult<ScrapedPage>>).value.timestamp,
            tool: 'firecrawl',
          });
          rawContent.push(`[G2 REVIEWS] ${page.excerpt}`);
        }
        takeSearch(settled[5], 'SOCIAL REVIEW', 'serpapi', 3);
        if (settled[6]?.status === 'fulfilled') {
          const disc = settled[6].value as Awaited<ReturnType<typeof discoverAndScrape>>;
          disc.pages.forEach(pageResult => {
            if (pageResult.status === 'failed' || !pageResult.data.markdown?.trim()) return;
            sources.push({
              url: pageResult.data.url,
              title: pageResult.data.title || `${competitorName} review`,
              timestamp: pageResult.timestamp,
              tool: 'firecrawl',
            });
            rawContent.push(`[DISCOVERED REVIEW] ${pageResult.data.title}: ${pageResult.data.excerpt}`);
          });
          filterRelevant(disc.search.data, requirements, { limit: 5 }).kept.forEach(r => {
            allHits.push(r);
          });
        }
        takeSearch(settled[7], 'SALES REDDIT', 'reddit', 3);
        for (let i = 8; i < settled.length; i++) {
          takeSearch(settled[i], 'ENTITY REVIEW', 'serpapi', 3);
        }
        candidates = extractCandidates(allHits, {
          geographyName: geography?.name,
          exclude: [product, competitorName],
          limit: 5,
        });
      } else {
        for (const s of settled) {
          if (s.status !== 'fulfilled') continue;
          const val = s.value as Awaited<ReturnType<typeof discoverAndScrape>> | ToolResult<SearchResult[]>;
          if (val && 'pages' in val && Array.isArray(val.pages)) {
            val.pages.forEach(pageResult => {
              if (pageResult.status === 'failed' || !pageResult.data.markdown?.trim()) return;
              sources.push({
                url: pageResult.data.url,
                title: pageResult.data.title || 'Candidate',
                timestamp: pageResult.timestamp,
                tool: 'firecrawl',
              });
              rawContent.push(`[CANDIDATE REVIEW] ${pageResult.data.title}: ${pageResult.data.excerpt}`);
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
          gapQueries.slice(0, 2).map(q =>
            discoverAndScrape(q, {
              product,
              competitor: competitorName,
              domain: 'win-loss',
              topN: 1,
              keywords: queryBundle.keywords,
              locale,
              requirements,
            }),
          ),
        );
        searchedFor.push(...gapQueries.slice(0, 2));
        return settled;
      }

      const { settled, queries } = await verifyCandidates(candidates, {
        product,
        geographyName: geography?.name,
        category: category ?? 'reviews',
        maxCandidates: 2,
        topN: 1,
      });
      searchedFor.push(...queries);
      return settled;
    },
  });

  if (candidates.length) {
    loop.evidence = { ...loop.evidence, candidates };
  }

  const systemPrompt = `You are a win/loss analyst who reads buyer reviews to understand WHY deals are won or lost.
Focus on the BUYER perspective. Be specific — generic answers are useless.
${priorContext ? `\nPrior conversation context:\n${priorContext}` : ''}
${evidencePromptRules(geography, category)}`;

  const userPrompt = `Query: "${query}"
Our product: ${product}
Competitor: ${competitorName}
${geography ? `Geography: ${geography.name}` : ''}
Evidence status: ${loop.evidence.status}

Raw signals:
${(await import('@/lib/guardrails')).fenceUntrusted(loop.rawContent)}

Produce JSON:
{
  "insufficientEvidence": boolean,
  "facts": string[],
  "interpretation": string[],
  "competitorWins": [{ "reason": string, "frequency": "often" | "sometimes" | "rarely", "evidence": string }],
  "competitorLosses": [{ "reason": string, "frequency": "often" | "sometimes" | "rarely", "evidence": string }],
  "buyerSentiment": "positive" | "mixed" | "negative",
  "topSwitchTriggers": string[],
  "synthesizedAnswer": string,
  "confidenceScore": number
}

If insufficientEvidence, leave wins/losses empty — do NOT cite unrelated G2 category pages.`;

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
      competitorWins: [],
      competitorLosses: [],
      buyerSentiment: 'mixed',
      topSwitchTriggers: [],
      confidenceScore: 0.35,
    };
  }

  const gate = applyInsufficientGate(parsed, loop.evidence);
  if (gate.insufficient) loop.evidence = { ...loop.evidence, status: 'insufficient' };

  const confScore = Number.parseFloat(
    (gate.confidenceScore * computeSignalQualityPenalty(loop.toolResults, 7)).toFixed(2),
  );
  const confidence: ConfidenceLevel = scoreToLevel(confScore);

  const output: WinLossOutput = {
    agentId: 'win-loss',
    domain: 'win-loss',
    artifactType: 'win-loss-scorecard',
    confidence,
    confidenceScore: confScore,
    facts: gate.insufficient ? [] : (parsed.facts as string[] ?? []),
    interpretation: gate.insufficient ? loop.evidence.gaps : (parsed.interpretation as string[] ?? []),
    sources: loop.sources,
    generatedAt: new Date().toISOString(),
    competitor: competitorName,
    competitorWins: gate.insufficient ? [] : ((parsed.competitorWins ?? []) as WinReason[]),
    competitorLosses: gate.insufficient ? [] : ((parsed.competitorLosses ?? []) as WinReason[]),
    buyerSentiment: (parsed.buyerSentiment as WinLossOutput['buyerSentiment']) ?? 'mixed',
    topSwitchTriggers: gate.insufficient ? [] : (parsed.topSwitchTriggers as string[] ?? []),
    evidence: loop.evidence,
    toolCallCount: loop.toolCallCount,
    searchCallCount: loop.searchCallCount,
    scrapeCallCount: loop.scrapeCallCount,
    droppedIrrelevantCount: loop.droppedIrrelevantCount,
  };

  return output;
}

export const winLossAgent: AgentConfig = {
  id: 'win-loss',
  name: 'Win/Loss Agent',
  description: 'Reads G2 reviews, Reddit, and HN to surface why buyers choose one product over another.',
  run,
};
