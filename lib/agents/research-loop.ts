/**
 * Budgeted research loop: Round 1 → relevance filter → assess → optional Round 2
 * (tools only, no extra LLM) within a hard time budget.
 * Also enforces a scrape floor when relevant hits exist but pages were not read.
 */

import type { AgentSource, EvidenceAssessment } from './types';
import type { ToolResult, SearchResult, ScrapedPage } from '../tools/types';
import type { RelevanceRequirements } from '../tools/relevance';
import { assessEvidence } from './evidence-gate';
import { scrapePage } from '../tools/firecrawl';

export interface IngestResult {
  sources: AgentSource[];
  rawContent: string[];
  toolResults: ToolResult<unknown>[];
  searchedFor: string[];
  relevantSourceCount?: number;
  /** Search hits retained after relevance (for scrape floor). */
  relevantHits?: SearchResult[];
  scrapedPageCount?: number;
  droppedIrrelevantCount?: number;
  searchCallCount?: number;
  scrapeCallCount?: number;
}

export interface ResearchLoopState extends IngestResult {
  evidence: EvidenceAssessment;
  round: 1 | 2;
}

export interface ResearchLoopResult extends ResearchLoopState {
  toolCallCount: number;
}

export interface ResearchLoopConfig {
  domain: string;
  requirements: RelevanceRequirements;
  round1: () => Promise<PromiseSettledResult<unknown>[]>;
  ingest: (settled: PromiseSettledResult<unknown>[], round: 1 | 2) => IngestResult;
  gapRound?: (state: ResearchLoopState) => Promise<PromiseSettledResult<unknown>[]>;
  budgetMs?: number;
  extraGaps?: string[];
  /** When true (default), scrape top relevant URLs if none were scraped. */
  enforceScrapeFloor?: boolean;
}

function countFulfilledTools(settled: PromiseSettledResult<unknown>[]): number {
  return settled.filter(r => r.status === 'fulfilled').length;
}

async function withBudget<T>(
  work: Promise<T>,
  budgetMs: number,
): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const raced = await Promise.race([
      work.then(value => ({ ok: true as const, value })),
      new Promise<{ ok: false }>(resolve => {
        timer = setTimeout(() => resolve({ ok: false }), budgetMs);
      }),
    ]);
    return raced;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function countScrapes(sources: AgentSource[]): number {
  return sources.filter(s => s.tool === 'firecrawl').length;
}

/**
 * If we have ≥2 relevant hits but 0 scraped pages, scrape the top 2 URLs.
 */
async function applyScrapeFloor(
  state: ResearchLoopState,
  budgetMs: number,
): Promise<{ state: ResearchLoopState; addedScrapes: number }> {
  const scraped = state.scrapedPageCount ?? countScrapes(state.sources);
  const hits = state.relevantHits ?? [];
  if (scraped > 0 || hits.length < 2) return { state, addedScrapes: 0 };

  const toScrape = hits.slice(0, 2);
  const scrapePromise = Promise.allSettled(toScrape.map(h => scrapePage(h.url)));
  const raced = await withBudget(scrapePromise, Math.min(budgetMs, 10_000));
  if (!raced.ok) return { state, addedScrapes: 0 };

  const seen = new Set(state.sources.map(s => s.url));
  const sources = [...state.sources];
  const rawContent = [...state.rawContent];
  const toolResults = [...state.toolResults];
  let added = 0;

  for (const settled of raced.value) {
    if (settled.status !== 'fulfilled') continue;
    const pageResult = settled.value as ToolResult<ScrapedPage>;
    if (pageResult.status === 'failed' || !pageResult.data?.markdown?.trim()) continue;
    const page = pageResult.data;
    if (seen.has(page.url)) continue;
    seen.add(page.url);
    sources.push({
      url: page.url,
      title: page.title || page.url,
      timestamp: pageResult.timestamp,
      tool: 'firecrawl',
    });
    rawContent.push(`[SCRAPE FLOOR] ${page.title}: ${page.excerpt}`);
    toolResults.push(pageResult);
    added += 1;
  }

  if (added === 0) return { state, addedScrapes: 0 };

  const relevantCount = (state.relevantSourceCount ?? state.sources.length) + added;
  const mergedEvidence: EvidenceAssessment = {
    ...state.evidence,
    relevantSourceCount: relevantCount,
    status:
      relevantCount <= 1
        ? 'insufficient'
        : relevantCount <= 3
          ? 'thin'
          : 'sufficient',
  };

  return {
    state: {
      ...state,
      sources,
      rawContent,
      toolResults,
      relevantSourceCount: relevantCount,
      scrapedPageCount: scraped + added,
      scrapeCallCount: (state.scrapeCallCount ?? scraped) + added,
      evidence: mergedEvidence,
    },
    addedScrapes: added,
  };
}

/**
 * Run research with at most one gap-fill round. Round 2 is aborted if it
 * exceeds budgetMs (default 15s). Enforces scrape floor when configured.
 */
export async function runResearchLoop(cfg: ResearchLoopConfig): Promise<ResearchLoopResult> {
  const budgetMs = cfg.budgetMs ?? 15_000;
  let toolCallCount = 0;

  const round1Settled = await cfg.round1();
  toolCallCount += countFulfilledTools(round1Settled);

  let ingest = cfg.ingest(round1Settled, 1);
  const relevantCount =
    ingest.relevantSourceCount ??
    ingest.sources.length;

  let evidence = assessEvidence({
    relevantSourceCount: relevantCount,
    searchedFor: ingest.searchedFor,
    domain: cfg.domain,
    geography: cfg.requirements.geography,
    category: cfg.requirements.category,
    extraGaps: cfg.extraGaps,
  });

  let state: ResearchLoopState = {
    ...ingest,
    scrapedPageCount: ingest.scrapedPageCount ?? countScrapes(ingest.sources),
    evidence,
    round: 1,
  };

  const needsGap =
    (evidence.status === 'thin' || evidence.status === 'insufficient') &&
    typeof cfg.gapRound === 'function';

  if (needsGap) {
    const gapPromise = cfg.gapRound!(state);
    const raced = await withBudget(gapPromise, budgetMs);
    if (raced.ok) {
      toolCallCount += countFulfilledTools(raced.value);
      const round2Ingest = cfg.ingest(raced.value, 2);
      // Merge sources / content (dedupe by URL)
      const seen = new Set(state.sources.map(s => s.url));
      const mergedSources = [...state.sources];
      for (const s of round2Ingest.sources) {
        if (!seen.has(s.url)) {
          seen.add(s.url);
          mergedSources.push(s);
        }
      }
      const mergedContent = [...state.rawContent, ...round2Ingest.rawContent];
      const mergedTools = [...state.toolResults, ...round2Ingest.toolResults];
      const mergedSearched = [
        ...new Set([...state.searchedFor, ...round2Ingest.searchedFor]),
      ];
      const mergedRelevant =
        (state.relevantSourceCount ?? state.sources.length) +
        (round2Ingest.relevantSourceCount ?? round2Ingest.sources.length);

      const mergedHits = [
        ...(state.relevantHits ?? []),
        ...(round2Ingest.relevantHits ?? []),
      ];

      evidence = assessEvidence({
        relevantSourceCount: mergedRelevant,
        searchedFor: mergedSearched,
        domain: cfg.domain,
        geography: cfg.requirements.geography,
        category: cfg.requirements.category,
        extraGaps: cfg.extraGaps,
      });

      state = {
        sources: mergedSources,
        rawContent: mergedContent,
        toolResults: mergedTools,
        searchedFor: mergedSearched,
        relevantSourceCount: mergedRelevant,
        relevantHits: mergedHits,
        scrapedPageCount:
          (state.scrapedPageCount ?? 0) +
          (round2Ingest.scrapedPageCount ?? countScrapes(round2Ingest.sources)),
        droppedIrrelevantCount:
          (state.droppedIrrelevantCount ?? 0) +
          (round2Ingest.droppedIrrelevantCount ?? 0),
        searchCallCount:
          (state.searchCallCount ?? 0) + (round2Ingest.searchCallCount ?? 0),
        scrapeCallCount:
          (state.scrapeCallCount ?? 0) + (round2Ingest.scrapeCallCount ?? 0),
        evidence,
        round: 2,
      };
      ingest = state;
    } else {
      evidence = assessEvidence({
        relevantSourceCount: relevantCount,
        searchedFor: ingest.searchedFor,
        domain: cfg.domain,
        geography: cfg.requirements.geography,
        category: cfg.requirements.category,
        extraGaps: [
          ...(cfg.extraGaps ?? []),
          'Gap-fill round aborted (time budget exceeded).',
        ],
      });
      state = { ...state, evidence };
    }
  }

  // Scrape floor: relevant hits without page reads → scrape top 2
  if (cfg.enforceScrapeFloor !== false) {
    const remainingBudget = Math.max(3_000, budgetMs - 2_000);
    const floored = await applyScrapeFloor(state, remainingBudget);
    state = floored.state;
    toolCallCount += floored.addedScrapes;
  }

  return {
    ...state,
    toolCallCount,
  };
}
