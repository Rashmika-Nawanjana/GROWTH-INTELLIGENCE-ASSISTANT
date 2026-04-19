import { searchWeb } from '../tools/serpapi';
import { scrapePage } from '../tools/firecrawl';
import { searchReddit, searchProductReviews } from '../tools/reddit';
import { searchHN } from '../tools/hn-algolia';
import { GoogleGenAI } from '@google/genai';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  WinLossOutput,
  WinReason,
  AgentSource,
  ConfidenceLevel,
} from './types';
import { scoreToLevel } from './types';
import { buildContentParts } from './gemini-utils';
import { computeSignalQualityPenalty, extractToolResults } from '../tools/fallback';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// G2 and Capterra review page patterns
function getReviewUrls(product: string, competitor: string): string[] {
  const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-');
  return [
    `https://www.g2.com/products/${slug(competitor)}/reviews`,
    `https://www.capterra.com/p/search/?q=${encodeURIComponent(competitor)}`,
  ];
}

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext, images } = ctx;

  const competitorName = competitor ?? 'main competitor';

  const reviewUrls = getReviewUrls(product, competitorName);

  // ── Parallel data fetch ────────────────────────────────────────────────────
  const [
    webResult,
    redditProductResult,
    redditCompetitorResult,
    hnResult,
    g2ScrapeResult,
  ] = await Promise.allSettled([
    searchWeb(`${competitorName} vs ${product} review pros cons 2025`),
    searchProductReviews(product),
    searchProductReviews(competitorName),
    searchHN(`${competitorName} ${product} review comparison`),
    scrapePage(reviewUrls[0]),
  ]);

  // Also search for deal loss reasons in sales-adjacent communities
  const [salesRedditResult] = await Promise.allSettled([
    searchReddit(`${product} review alternative experience`),
  ]);

  // ── Collect sources ────────────────────────────────────────────────────────
  const sources: AgentSource[] = [];
  const rawContent: string[] = [];

  if (webResult.status === 'fulfilled') {
    webResult.value.data.slice(0, 5).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: webResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[REVIEW SEARCH] ${r.title}: ${r.snippet}`);
    });
  }
  if (redditProductResult.status === 'fulfilled') {
    redditProductResult.value.data.slice(0, 4).forEach(p => {
      sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'reddit' });
      rawContent.push(`[REDDIT ${product}] sentiment=${p.sentiment} | ${p.title}: ${p.snippet}`);
    });
  }
  if (redditCompetitorResult.status === 'fulfilled') {
    redditCompetitorResult.value.data.slice(0, 4).forEach(p => {
      sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'reddit' });
      rawContent.push(`[REDDIT ${competitorName}] sentiment=${p.sentiment} | ${p.title}: ${p.snippet}`);
    });
  }
  if (hnResult.status === 'fulfilled') {
    hnResult.value.data.slice(0, 3).forEach(p => {
      sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'hn' });
      rawContent.push(`[HN] ${p.title}`);
    });
  }
  if (g2ScrapeResult.status === 'fulfilled') {
    const page = g2ScrapeResult.value.data;
    sources.push({ url: page.url, title: `${competitorName} G2 Reviews`, timestamp: g2ScrapeResult.value.timestamp, tool: 'firecrawl' });
    rawContent.push(`[G2 REVIEWS] ${page.excerpt}`);
  }
  if (salesRedditResult.status === 'fulfilled') {
    salesRedditResult.value.data.slice(0, 3).forEach(p => {
      sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'reddit' });
      rawContent.push(`[SALES REDDIT] ${p.title}: ${p.snippet}`);
    });
  }

  // ── Gemini synthesis ───────────────────────────────────────────────────────
  const systemPrompt = `You are a win/loss analyst who reads buyer reviews, Reddit discussions, and comparison content to understand WHY deals are won or lost. You look for patterns in real buyer language.

Rules:
- Focus on the BUYER perspective, not vendor claims.
- Separate facts (quoted from reviews) from interpretation.
- Be specific about reasons — generic answers are useless.
- Frequency: "often" = mentioned 3+ times, "sometimes" = 1-2 times, "rarely" = once.
${priorContext ? `\nPrior conversation context:\n${priorContext}` : ''}`;

  const userPrompt = `Query: "${query}"
Our product: ${product}
Competitor: ${competitorName}

Raw signals (buyer reviews, Reddit posts, comparisons):
${rawContent.join('\n')}

Produce JSON:
{
  "facts": string[],
  "interpretation": string[],
  "competitorWins": [
    { "reason": string, "frequency": "often" | "sometimes" | "rarely", "evidence": string }
  ],
  "competitorLosses": [
    { "reason": string, "frequency": "often" | "sometimes" | "rarely", "evidence": string }
  ],
  "buyerSentiment": "positive" | "mixed" | "negative",
  "topSwitchTriggers": string[],
  "synthesizedAnswer": string,
  "confidenceScore": number
}`;

  let parsed: any = {};
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: buildContentParts(userPrompt, images) }],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
      },
    });
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const clean = text.replace(/```jsons*/i,'').replace(/```s*/i,'').replace(/s*```$/i,'').trim(); parsed = JSON.parse(clean);
  } catch {
    parsed = {
      facts: rawContent.slice(0, 3).map(s => s.replace(/^\[[^\]]+\]\s*/, '')).filter(s => s.length > 15),
      interpretation: ['Analysis synthesis is temporarily unavailable. Raw data signals are shown below.'],
      competitorWins: [],
      competitorLosses: [],
      buyerSentiment: 'mixed',
      topSwitchTriggers: [],
      synthesizedAnswer: 'Buyer sentiment data collected but synthesis failed.',
      confidenceScore: 0.4,
    };
  }

  const rawScore: number = typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.6;
  const toolResults = extractToolResults([webResult, redditProductResult, redditCompetitorResult, hnResult, g2ScrapeResult, salesRedditResult]);
  const confScore = Number.parseFloat((rawScore * computeSignalQualityPenalty(toolResults, 6)).toFixed(2));
  const confidence: ConfidenceLevel = scoreToLevel(confScore);

  const output: WinLossOutput = {
    agentId: 'win-loss',
    domain: 'win-loss',
    artifactType: 'win-loss-scorecard',
    confidence,
    confidenceScore: confScore,
    facts: parsed.facts ?? [],
    interpretation: parsed.interpretation ?? [],
    sources,
    generatedAt: new Date().toISOString(),
    competitor: competitorName,
    competitorWins: (parsed.competitorWins ?? []) as WinReason[],
    competitorLosses: (parsed.competitorLosses ?? []) as WinReason[],
    buyerSentiment: parsed.buyerSentiment ?? 'mixed',
    topSwitchTriggers: parsed.topSwitchTriggers ?? [],
  };

  return output;
}

export const winLossAgent: AgentConfig = {
  id: 'win-loss',
  name: 'Win/Loss Agent',
  description: 'Reads G2 reviews, Reddit, and HN to surface why buyers choose one product over another.',
  run,
};
