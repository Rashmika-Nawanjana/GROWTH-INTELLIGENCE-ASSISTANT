import { searchWeb, searchNews } from '../tools/serpapi';
import { scrapePage, scrapeCompetitorPricing } from '../tools/firecrawl';
import { searchHN } from '../tools/hn-algolia';
import { scrapeTwitterX } from '../tools/apify-twitter';
import { generateHuggingFaceJson } from './gemini';
import {
  competitorSiteUrl,
  isUsableScrapePage,
  skippedScrapePromise,
} from './entity-url';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  CompetitiveOutput,
  CompetitorFeature,
  AgentSource,
  ConfidenceLevel,
} from './types';
import { scoreToLevel } from './types';
import { computeSignalQualityPenalty, extractToolResults } from '../tools/fallback';

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext } = ctx;

  const competitorName = competitor ?? 'relevant competitors';
  const compUrl = competitorSiteUrl(ctx);

  // ── Parallel data fetch ────────────────────────────────────────────────────
  const [webResult, newsResult, hnResult, scrapeResult, pricingResult, socialSignalsResult, apifyTwitterResult] = await Promise.allSettled([
    searchWeb(`${competitorName} features product update 2025 2026`),
    searchNews(`${competitorName} funding launch product announcement 2025`),
    searchHN(`${competitorName} ${product}`),
    compUrl ? scrapePage(compUrl) : skippedScrapePromise(),
    compUrl ? scrapeCompetitorPricing(compUrl) : skippedScrapePromise(),
    searchWeb(`${competitorName} ${product} site:x.com OR site:twitter.com OR site:instagram.com OR site:linkedin.com launch feature feedback`),
    scrapeTwitterX([`${competitorName} ${product}`, `${competitorName} launch feedback`], {
      handles: [competitorName].filter(Boolean),
      maxItems: 80,
      sort: 'Latest',
      language: 'en',
    }),
  ]);

  // Hiring signals
  const hiringResult = await Promise.allSettled([
    searchWeb(`${competitorName} jobs hiring "AI" OR "machine learning" OR "sales" site:linkedin.com OR site:greenhouse.io`),
  ]);

  // ── Collect sources ────────────────────────────────────────────────────────
  const sources: AgentSource[] = [];
  const rawContent: string[] = [];

  if (webResult.status === 'fulfilled') {
    webResult.value.data.slice(0, 5).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: webResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[COMPETITOR WEB] ${r.title}: ${r.snippet}`);
    });
  }
  if (newsResult.status === 'fulfilled') {
    newsResult.value.data.slice(0, 4).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: newsResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[COMPETITOR NEWS] ${r.title}: ${r.snippet}`);
    });
  }
  if (hnResult.status === 'fulfilled') {
    hnResult.value.data.slice(0, 3).forEach(p => {
      sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'hn' });
      rawContent.push(`[HN] ${p.title}`);
    });
  }
  if (isUsableScrapePage(scrapeResult)) {
    const page = scrapeResult.value.data;
    sources.push({ url: page.url, title: page.title || competitorName, timestamp: scrapeResult.value.timestamp, tool: 'firecrawl' });
    rawContent.push(`[COMPETITOR HOMEPAGE] ${page.excerpt}`);
  }
  if (isUsableScrapePage(pricingResult)) {
    const page = pricingResult.value.data;
    const label = competitor ? `${competitor} pricing` : 'Competitor pricing page';
    sources.push({ url: page.url, title: label, timestamp: pricingResult.value.timestamp, tool: 'firecrawl' });
    rawContent.push(`[COMPETITOR PRICING] ${page.excerpt}`);
  }
  if (socialSignalsResult.status === 'fulfilled') {
    socialSignalsResult.value.data.slice(0, 3).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: socialSignalsResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[SOCIAL SIGNAL] ${r.title}: ${r.snippet}`);
    });
  }
  if (apifyTwitterResult.status === 'fulfilled') {
    apifyTwitterResult.value.data.slice(0, 8).forEach(t => {
      sources.push({
        url: t.url,
        title: `X @${t.authorHandle ?? 'unknown'}`,
        timestamp: t.createdAt ?? apifyTwitterResult.value.timestamp,
        tool: 'apify',
      });
      rawContent.push(
        `[APIFY X] @${t.authorHandle ?? 'unknown'}: ${t.text}` +
        `${typeof t.likeCount === 'number' ? ` (likes ${t.likeCount})` : ''}`
      );
    });
  }
  if (hiringResult[0].status === 'fulfilled') {
    hiringResult[0].value.data.slice(0, 3).forEach(r => {
      rawContent.push(`[HIRING SIGNAL] ${r.title}: ${r.snippet}`);
    });
  }

  // ── Gemini synthesis ───────────────────────────────────────────────────────
  const systemPrompt = `You are a competitive intelligence analyst specialising in B2B SaaS. You compare product capabilities with brutal honesty. You separate facts from interpretation. You never fabricate features.
${priorContext ? `\nPrior conversation context:\n${priorContext}` : ''}`;

  const userPrompt = `Query: "${query}"
Our product: ${product}
Competitor: ${competitorName}

Raw signals:
${rawContent.join('\n')}

Produce a JSON object:
{
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

For the matrix, infer the most relevant feature dimensions from the signals above. Choose dimensions that are actually relevant to ${product} and ${competitorName} based on what the data shows.`;

  let parsed: any = {};
  try {
    parsed = await generateHuggingFaceJson<any>(systemPrompt, userPrompt, {
      maxNewTokens: 1400,
      temperature: 0.2,
    });
  } catch {
    parsed = {
      facts: rawContent.slice(0, 3).map(s => s.replace(/^\[[^\]]+\]\s*/, '')).filter(s => s.length > 15),
      interpretation: ['Analysis synthesis is temporarily unavailable. Raw data signals are shown below.'],
      competitorSummary: `${competitorName} competitive data collected.`,
      matrix: [],
      hiringSignals: [],
      recentMoves: [],
      synthesizedAnswer: 'Competitive data was gathered but synthesis failed.',
      confidenceScore: 0.4,
    };
  }

  const rawScore: number = typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.6;
  const toolResults = extractToolResults([webResult, newsResult, hnResult, scrapeResult, pricingResult, socialSignalsResult, apifyTwitterResult, hiringResult[0]]);
  const confScore = Number.parseFloat((rawScore * computeSignalQualityPenalty(toolResults, 8)).toFixed(2));
  const confidence: ConfidenceLevel = scoreToLevel(confScore);

  const output: CompetitiveOutput = {
    agentId: 'competitive',
    domain: 'competitive',
    artifactType: 'competitive-matrix',
    confidence,
    confidenceScore: confScore,
    facts: parsed.facts ?? [],
    interpretation: parsed.interpretation ?? [],
    sources,
    generatedAt: new Date().toISOString(),
    competitor: competitorName,
    matrix: (parsed.matrix ?? []) as CompetitorFeature[],
    competitorSummary: parsed.competitorSummary ?? '',
    hiringSignals: parsed.hiringSignals ?? [],
    recentMoves: parsed.recentMoves ?? [],
  };

  return output;
}

export const competitiveAgent: AgentConfig = {
  id: 'competitive',
  name: 'Competitive Agent',
  description: 'Scrapes competitor product pages, changelogs, and pricing to build a feature comparison matrix.',
  run,
};
