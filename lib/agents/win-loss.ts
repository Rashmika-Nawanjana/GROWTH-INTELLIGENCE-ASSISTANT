import { searchWeb } from '../tools/serpapi';
import { scrapePage } from '../tools/firecrawl';
import { searchReddit, searchProductReviews } from '../tools/reddit';
import { searchHN } from '../tools/hn-algolia';
import { generateHuggingFaceJson } from './gemini';
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
import { computeSignalQualityPenalty, extractToolResults } from '../tools/fallback';
import { isPlaceholderCompetitor, isUsableScrapePage, skippedScrapePromise } from './entity-url';

function g2ReviewsUrl(competitorBrand: string): string {
  const slug = competitorBrand.toLowerCase().replace(/\s+/g, '-');
  return `https://www.g2.com/products/${slug}/reviews`;
}

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext } = ctx;

  const competitorName = competitor ?? 'relevant competitors';
  const g2Url = !isPlaceholderCompetitor(competitor) && competitor?.trim()
    ? g2ReviewsUrl(competitor)
    : null;

  // ── Parallel data fetch ────────────────────────────────────────────────────
  const [
    webResult,
    redditProductResult,
    redditCompetitorResult,
    hnResult,
    g2ScrapeResult,
    socialReviewResult,
  ] = await Promise.allSettled([
    searchWeb(`${competitorName} vs ${product} review pros cons 2025`),
    searchProductReviews(product),
    searchProductReviews(competitorName),
    searchHN(`${competitorName} ${product} review comparison`),
    g2Url ? scrapePage(g2Url) : skippedScrapePromise(),
    searchWeb(`${competitorName} vs ${product} site:x.com OR site:twitter.com OR site:instagram.com OR site:linkedin.com review comparison buyer feedback`),
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
  if (isUsableScrapePage(g2ScrapeResult) && competitor) {
    const page = g2ScrapeResult.value.data;
    sources.push({ url: page.url, title: `${competitor} — G2 reviews`, timestamp: g2ScrapeResult.value.timestamp, tool: 'firecrawl' });
    rawContent.push(`[G2 REVIEWS] ${page.excerpt}`);
  }
  if (socialReviewResult.status === 'fulfilled') {
    socialReviewResult.value.data.slice(0, 3).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: socialReviewResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[SOCIAL REVIEW] ${r.title}: ${r.snippet}`);
    });
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
    parsed = await generateHuggingFaceJson<any>(systemPrompt, userPrompt, {
      maxNewTokens: 1400,
      temperature: 0.2,
    });
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
  const toolResults = extractToolResults([webResult, redditProductResult, redditCompetitorResult, hnResult, g2ScrapeResult, socialReviewResult, salesRedditResult]);
  const confScore = Number.parseFloat((rawScore * computeSignalQualityPenalty(toolResults, 7)).toFixed(2));
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
