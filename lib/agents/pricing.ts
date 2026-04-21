import { searchWeb } from '../tools/serpapi';
import { scrapePage, scrapeCompetitorPricing } from '../tools/firecrawl';
import { searchReddit } from '../tools/reddit';
import { generateHuggingFaceJson } from './gemini';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  PricingOutput,
  PricingTier,
  AgentSource,
  ConfidenceLevel,
} from './types';
import { scoreToLevel } from './types';
import { computeSignalQualityPenalty, extractToolResults } from '../tools/fallback';
import {
  competitorSiteUrl,
  isUsableScrapePage,
  productSiteUrl,
  skippedScrapePromise,
} from './entity-url';

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext } = ctx;

  const competitorName = competitor ?? 'relevant competitors';
  const compUrl = competitorSiteUrl(ctx);
  const prodUrl = productSiteUrl(ctx);

  // ── Parallel data fetch ────────────────────────────────────────────────────
  const [
    webResult,
    compPricingResult,
    prodPricingResult,
    redditPricingResult,
    pricingNewsResult,
  ] = await Promise.allSettled([
    searchWeb(`${competitorName} pricing plans cost per seat 2025`),
    compUrl ? scrapeCompetitorPricing(compUrl) : skippedScrapePromise(),
    prodUrl ? scrapeCompetitorPricing(prodUrl) : skippedScrapePromise(),
    searchReddit(`${competitorName} pricing expensive cheap worth it`),
    searchWeb(`${product} OR ${competitorName} pricing model SaaS willingness to pay`),
  ]);

  // ── Collect sources ────────────────────────────────────────────────────────
  const sources: AgentSource[] = [];
  const rawContent: string[] = [];

  if (webResult.status === 'fulfilled') {
    webResult.value.data.slice(0, 5).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: webResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[PRICING WEB] ${r.title}: ${r.snippet}`);
    });
  }
  if (isUsableScrapePage(compPricingResult)) {
    const page = compPricingResult.value.data;
    const title = competitor ? `${competitor} — pricing page` : 'Competitor pricing page';
    sources.push({ url: page.url, title, timestamp: compPricingResult.value.timestamp, tool: 'firecrawl' });
    rawContent.push(`[COMPETITOR PRICING PAGE] ${page.excerpt}`);
  }
  if (isUsableScrapePage(prodPricingResult)) {
    const page = prodPricingResult.value.data;
    const title = product.length < 50 ? `${product} — pricing page` : 'Product pricing page';
    sources.push({ url: page.url, title, timestamp: prodPricingResult.value.timestamp, tool: 'firecrawl' });
    rawContent.push(`[OUR PRICING PAGE] ${page.excerpt}`);
  }
  if (redditPricingResult.status === 'fulfilled') {
    redditPricingResult.value.data.slice(0, 4).forEach(p => {
      sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'reddit' });
      rawContent.push(`[REDDIT PRICING] sentiment=${p.sentiment} | ${p.title}: ${p.snippet}`);
    });
  }
  if (pricingNewsResult.status === 'fulfilled') {
    pricingNewsResult.value.data.slice(0, 3).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: pricingNewsResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[PRICING NEWS] ${r.title}: ${r.snippet}`);
    });
  }

  // ── Gemini synthesis ───────────────────────────────────────────────────────
  const systemPrompt = `You are a pricing strategist who analyses SaaS pricing models, buyer willingness-to-pay signals, and competitive pricing dynamics. You extract concrete pricing data and identify strategic opportunities.
${priorContext ? `\nPrior conversation context:\n${priorContext}` : ''}`;

  const userPrompt = `Query: "${query}"
Our product: ${product}
Competitor: ${competitorName}

Raw signals:
${rawContent.join('\n')}

Produce JSON:
{
  "facts": string[],
  "interpretation": string[],
  "competitorPricing": [
    {
      "tierName": string,
      "price": string,
      "features": string[],
      "targetSegment": string
    }
  ],
  "yourPricing": [
    {
      "tierName": string,
      "price": string,
      "features": string[],
      "targetSegment": string
    }
  ],
  "willingnessToPay": "premium" | "mid-market" | "price-sensitive",
  "pricingSignals": string[],
  "recommendation": string,
  "synthesizedAnswer": string,
  "confidenceScore": number
}`;

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
      competitorPricing: [],
      yourPricing: [],
      willingnessToPay: 'mid-market',
      pricingSignals: [],
      recommendation: 'Could not synthesize pricing recommendation.',
      synthesizedAnswer: 'Pricing data collected but synthesis failed.',
      confidenceScore: 0.4,
    };
  }

  const rawScore: number = typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.6;
  const toolResults = extractToolResults([webResult, compPricingResult, prodPricingResult, redditPricingResult, pricingNewsResult]);
  const confScore = Number.parseFloat((rawScore * computeSignalQualityPenalty(toolResults, 5)).toFixed(2));
  const confidence: ConfidenceLevel = scoreToLevel(confScore);

  const output: PricingOutput = {
    agentId: 'pricing',
    domain: 'pricing',
    artifactType: 'pricing-table',
    confidence,
    confidenceScore: confScore,
    facts: parsed.facts ?? [],
    interpretation: parsed.interpretation ?? [],
    sources,
    generatedAt: new Date().toISOString(),
    competitorPricing: (parsed.competitorPricing ?? []) as PricingTier[],
    yourPricing: (parsed.yourPricing ?? []) as PricingTier[],
    willingnessToPay: parsed.willingnessToPay ?? 'mid-market',
    pricingSignals: parsed.pricingSignals ?? [],
    recommendation: parsed.recommendation ?? '',
  };

  return output;
}

export const pricingAgent: AgentConfig = {
  id: 'pricing',
  name: 'Pricing Agent',
  description: 'Scrapes pricing pages and buyer discussions to map pricing models and willingness-to-pay signals.',
  run,
};
