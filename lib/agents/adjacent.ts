import { searchWeb, searchNews } from '../tools/serpapi';
import { getTechSentiment } from '../tools/hn-algolia';
import { searchReddit } from '../tools/reddit';
import { planQueries } from '../tools/query-planner';
import { filterRelevant, requirementsFromContext } from '../tools/relevance';
import { extractCandidates, verifyCandidates } from '../tools/candidate-discovery';
import { generateHuggingFaceJson } from './gemini';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  AdjacentOutput,
  AdjacentThreat,
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

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext, geography, category: cat, namedEntities, requiredTerms } = ctx;

  const locale = localeFromGeography(geography);
  const requirements = requirementsFromContext(ctx);

  const queryBundle = planQueries({
    product,
    competitor,
    domain: 'adjacent',
    query,
    category: cat,
    geography,
    namedEntities,
    requiredTerms,
  });

  const planned = resolveSearchQueries(ctx, [queryBundle.broad, queryBundle.targeted], 2);
  const primaryQuery = planned[0] ?? queryBundle.broad;
  const secondaryQuery = planned[1] ?? queryBundle.hypothesis;
  const entityProbes = resolveEntityProbes(ctx, queryBundle.entityProbes, 2);
  const gapQueries = resolveGapQueries(ctx, 3);

  const categoryLabel = cat || (competitor ? `${product} vs ${competitor}` : product);
  const searchedFor = [
    primaryQuery,
    secondaryQuery,
    queryBundle.hypothesis,
    ...entityProbes,
    ...gapQueries,
  ];
  let candidates: EvidenceCandidate[] = [];

  const loop = await runResearchLoop({
    domain: 'adjacent',
    requirements,
    budgetMs: 15_000,
    round1: () =>
      Promise.allSettled([
        searchWeb(primaryQuery, locale),
        searchWeb(secondaryQuery, locale),
        searchWeb(queryBundle.hypothesis, locale),
        searchNews(primaryQuery, locale),
        getTechSentiment(`${product} disruption threat`),
        searchReddit(queryBundle.hypothesis),
        // Skip patents.google when geography is set — global patents drown local signals
        geography
          ? searchWeb(`${primaryQuery} startup OR platform OR initiative`, locale)
          : searchWeb(`${product} patent filing technology site:patents.google.com OR site:patents.justia.com`, locale),
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
        takeSearch(settled[0], 'PLATFORM THREAT', 'serpapi', 4);
        takeSearch(settled[1], 'ADJACENT MARKET', 'serpapi', 4);
        takeSearch(settled[2], 'DISRUPTOR', 'serpapi', 4);
        takeSearch(settled[3], 'FUNDING', 'serpapi', 4);
        if (settled[4]?.status === 'fulfilled') {
          const hn = settled[4].value as { hnResult: ToolResult<Array<{ url: string; title: string; created: string }>>; summary: string };
          hn.hnResult?.data?.slice(0, 3).forEach(p => {
            sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'hn' });
          });
          if (hn.summary) rawContent.push(`[HN TECH SENTIMENT] ${hn.summary}`);
        }
        takeSearch(settled[5], 'REDDIT ADJACENT', 'reddit', 4);
        takeSearch(settled[6], geography ? 'LOCAL THREAT' : 'PATENT SIGNAL', 'serpapi', 3);
        for (let i = 7; i < settled.length; i++) takeSearch(settled[i], 'ENTITY ADJACENT', 'serpapi', 3);
        candidates = extractCandidates(allHits, { geographyName: geography?.name, exclude: [product], limit: 5 });
      } else {
        for (const s of settled) {
          if (s.status !== 'fulfilled') continue;
          const val = s.value as Awaited<ReturnType<typeof discoverAndScrape>> | ToolResult<SearchResult[]>;
          if (val && 'pages' in val && Array.isArray(val.pages)) {
            val.pages.forEach(pageResult => {
              if (pageResult.status === 'failed' || !pageResult.data.markdown?.trim()) return;
              sources.push({ url: pageResult.data.url, title: pageResult.data.title || 'Candidate', timestamp: pageResult.timestamp, tool: 'firecrawl' });
              rawContent.push(`[CANDIDATE] ${pageResult.data.title}: ${pageResult.data.excerpt}`);
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
        category: cat ?? categoryLabel,
        maxCandidates: 2,
        topN: 1,
      });
      searchedFor.push(...queries);
      return settled;
    },
  });

  if (candidates.length) loop.evidence = { ...loop.evidence, candidates };

  const systemPrompt = `You are a strategic threat analyst identifying companies from OUTSIDE the primary category that could disrupt it.
${priorContext ? `\nPrior conversation context:\n${priorContext}` : ''}
${evidencePromptRules(geography, cat)}`;

  const userPrompt = `Query: "${query}"
Product category: ${categoryLabel}
${geography ? `Geography: ${geography.name}` : ''}
Evidence status: ${loop.evidence.status}

Raw signals:
${(await import('@/lib/guardrails')).fenceUntrusted(loop.rawContent)}

Produce JSON:
{
  "insufficientEvidence": boolean,
  "facts": string[],
  "interpretation": string[],
  "threats": [{ "company": string, "category": string, "threatVector": string, "riskLevel": "high" | "medium" | "low", "evidence": string }],
  "overallRisk": "high" | "medium" | "low",
  "timeToImpact": string,
  "defensiveActions": string[],
  "synthesizedAnswer": string,
  "confidenceScore": number
}

If insufficientEvidence, leave threats empty — do not invent global patent threats for a local market.`;

  let parsed: Record<string, unknown> = {};
  try {
    parsed = await generateHuggingFaceJson(systemPrompt, userPrompt, { maxNewTokens: 1400, temperature: 0.2 });
  } catch {
    parsed = { insufficientEvidence: true, facts: [], interpretation: loop.evidence.gaps, threats: [], overallRisk: 'medium', timeToImpact: '12-18 months', defensiveActions: [], confidenceScore: 0.35 };
  }

  const gate = applyInsufficientGate(parsed, loop.evidence);
  if (gate.insufficient) loop.evidence = { ...loop.evidence, status: 'insufficient' };

  const confScore = Number.parseFloat(
    (gate.confidenceScore * computeSignalQualityPenalty(loop.toolResults, 7)).toFixed(2),
  );

  const output: AdjacentOutput = {
    agentId: 'adjacent',
    domain: 'adjacent',
    artifactType: 'threat-heatmap',
    confidence: scoreToLevel(confScore),
    confidenceScore: confScore,
    facts: gate.insufficient ? [] : (parsed.facts as string[] ?? []),
    interpretation: gate.insufficient ? loop.evidence.gaps : (parsed.interpretation as string[] ?? []),
    sources: loop.sources,
    generatedAt: new Date().toISOString(),
    threats: gate.insufficient ? [] : ((parsed.threats ?? []) as AdjacentThreat[]),
    overallRisk: (parsed.overallRisk as AdjacentOutput['overallRisk']) ?? 'medium',
    timeToImpact: (parsed.timeToImpact as string) ?? '12-18 months',
    defensiveActions: gate.insufficient ? [] : (parsed.defensiveActions as string[] ?? []),
    evidence: loop.evidence,
    toolCallCount: loop.toolCallCount,
    searchCallCount: loop.searchCallCount,
    scrapeCallCount: loop.scrapeCallCount,
    droppedIrrelevantCount: loop.droppedIrrelevantCount,
  };

  return output;
}

export const adjacentAgent: AgentConfig = {
  id: 'adjacent',
  name: 'Adjacent Threat Agent',
  description: 'Identifies companies from outside the category that could disrupt it — platform expansion, infrastructure players, category convergence.',
  run,
};
