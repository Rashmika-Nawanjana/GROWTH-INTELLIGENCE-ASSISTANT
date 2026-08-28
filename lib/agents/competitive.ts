import { searchWeb, searchNews } from '../tools/serpapi';
import { scrapePage, scrapeCompetitorPricing } from '../tools/firecrawl';
import { searchHN } from '../tools/hn-algolia';
import { scrapeTwitterX } from '../tools/apify-twitter';
import { discoverAndScrape } from '../tools/discover-and-scrape';
import { planQueries } from '../tools/query-planner';
import { filterRelevant, requirementsFromContext } from '../tools/relevance';
import { extractCandidates, verifyCandidates } from '../tools/candidate-discovery';
import { generateHuggingFaceJson } from './gemini';
import {
  competitorSiteUrl,
  isPlaceholderCompetitor,
  isUsableScrapePage,
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
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  CompetitiveOutput,
  CompetitorFeature,
  AgentSource,
  ConfidenceLevel,
  EvidenceCandidate,
} from './types';
import { scoreToLevel } from './types';
import { computeSignalQualityPenalty, extractToolResults } from '../tools/fallback';
import type { SearchResult, ToolResult } from '../tools/types';

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext, geography, category, namedEntities, requiredTerms } = ctx;

  const competitorName =
    competitor && !isPlaceholderCompetitor(competitor) ? competitor : 'discovered competitors';
  const compUrl = competitorSiteUrl(ctx);
  const locale = localeFromGeography(geography);
  const requirements = requirementsFromContext(ctx);

  const queryBundle = planQueries({
    product,
    competitor,
    domain: 'competitive',
    query,
    category: category ?? (query.toLowerCase().includes('agri') ? 'agritech' : undefined),
    geography,
    namedEntities,
    requiredTerms,
  });

  const planned = resolveSearchQueries(ctx, [queryBundle.broad, queryBundle.targeted], 2);
  const primaryQuery = planned[0] ?? queryBundle.broad;
  const secondaryQuery = planned[1] ?? queryBundle.hypothesis;
  const entityProbes = resolveEntityProbes(ctx, queryBundle.entityProbes, 2);
  const gapQueries = resolveGapQueries(ctx, 3);

  const searchedForBase = [
    primaryQuery,
    secondaryQuery,
    queryBundle.hypothesis,
    ...entityProbes,
    ...gapQueries,
  ];

  let candidates: EvidenceCandidate[] = [];
  let droppedIrrelevantCount = 0;

  const loop = await runResearchLoop({
    domain: 'competitive',
    requirements,
    budgetMs: 15_000,
    round1: () =>
      Promise.allSettled([
        searchWeb(primaryQuery, locale),
        searchNews(queryBundle.hypothesis, locale),
        searchHN(`${product} ${geography?.name ?? ''}`.trim()),
        compUrl ? scrapePage(compUrl) : skippedScrapePromise(),
        compUrl ? scrapeCompetitorPricing(compUrl) : skippedScrapePromise(),
        searchWeb(secondaryQuery, locale),
        scrapeTwitterX(
          [primaryQuery, secondaryQuery],
          { maxItems: 40, sort: 'Latest', language: locale?.hl ?? 'en' },
        ),
        discoverAndScrape(primaryQuery, {
          product,
          competitor: competitorName,
          domain: 'competitive',
          topN: 2,
          keywords: queryBundle.keywords,
          locale,
          requirements,
        }),
        ...entityProbes.map(q => searchWeb(q, locale)),
      ]),
    ingest: (settled, round) => {
      const sources: AgentSource[] = [];
      const rawContent: string[] = [];
      const allHits: SearchResult[] = [];
      let searchCalls = 0;
      let scrapeCalls = 0;
      let dropped = 0;

      const pushHits = (
        result: PromiseSettledResult<unknown>,
        label: string,
        tool: AgentSource['tool'],
        limit = 5,
      ) => {
        if (result.status !== 'fulfilled') return;
        const value = result.value as ToolResult<SearchResult[]>;
        if (!value?.data || !Array.isArray(value.data)) return;
        searchCalls += 1;
        const filtered = filterRelevant(value.data, requirements, { limit, minScore: 0.25 });
        dropped += filtered.dropped.length;
        filtered.kept.forEach(r => {
          allHits.push(r);
          sources.push({ url: r.url, title: r.title, timestamp: value.timestamp, tool });
          rawContent.push(`[${label}] ${r.title}: ${r.snippet}`);
        });
      };

      pushHits(settled[0], 'COMPETITOR WEB', 'serpapi', 5);
      pushHits(settled[1], 'COMPETITOR NEWS', 'serpapi', 4);
      if (settled[2]?.status === 'fulfilled') {
        const hn = settled[2].value as ToolResult<Array<{ url: string; title: string; created: string }>>;
        (hn.data ?? []).slice(0, 3).forEach(p => {
          sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'hn' });
          rawContent.push(`[HN] ${p.title}`);
        });
      }
      if (settled[3] && isUsableScrapePage(settled[3] as PromiseSettledResult<ToolResult<import('../tools/types').ScrapedPage>>)) {
        scrapeCalls += 1;
        const page = (settled[3] as PromiseFulfilledResult<ToolResult<import('../tools/types').ScrapedPage>>).value.data;
        sources.push({ url: page.url, title: page.title || competitorName, timestamp: (settled[3] as PromiseFulfilledResult<ToolResult<import('../tools/types').ScrapedPage>>).value.timestamp, tool: 'firecrawl' });
        rawContent.push(`[COMPETITOR HOMEPAGE] ${page.excerpt}`);
      }
      if (settled[4] && isUsableScrapePage(settled[4] as PromiseSettledResult<ToolResult<import('../tools/types').ScrapedPage>>)) {
        scrapeCalls += 1;
        const page = (settled[4] as PromiseFulfilledResult<ToolResult<import('../tools/types').ScrapedPage>>).value.data;
        sources.push({ url: page.url, title: `${competitorName} pricing`, timestamp: (settled[4] as PromiseFulfilledResult<ToolResult<import('../tools/types').ScrapedPage>>).value.timestamp, tool: 'firecrawl' });
        rawContent.push(`[COMPETITOR PRICING] ${page.excerpt}`);
      }
      pushHits(settled[5], 'SOCIAL SIGNAL', 'serpapi', 3);
      if (settled[6]?.status === 'fulfilled') {
        const tw = settled[6].value as ToolResult<Array<{ url: string; authorHandle?: string; text: string; createdAt?: string }>>;
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
      if (settled[7]?.status === 'fulfilled') {
        const disc = settled[7].value as Awaited<ReturnType<typeof discoverAndScrape>>;
        dropped += disc.droppedIrrelevantCount ?? 0;
        searchCalls += 1;
        disc.pages.forEach(pageResult => {
          if (pageResult.status === 'failed' || !pageResult.data.markdown?.trim()) return;
          scrapeCalls += 1;
          const page = pageResult.data;
          sources.push({
            url: page.url,
            title: page.title || competitorName,
            timestamp: pageResult.timestamp,
            tool: 'firecrawl',
          });
          rawContent.push(`[DISCOVERED PAGE] ${page.title}: ${page.excerpt}`);
        });
        filterRelevant(disc.search.data, requirements, { limit: 5 }).kept.forEach(r => {
          allHits.push(r);
        });
      }
      for (let i = 8; i < settled.length; i++) {
        pushHits(settled[i], 'ENTITY PROBE', 'serpapi', 4);
      }

      if (round === 2) {
        for (const s of settled) {
          if (s.status !== 'fulfilled') continue;
          const val = s.value as Awaited<ReturnType<typeof discoverAndScrape>> | ToolResult<SearchResult[]>;
          if (val && 'pages' in val && Array.isArray(val.pages)) {
            val.pages.forEach(pageResult => {
              if (pageResult.status === 'failed' || !pageResult.data.markdown?.trim()) return;
              scrapeCalls += 1;
              const page = pageResult.data;
              sources.push({
                url: page.url,
                title: page.title || 'Candidate site',
                timestamp: pageResult.timestamp,
                tool: 'firecrawl',
              });
              rawContent.push(`[CANDIDATE SITE] ${page.title}: ${page.excerpt}`);
            });
          } else if (val && 'data' in val && Array.isArray(val.data)) {
            pushHits(
              { status: 'fulfilled', value: val } as PromiseFulfilledResult<ToolResult<SearchResult[]>>,
              'GAP QUERY',
              'serpapi',
              4,
            );
          }
        }
      }

      if (round === 1 && allHits.length > 0) {
        candidates = extractCandidates(allHits, {
          geographyName: geography?.name,
          exclude: [product, competitorName, ...(namedEntities ?? [])],
          limit: 5,
        });
      }

      droppedIrrelevantCount += dropped;

      return {
        sources,
        rawContent,
        toolResults: extractToolResults(settled as PromiseSettledResult<ToolResult<unknown>>[]),
        searchedFor: searchedForBase,
        relevantSourceCount: sources.length,
        relevantHits: allHits,
        scrapedPageCount: sources.filter(s => s.tool === 'firecrawl').length,
        droppedIrrelevantCount: dropped,
        searchCallCount: searchCalls,
        scrapeCallCount: scrapeCalls,
      };
    },
    gapRound: async (state) => {
      if (gapQueries.length > 0) {
        const settled = await Promise.allSettled(
          gapQueries.slice(0, 2).map(q =>
            discoverAndScrape(q, {
              product,
              competitor: competitorName,
              domain: 'competitive',
              topN: 1,
              keywords: queryBundle.keywords,
              locale,
              requirements,
            }),
          ),
        );
        searchedForBase.push(...gapQueries.slice(0, 2));
        return settled;
      }

      if (candidates.length === 0) {
        candidates = extractCandidates(
          state.sources.map(s => ({ title: s.title, url: s.url, snippet: '' })),
          { geographyName: geography?.name, exclude: [product], limit: 5 },
        );
      }
      const { settled, queries } = await verifyCandidates(candidates, {
        product,
        geographyName: geography?.name,
        category: category ?? queryBundle.keywords[0],
        maxCandidates: 3,
        topN: 1,
      });
      searchedForBase.push(...queries);
      return settled;
    },
  });

  if (candidates.length > 0) {
    loop.evidence = { ...loop.evidence, candidates };
  }

  const systemPrompt = `You are a competitive intelligence analyst. You compare product capabilities with brutal honesty. You separate facts from interpretation. You never fabricate features.
${priorContext ? `\nPrior conversation context:\n${priorContext}` : ''}
${evidencePromptRules(geography, category)}`;

  const userPrompt = `Query: "${query}"
Our product: ${product}
Competitor focus: ${competitorName}
${geography ? `Geography constraint: ${geography.name}` : ''}
${category ? `Category: ${category}` : ''}
Evidence status: ${loop.evidence.status} (${loop.evidence.relevantSourceCount} relevant sources)
${candidates.length ? `Candidate organisations found: ${candidates.map(c => `${c.name} (${c.classification})`).join(', ')}` : ''}
${ctx.discoveredEntities?.length ? `Planner entities: ${ctx.discoveredEntities.map(e => e.name).join(', ')}` : ''}

Raw signals:
${(await import('@/lib/guardrails')).fenceUntrusted(loop.rawContent)}

Produce a JSON object:
{
  "insufficientEvidence": boolean,
  "facts": string[],
  "interpretation": string[],
  "competitorSummary": string,
  "matrix": [
    {
      "feature": string,
      "yourProduct": "strong" | "medium" | "weak" | "none",
      "competitor": "strong" | "medium" | "weak" | "none",
      "gapDirection": "advantage" | "parity" | "disadvantage"
    }
  ],
  "hiringSignals": string[],
  "recentMoves": string[],
  "synthesizedAnswer": string,
  "confidenceScore": number
}

For the matrix, only include dimensions backed by signals. If insufficientEvidence, leave matrix empty.`;

  let parsed: Record<string, unknown> = {};
  try {
    parsed = await generateHuggingFaceJson<Record<string, unknown>>(systemPrompt, userPrompt, {
      maxNewTokens: 1400,
      temperature: 0.2,
    });
  } catch {
    parsed = {
      insufficientEvidence: loop.evidence.status === 'insufficient',
      facts: loop.rawContent.slice(0, 3).map(s => s.replace(/^\[[^\]]+\]\s*/, '')).filter(s => s.length > 15),
      interpretation: ['Analysis synthesis is temporarily unavailable.'],
      competitorSummary: '',
      matrix: [],
      hiringSignals: [],
      recentMoves: [],
      synthesizedAnswer: '',
      confidenceScore: 0.4,
    };
  }

  const gate = applyInsufficientGate(parsed, loop.evidence);
  if (gate.insufficient) {
    loop.evidence = { ...loop.evidence, status: 'insufficient' };
  }

  const confScore = Number.parseFloat(
    (gate.confidenceScore * computeSignalQualityPenalty(loop.toolResults, 8)).toFixed(2),
  );
  const confidence: ConfidenceLevel = scoreToLevel(confScore);

  const output: CompetitiveOutput = {
    agentId: 'competitive',
    domain: 'competitive',
    artifactType: 'competitive-matrix',
    confidence,
    confidenceScore: confScore,
    facts: gate.insufficient ? (parsed.facts as string[] ?? []).slice(0, 2) : (parsed.facts as string[] ?? []),
    interpretation: gate.insufficient ? loop.evidence.gaps : (parsed.interpretation as string[] ?? []),
    sources: loop.sources,
    generatedAt: new Date().toISOString(),
    competitor: competitorName,
    matrix: gate.insufficient ? [] : ((parsed.matrix ?? []) as CompetitorFeature[]),
    competitorSummary: gate.insufficient
      ? loop.evidence.gaps[0] ?? 'Insufficient competitive evidence for this market.'
      : (parsed.competitorSummary as string) ?? '',
    hiringSignals: gate.insufficient ? [] : (parsed.hiringSignals as string[] ?? []),
    recentMoves: gate.insufficient ? [] : (parsed.recentMoves as string[] ?? []),
    evidence: loop.evidence,
    toolCallCount: loop.toolCallCount,
    searchCallCount: loop.searchCallCount,
    scrapeCallCount: loop.scrapeCallCount,
    droppedIrrelevantCount: droppedIrrelevantCount + (loop.droppedIrrelevantCount ?? 0),
  };

  return output;
}

export const competitiveAgent: AgentConfig = {
  id: 'competitive',
  name: 'Competitive Agent',
  description: 'Scrapes competitor product pages, changelogs, and pricing to build a feature comparison matrix.',
  run,
};
