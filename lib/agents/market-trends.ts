import { searchWeb, searchNews, searchTrends } from '../tools/serpapi';
import { searchHN, getTechSentiment } from '../tools/hn-algolia';
import { searchReddit } from '../tools/reddit';
import { scrapeTwitterX } from '../tools/apify-twitter';
import { planQueries } from '../tools/query-planner';
import { filterRelevant, requirementsFromContext } from '../tools/relevance';
import { extractCandidates, verifyCandidates } from '../tools/candidate-discovery';
import { generateHuggingFaceJson } from './gemini';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  MarketTrendsOutput,
  TrendDataPoint,
  AgentSource,
  ConfidenceLevel,
  EvidenceCandidate,
} from './types';
import { scoreToLevel } from './types';
import { computeSignalQualityPenalty, extractToolResults } from '../tools/fallback';
import { runResearchLoop } from './research-loop';
import { applyInsufficientGate, evidencePromptRules } from './evidence-gate';
import { localeFromGeography } from './search-locale';
import {
  resolveEntityProbes,
  resolveGapQueries,
  resolveSearchQueries,
} from './plan-queries';
import type { SearchResult, ToolResult } from '../tools/types';
import type { discoverAndScrape } from '../tools/discover-and-scrape';

function isSocialUrl(url: string): boolean {
  return /(?:^|\/\/)(?:www\.)?(x\.com|twitter\.com|linkedin\.com|instagram\.com)\//i.test(url);
}

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext, geography, category, namedEntities, requiredTerms } = ctx;

  const locale = localeFromGeography(geography);
  const requirements = requirementsFromContext(ctx);

  const queryBundle = planQueries({
    product,
    competitor,
    domain: 'market-trends',
    query,
    category: category ?? (query.toLowerCase().includes('ai') ? 'AI/ML' : 'SaaS'),
    geography,
    namedEntities,
    requiredTerms,
  });

  const planned = resolveSearchQueries(ctx, [queryBundle.broad, queryBundle.targeted], 2);
  const primaryQuery = planned[0] ?? queryBundle.broad;
  const secondaryQuery = planned[1] ?? queryBundle.hypothesis;
  const entityProbes = resolveEntityProbes(ctx, queryBundle.entityProbes, 2);
  const gapQueries = resolveGapQueries(ctx, 3);

  const trendKeywords = [product, competitor, geography?.name].filter(Boolean) as string[];
  const searchedFor = [
    primaryQuery,
    secondaryQuery,
    queryBundle.hypothesis,
    ...entityProbes,
    ...gapQueries,
  ];
  let candidates: EvidenceCandidate[] = [];

  const loop = await runResearchLoop({
    domain: 'market-trends',
    requirements,
    budgetMs: 15_000,
    round1: () =>
      Promise.allSettled([
        searchWeb(primaryQuery, locale),
        searchNews(
          `${product}${competitor ? ` ${competitor}` : ''}${geography ? ` ${geography.name}` : ''} market growth revenue funding`,
          locale,
        ),
        searchTrends(trendKeywords.slice(0, 5)),
        getTechSentiment(product),
        searchReddit(queryBundle.hypothesis),
        searchWeb(secondaryQuery, locale),
        searchWeb(queryBundle.hypothesis, locale),
        searchWeb(
          `${product}${competitor ? ` ${competitor}` : ''}${geography ? ` ${geography.name}` : ''} site:x.com OR site:twitter.com OR site:linkedin.com trend launch`,
          locale,
        ),
        scrapeTwitterX([primaryQuery, secondaryQuery], {
          maxItems: 60,
          sort: 'Latest',
          language: locale?.hl ?? 'en',
        }),
        ...entityProbes.map(q => searchWeb(q, locale)),
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
        minScore = geography ? 0.25 : 0.15,
      ) => {
        if (!result || result.status !== 'fulfilled') return;
        const value = result.value as ToolResult<SearchResult[]>;
        if (!Array.isArray(value?.data)) return;
        const asSearch = value.data.map(r => ({
          title: r.title,
          url: r.url,
          snippet: 'snippet' in r ? String((r as SearchResult).snippet ?? '') : '',
        }));
        const { kept } = filterRelevant(asSearch, requirements, { limit, minScore });
        kept.forEach(r => {
          allHits.push(r);
          sources.push({ url: r.url, title: r.title, timestamp: value.timestamp, tool });
          rawContent.push(`[${label}] ${r.title}: ${r.snippet}`);
        });
      };

      if (round === 1) {
        takeSearch(settled[0], 'WEB BROAD', 'serpapi', 3);
        takeSearch(settled[1], 'NEWS', 'serpapi', 4);
        if (settled[2]?.status === 'fulfilled') {
          const trends = settled[2].value as ToolResult<Array<{ keyword: string; date: string; value: number }>>;
          if (trends.sourceUrl) {
            sources.push({ url: trends.sourceUrl, title: 'Google Trends', timestamp: trends.timestamp, tool: 'serpapi' });
          }
          const summary = (trends.data ?? []).slice(0, 10).map(p => `${p.keyword}@${p.date}=${p.value}`).join(', ');
          if (summary) rawContent.push(`[TRENDS] ${summary}`);
        }
        if (settled[3]?.status === 'fulfilled') {
          const hn = settled[3].value as { hnResult: ToolResult<Array<{ url: string; title: string; created: string }>>; summary: string };
          hn.hnResult?.data?.slice(0, 3).forEach(p => {
            sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'hn' });
          });
          if (hn.summary) rawContent.push(`[HN SENTIMENT] ${hn.summary}`);
        }
        takeSearch(settled[4], 'REDDIT', 'reddit', 3);
        takeSearch(settled[5], 'WEB TARGETED', 'serpapi', 2);
        takeSearch(settled[6], 'WEB HYPOTHESIS', 'serpapi', 2);
        takeSearch(settled[7], 'SOCIAL PULSE', 'serpapi', 3);
        if (settled[8]?.status === 'fulfilled') {
          const tw = settled[8].value as ToolResult<Array<{ url: string; authorHandle?: string; text: string; createdAt?: string; likeCount?: number }>>;
          (tw.data ?? []).slice(0, 6).forEach(t => {
            sources.push({
              url: t.url,
              title: `X @${t.authorHandle ?? 'unknown'}`,
              timestamp: t.createdAt ?? tw.timestamp,
              tool: 'apify',
            });
            rawContent.push(`[APIFY X] @${t.authorHandle ?? 'unknown'}: ${t.text}`);
          });
        }
        for (let i = 9; i < settled.length; i++) takeSearch(settled[i], 'ENTITY TREND', 'serpapi', 3);

        // Social backfill if no social URLs (only when no geo — geo queries need local sources)
        if (!geography && !sources.some(s => isSocialUrl(s.url))) {
          // handled in gapRound when thin
        }

        candidates = extractCandidates(allHits, {
          geographyName: geography?.name,
          exclude: [product, competitor ?? ''],
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
              rawContent.push(`[CANDIDATE] ${pageResult.data.title}: ${pageResult.data.excerpt}`);
            });
          } else if (val && 'data' in val && Array.isArray(val.data)) {
            takeSearch(
              { status: 'fulfilled', value: val } as PromiseFulfilledResult<ToolResult<SearchResult[]>>,
              'GAP FILL',
              'serpapi',
              3,
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
    gapRound: async (state) => {
      if (gapQueries.length > 0) {
        const settled = await Promise.allSettled(
          gapQueries.slice(0, 2).map(q => searchWeb(q, locale)),
        );
        searchedFor.push(...gapQueries.slice(0, 2));
        return settled;
      }

      if (geography && candidates.length > 0) {
        const { settled, queries } = await verifyCandidates(candidates, {
          product,
          geographyName: geography.name,
          category: category ?? 'market',
          maxCandidates: 2,
          topN: 1,
        });
        searchedFor.push(...queries);
        return settled;
      }
      // Social backfill for non-geo thin results
      const backfill = await Promise.allSettled([
        searchWeb(`site:linkedin.com "${product}"${geography ? ` "${geography.name}"` : ''} announcement OR market`, locale),
        searchWeb(entityProbes[0] ?? queryBundle.hypothesis, locale),
      ]);
      searchedFor.push('social/entity backfill');
      return backfill;
    },
  });

  if (candidates.length) loop.evidence = { ...loop.evidence, candidates };

  const systemPrompt = `You are a senior market intelligence analyst. Separate FACTS from INTERPRETATION. Never hallucinate.
${priorContext ? `\nPrior conversation context:\n${priorContext}` : ''}
${evidencePromptRules(geography, category)}`;

  const userPrompt = `Query: "${query}"
Product: ${product}
${competitor ? `Competitor: ${competitor}` : ''}
${geography ? `Geography: ${geography.name}` : ''}
Evidence status: ${loop.evidence.status}

Raw signals:
${loop.rawContent.join('\n') || '(no relevant market signals)'}

Produce JSON:
{
  "insufficientEvidence": boolean,
  "facts": string[],
  "interpretation": string[],
  "trends": [{ "keyword": string, "direction": "up" | "down" | "flat", "changePercent": number, "signal": string, "source": string }],
  "categoryOutlook": "accelerating" | "consolidating" | "maturing" | "emerging",
  "keySignals": string[],
  "timeHorizon": string,
  "synthesizedAnswer": string,
  "confidenceScore": number
}

If geography is set and signals are only global market-size blogs, set insufficientEvidence true for local claims — you may note global context separately in interpretation.`;

  let parsed: Record<string, unknown> = {};
  try {
    parsed = await generateHuggingFaceJson(systemPrompt, userPrompt, { maxNewTokens: 1400, temperature: 0.2 });
  } catch {
    parsed = {
      insufficientEvidence: loop.evidence.status === 'insufficient',
      facts: [],
      interpretation: loop.evidence.gaps,
      trends: [],
      categoryOutlook: 'emerging',
      keySignals: [],
      timeHorizon: '6-12 months',
      confidenceScore: 0.35,
    };
  }

  const gate = applyInsufficientGate(parsed, loop.evidence);
  // Market trends: allow thin global context but force insufficient when geo + no local sources
  if (gate.insufficient) loop.evidence = { ...loop.evidence, status: 'insufficient' };

  const confScore = Number.parseFloat(
    (gate.confidenceScore * computeSignalQualityPenalty(loop.toolResults, 8)).toFixed(2),
  );

  const output: MarketTrendsOutput = {
    agentId: 'market-trends',
    domain: 'market-trends',
    artifactType: 'trend-chart',
    confidence: scoreToLevel(confScore),
    confidenceScore: confScore,
    facts: gate.insufficient ? [] : (parsed.facts as string[] ?? []),
    interpretation: gate.insufficient ? loop.evidence.gaps : (parsed.interpretation as string[] ?? []),
    sources: loop.sources,
    generatedAt: new Date().toISOString(),
    trends: gate.insufficient ? [] : ((parsed.trends ?? []) as TrendDataPoint[]),
    categoryOutlook: (parsed.categoryOutlook as MarketTrendsOutput['categoryOutlook']) ?? 'emerging',
    keySignals: gate.insufficient ? [] : (parsed.keySignals as string[] ?? []),
    timeHorizon: (parsed.timeHorizon as string) ?? '6-12 months',
    evidence: loop.evidence,
    toolCallCount: loop.toolCallCount,
    searchCallCount: loop.searchCallCount,
    scrapeCallCount: loop.scrapeCallCount,
    droppedIrrelevantCount: loop.droppedIrrelevantCount,
  };

  return output;
}

export const marketTrendsAgent: AgentConfig = {
  id: 'market-trends',
  name: 'Trend Sensor',
  description: 'Detects market direction via job postings, funding signals, search trends, and news.',
  run,
};
