/**
 * Steal strategy agent — grounded, multi-hop competitive case study.
 *
 * Reads live signal (web, news, HN, scraped pages) about how a company
 * historically competed, then synthesises an ethical playbook a new entrant
 * could apply. Every array item carries `sourceUrls` so claims are traceable.
 */

import { searchWeb, searchNews } from '../tools/serpapi';
import { searchHN } from '../tools/hn-algolia';
import { discoverAndScrape } from '../tools/discover-and-scrape';
import { planQueries } from '../tools/query-planner';
import { filterRelevant, requirementsFromContext } from '../tools/relevance';
import { computeSignalQualityPenalty, extractToolResults } from '../tools/fallback';
import { generateHuggingFaceJson } from './gemini';
import { runResearchLoop } from './research-loop';
import { applyInsufficientGate, evidencePromptRules } from './evidence-gate';
import { localeFromGeography } from './search-locale';
import { fenceUntrusted } from '../guardrails/untrusted';
import { guardOutput } from '../guardrails/output-guard';
import { scoreToLevel } from './types';
import type {
  AgentContext,
  AgentRun,
  AgentSource,
  ConfidenceLevel,
  EntrantPlay,
  HistoricalMove,
  StealPlaybookOutput,
} from './types';
import type { HNPost, SearchResult, ToolResult } from '../tools/types';

export const STEAL_STRATEGY_AGENT_ID = 'steal-strategy';

type ProgressFn = (run: AgentRun) => void;

interface StealSynthesis {
  insufficientEvidence?: boolean;
  facts?: string[];
  interpretation?: string[];
  summary?: string;
  historicalCompetitiveMoves?: Array<{
    move?: string;
    context?: string;
    effectOnRivals?: string;
    sourceIds?: number[];
  }>;
  modernEntrantPlaybook?: Array<{
    analogy?: string;
    applicationToday?: string;
    exampleTactics?: string[];
    sourceIds?: number[];
  }>;
  guardrails?: string;
  confidenceScore?: number;
}

const DEFAULT_GUARDRAILS =
  'This is an educational case study of publicly reported competitive history. ' +
  'Do not copy protected IP, misuse confidential data, disparage competitors, or breach ' +
  'contracts, advertising rules, or antitrust law. Verify every claim for your own market ' +
  'and take legal advice before acting.';

function emit(onProgress: ProgressFn | undefined, run: AgentRun): void {
  try {
    onProgress?.(run);
  } catch {
    // Progress reporting must never break the run.
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Numbered source list the model cites by index. */
function buildSourceIndex(sources: AgentSource[]): string {
  if (sources.length === 0) return '(no sources retrieved)';
  return sources
    .map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`)
    .join('\n');
}

/** Map model-supplied 1-based source ids to real URLs, dropping anything invented. */
function resolveSourceUrls(ids: unknown, sources: AgentSource[]): string[] {
  if (!Array.isArray(ids)) return [];
  const urls = ids
    .map(id => (typeof id === 'number' ? id : Number.parseInt(String(id), 10)))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= sources.length)
    .map(n => sources[n - 1].url);
  return [...new Set(urls)].slice(0, 4);
}

function cleanStrings(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim())
    .slice(0, limit);
}

/**
 * Output moderation across *every* emitted text field — not just the summary.
 * Returns the sanitized output plus the worst safety score observed.
 */
export function sanitizeStealOutput(
  output: StealPlaybookOutput,
): { output: StealPlaybookOutput; safetyScore: number } {
  let worst = 1;

  const clean = (text: string): string => {
    if (!text) return text;
    const guarded = guardOutput(text);
    worst = Math.min(worst, guarded.safetyScore);
    return guarded.safeText;
  };

  const sanitized: StealPlaybookOutput = {
    ...output,
    company: clean(output.company),
    market: output.market ? clean(output.market) : output.market,
    summary: clean(output.summary),
    guardrails: clean(output.guardrails),
    facts: output.facts.map(clean),
    interpretation: output.interpretation.map(clean),
    historicalCompetitiveMoves: output.historicalCompetitiveMoves.map(h => ({
      move: clean(h.move),
      context: clean(h.context),
      effectOnRivals: clean(h.effectOnRivals),
      sourceUrls: h.sourceUrls,
    })),
    modernEntrantPlaybook: output.modernEntrantPlaybook.map(m => ({
      analogy: clean(m.analogy),
      applicationToday: clean(m.applicationToday),
      exampleTactics: m.exampleTactics.map(clean),
      sourceUrls: m.sourceUrls,
    })),
  };

  return { output: sanitized, safetyScore: worst };
}

export interface StealStrategyResult {
  output: StealPlaybookOutput;
  safetyScore: number;
}

/**
 * Run the grounded steal-strategy research agent.
 *
 * `ctx.product` is the company being analysed, `ctx.category` the market,
 * and `ctx.priorContext` the reader's own company/angle.
 */
export async function runStealStrategyAgent(
  ctx: AgentContext,
  onProgress?: ProgressFn,
): Promise<StealStrategyResult> {
  const company = ctx.product.trim();
  const market = ctx.category?.trim() || undefined;
  const locale = localeFromGeography(ctx.geography);
  const requirements = requirementsFromContext(ctx);

  emit(onProgress, {
    agentId: 'steal-plan',
    name: 'Query planning',
    status: 'running',
    startedAt: nowIso(),
  });

  const bundle = planQueries({
    product: company,
    domain: 'steal-strategy',
    query: ctx.query,
    category: market,
    geography: ctx.geography,
    namedEntities: ctx.namedEntities,
    requiredTerms: ctx.requiredTerms,
  });

  const gapQueries = [
    `${company} ${market ?? 'category'} distribution advantage bundling case study`,
    `how new entrants competed with ${company} lessons`,
  ];

  const searchedFor = [bundle.broad, bundle.targeted, bundle.hypothesis];

  emit(onProgress, {
    agentId: 'steal-plan',
    name: 'Query planning',
    status: 'completed',
    completedAt: nowIso(),
  });

  emit(onProgress, {
    agentId: 'steal-research',
    name: 'Live signal research',
    status: 'running',
    startedAt: nowIso(),
  });

  let gapRoundRan = false;

  const loop = await runResearchLoop({
    domain: 'steal-strategy',
    requirements,
    budgetMs: 18_000,
    round1: () =>
      Promise.allSettled([
        searchWeb(bundle.broad, locale),
        searchNews(bundle.hypothesis, locale),
        searchHN(company),
        discoverAndScrape(bundle.broad, {
          product: company,
          domain: 'steal-strategy',
          topN: 2,
          keywords: bundle.keywords,
          locale,
          requirements,
        }),
        searchWeb(bundle.targeted, locale),
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
        limit: number,
      ) => {
        if (result?.status !== 'fulfilled') return;
        const value = result.value as ToolResult<SearchResult[]>;
        if (!value?.data || !Array.isArray(value.data)) return;
        searchCalls += 1;
        const filtered = filterRelevant(value.data, requirements, { limit, minScore: 0.2 });
        dropped += filtered.dropped.length;
        filtered.kept.forEach(r => {
          allHits.push(r);
          sources.push({
            url: r.url,
            title: r.title,
            timestamp: value.timestamp,
            tool: 'serpapi',
          });
          rawContent.push(`[${label}] ${r.title}: ${r.snippet}`);
        });
      };

      const pushDiscovery = (result: PromiseSettledResult<unknown>) => {
        if (result?.status !== 'fulfilled') return;
        const disc = result.value as Awaited<ReturnType<typeof discoverAndScrape>>;
        if (!disc || !Array.isArray(disc.pages)) return;
        dropped += disc.droppedIrrelevantCount ?? 0;
        searchCalls += 1;
        disc.pages.forEach(pageResult => {
          if (pageResult.status === 'failed' || !pageResult.data?.markdown?.trim()) return;
          scrapeCalls += 1;
          const page = pageResult.data;
          sources.push({
            url: page.url,
            title: page.title || company,
            timestamp: pageResult.timestamp,
            tool: 'firecrawl',
          });
          rawContent.push(`[STRATEGY PAGE] ${page.title}: ${page.excerpt}`);
        });
        filterRelevant(disc.search?.data ?? [], requirements, { limit: 5 }).kept.forEach(r => {
          allHits.push(r);
        });
      };

      if (round === 1) {
        pushHits(settled[0], 'STRATEGY WEB', 5);
        pushHits(settled[1], 'STRATEGY NEWS', 4);
        if (settled[2]?.status === 'fulfilled') {
          const hn = settled[2].value as ToolResult<HNPost[]>;
          (hn.data ?? []).slice(0, 4).forEach(p => {
            sources.push({
              url: p.url,
              title: p.title,
              timestamp: p.created ?? hn.timestamp,
              tool: 'hn',
            });
            rawContent.push(`[FOUNDER SENTIMENT] ${p.title}`);
          });
        }
        pushDiscovery(settled[3]);
        pushHits(settled[4], 'TACTIC PROBE', 4);
      } else {
        for (const s of settled) {
          if (s.status !== 'fulfilled') continue;
          const val = s.value as
            | Awaited<ReturnType<typeof discoverAndScrape>>
            | ToolResult<SearchResult[]>;
          if (val && 'pages' in val && Array.isArray(val.pages)) {
            pushDiscovery(s);
          } else if (val && 'data' in val && Array.isArray(val.data)) {
            pushHits(s, 'GAP QUERY', 4);
          }
        }
      }

      return {
        sources,
        rawContent,
        toolResults: extractToolResults(
          settled as PromiseSettledResult<ToolResult<unknown>>[],
        ),
        searchedFor,
        relevantSourceCount: sources.length,
        relevantHits: allHits,
        scrapedPageCount: sources.filter(s => s.tool === 'firecrawl').length,
        droppedIrrelevantCount: dropped,
        searchCallCount: searchCalls,
        scrapeCallCount: scrapeCalls,
      };
    },
    gapRound: async () => {
      gapRoundRan = true;
      emit(onProgress, {
        agentId: 'steal-gap',
        name: 'Gap-fill round',
        status: 'running',
        startedAt: nowIso(),
      });
      searchedFor.push(...gapQueries);
      return Promise.allSettled([
        discoverAndScrape(gapQueries[0], {
          product: company,
          domain: 'steal-strategy',
          topN: 1,
          keywords: bundle.keywords,
          locale,
          requirements,
        }),
        searchWeb(gapQueries[1], locale),
      ]);
    },
  });

  emit(onProgress, {
    agentId: 'steal-research',
    name: 'Live signal research',
    status: 'completed',
    completedAt: nowIso(),
  });
  if (gapRoundRan) {
    emit(onProgress, {
      agentId: 'steal-gap',
      name: 'Gap-fill round',
      status: 'completed',
      completedAt: nowIso(),
    });
  }

  emit(onProgress, {
    agentId: 'steal-synthesis',
    name: 'Playbook synthesis',
    status: 'running',
    startedAt: nowIso(),
  });

  const systemPrompt = `You are a business strategy analyst producing a case study of widely reported competitive history. Respond with valid JSON only, no markdown fences.
This is education, not instructions to break laws, harm competitors, or act unethically. Frame moves as "documented" or "commonly cited" and say so when uncertain.
${ctx.priorContext ? `\nReader context:\n${ctx.priorContext}\n` : ''}${evidencePromptRules(ctx.geography, market)}`;

  const userPrompt = `Company to analyse: ${company}
${market ? `Market / category: ${market}` : ''}
Evidence status: ${loop.evidence.status} (${loop.evidence.relevantSourceCount} relevant sources)

Sources — cite these by number in "sourceIds":
${buildSourceIndex(loop.sources)}

Raw signals:
${fenceUntrusted(loop.rawContent)}

Produce a JSON object with this exact shape:
{
  "insufficientEvidence": boolean,
  "facts": string[],
  "interpretation": string[],
  "summary": "2-3 sentences grounded in the signals above",
  "historicalCompetitiveMoves": [
    { "move": "", "context": "timeframe / product area", "effectOnRivals": "strategic effect on same-type competitors", "sourceIds": [1] }
  ],
  "modernEntrantPlaybook": [
    { "analogy": "which past pattern maps here", "applicationToday": "how a new company competes in this market now (channels, product, GTM, data)", "exampleTactics": ["concrete, ethical levers"], "sourceIds": [2] }
  ],
  "guardrails": "one paragraph: legal, ethical, and IP boundaries",
  "confidenceScore": 0.0
}

Rules:
- 3-5 items in each array when evidence supports it.
- "sourceIds" must reference the numbered source list. Never invent numbers or URLs.
- Omit any move you cannot tie to a source.
- If the signals do not describe this company's competitive history, set insufficientEvidence true and return empty arrays.
- Use English.`;

  let parsed: StealSynthesis = {};
  try {
    parsed = await generateHuggingFaceJson<StealSynthesis>(systemPrompt, userPrompt, {
      maxNewTokens: 3500,
      temperature: 0.25,
      stage: 'steal-strategy',
    });
  } catch {
    parsed = {
      insufficientEvidence: true,
      facts: loop.rawContent
        .slice(0, 3)
        .map(s => s.replace(/^\[[^\]]+\]\s*/, ''))
        .filter(s => s.length > 15),
      interpretation: ['Strategy synthesis is temporarily unavailable.'],
      summary: '',
      historicalCompetitiveMoves: [],
      modernEntrantPlaybook: [],
      guardrails: DEFAULT_GUARDRAILS,
      confidenceScore: 0.3,
    };
  }

  const gate = applyInsufficientGate(
    parsed as unknown as Record<string, unknown>,
    loop.evidence,
  );
  const evidence = gate.insufficient
    ? { ...loop.evidence, status: 'insufficient' as const }
    : loop.evidence;

  const confidenceScore = Number.parseFloat(
    (gate.confidenceScore * computeSignalQualityPenalty(loop.toolResults, 5)).toFixed(2),
  );
  const confidence: ConfidenceLevel = scoreToLevel(confidenceScore);

  const historicalCompetitiveMoves: HistoricalMove[] = gate.insufficient
    ? []
    : (parsed.historicalCompetitiveMoves ?? [])
        .filter(h => typeof h?.move === 'string' && h.move.trim().length > 0)
        .slice(0, 5)
        .map(h => ({
          move: h.move!.trim(),
          context: (h.context ?? '').trim(),
          effectOnRivals: (h.effectOnRivals ?? '').trim(),
          sourceUrls: resolveSourceUrls(h.sourceIds, loop.sources),
        }));

  const modernEntrantPlaybook: EntrantPlay[] = gate.insufficient
    ? []
    : (parsed.modernEntrantPlaybook ?? [])
        .filter(m => typeof m?.analogy === 'string' && m.analogy.trim().length > 0)
        .slice(0, 5)
        .map(m => ({
          analogy: m.analogy!.trim(),
          applicationToday: (m.applicationToday ?? '').trim(),
          exampleTactics: cleanStrings(m.exampleTactics, 5),
          sourceUrls: resolveSourceUrls(m.sourceIds, loop.sources),
        }));

  const summary = gate.insufficient
    ? evidence.gaps[0] ??
      `Not enough live evidence about ${company}'s competitive history to build a grounded playbook.`
    : (parsed.summary ?? '').trim();

  const draft: StealPlaybookOutput = {
    agentId: STEAL_STRATEGY_AGENT_ID,
    domain: 'steal-strategy',
    artifactType: 'steal-playbook',
    confidence,
    confidenceScore,
    facts: gate.insufficient
      ? cleanStrings(parsed.facts, 2)
      : cleanStrings(parsed.facts, 8),
    interpretation: gate.insufficient
      ? evidence.gaps
      : cleanStrings(parsed.interpretation, 8),
    sources: loop.sources,
    generatedAt: nowIso(),
    company,
    market,
    summary,
    historicalCompetitiveMoves,
    modernEntrantPlaybook,
    guardrails: (parsed.guardrails ?? '').trim() || DEFAULT_GUARDRAILS,
    evidence,
    toolCallCount: loop.toolCallCount,
    searchCallCount: loop.searchCallCount,
    scrapeCallCount: loop.scrapeCallCount,
    droppedIrrelevantCount: loop.droppedIrrelevantCount,
  };

  const sanitized = sanitizeStealOutput(draft);

  emit(onProgress, {
    agentId: 'steal-synthesis',
    name: 'Playbook synthesis',
    status: 'completed',
    completedAt: nowIso(),
  });

  return sanitized;
}

/** Re-exported for tests / route typing. */
export type { StealPlaybookOutput };
