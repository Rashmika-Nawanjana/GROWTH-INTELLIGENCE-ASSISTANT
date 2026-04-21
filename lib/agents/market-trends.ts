import { searchWeb, searchNews, searchTrends } from '../tools/serpapi';
import { searchHN, getTechSentiment } from '../tools/hn-algolia';
import { searchReddit } from '../tools/reddit';
import { planQueries } from '../tools/query-planner';
import { generateHuggingFaceJson } from './gemini';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  MarketTrendsOutput,
  TrendDataPoint,
  AgentSource,
  ConfidenceLevel,
} from './types';
import { scoreToLevel } from './types';
import { computeSignalQualityPenalty, extractToolResults } from '../tools/fallback';

function isSocialUrl(url: string): boolean {
  return /(?:^|\/\/)(?:www\.)?(x\.com|twitter\.com|linkedin\.com|instagram\.com)\//i.test(url);
}

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext } = ctx;

  // ── Smart query planning — generates 3 query variants per intent ─────────
  const queryBundle = planQueries({
    product,
    competitor,
    domain: 'market-trends',
    query,
    category: query.toLowerCase().includes('ai') ? 'AI/ML' : 'SaaS',
  });

  // ── Parallel data fetch ────────────────────────────────────────────────────
  const category = competitor
    ? `${product} vs ${competitor}`
    : product;

  const trendKeywords = [product, competitor].filter(Boolean) as string[];

  // Use query bundle: broad + targeted + hypothesis queries in parallel
  const [webResult, newsResult, trendsResult, hnResult, redditResult, webTargetedResult, webHypothesisResult, socialPulseResult] = await Promise.allSettled([
    searchWeb(queryBundle.broad),
    searchNews(`${product}${competitor ? ` ${competitor}` : ''} market growth revenue funding`),
    searchTrends(trendKeywords),
    getTechSentiment(product),
    searchReddit(queryBundle.hypothesis),
    searchWeb(queryBundle.targeted),
    searchWeb(queryBundle.hypothesis),
    searchWeb(`${product}${competitor ? ` ${competitor}` : ''} site:x.com OR site:twitter.com OR site:instagram.com OR site:linkedin.com trend launch feedback`),
  ]);

  // ── Collect sources ────────────────────────────────────────────────────────
  const sources: AgentSource[] = [];
  const rawContent: string[] = [];

  if (webResult.status === 'fulfilled') {
    webResult.value.data.slice(0, 3).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: webResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[WEB BROAD] ${r.title}: ${r.snippet}`);
    });
  }
  if (webTargetedResult.status === 'fulfilled') {
    webTargetedResult.value.data.slice(0, 2).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: webTargetedResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[WEB TARGETED] ${r.title}: ${r.snippet}`);
    });
  }
  if (webHypothesisResult.status === 'fulfilled') {
    webHypothesisResult.value.data.slice(0, 2).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: webHypothesisResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[WEB HYPOTHESIS] ${r.title}: ${r.snippet}`);
    });
  }
  if (socialPulseResult.status === 'fulfilled') {
    socialPulseResult.value.data.slice(0, 3).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: socialPulseResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[SOCIAL PULSE] ${r.title}: ${r.snippet}`);
    });
  }
  if (newsResult.status === 'fulfilled') {
    newsResult.value.data.slice(0, 4).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: newsResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[NEWS] ${r.title}: ${r.snippet}`);
    });
  }
  if (trendsResult.status === 'fulfilled') {
    const pts = trendsResult.value.data;
    sources.push({ url: trendsResult.value.sourceUrl ?? '', title: 'Google Trends', timestamp: trendsResult.value.timestamp, tool: 'serpapi' });
    const summary = pts.slice(0, 10).map(p => `${p.keyword}@${p.date}=${p.value}`).join(', ');
    rawContent.push(`[TRENDS] ${summary}`);
  }
  if (hnResult.status === 'fulfilled') {
    const { hnResult: hn, summary } = hnResult.value;
    hn.data.slice(0, 3).forEach(p => {
      sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'hn' });
    });
    rawContent.push(`[HN SENTIMENT] ${summary}`);
  }
  if (redditResult.status === 'fulfilled') {
    redditResult.value.data.slice(0, 3).forEach(p => {
      sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'reddit' });
      rawContent.push(`[REDDIT] ${p.title}: ${p.snippet}`);
    });
  }

  // If the first pass yields no social links, do strict per-domain backfill.
  const hasSocialSources = sources.some(s => isSocialUrl(s.url));
  const socialBackfillResults = hasSocialSources
    ? []
    : await Promise.allSettled([
        searchWeb(`site:x.com "${product}"${competitor ? ` OR "${competitor}"` : ''} launch OR feedback OR pricing`),
        searchWeb(`site:twitter.com "${product}"${competitor ? ` OR "${competitor}"` : ''} launch OR feedback OR pricing`),
        searchWeb(`site:linkedin.com "${product}"${competitor ? ` OR "${competitor}"` : ''} announcement OR hiring OR product update`),
        searchWeb(`site:instagram.com "${product}"${competitor ? ` OR "${competitor}"` : ''} product OR campaign`),
      ]);

  for (const result of socialBackfillResults) {
    if (result.status === 'fulfilled') {
      result.value.data
        .filter(r => isSocialUrl(r.url))
        .slice(0, 2)
        .forEach(r => {
          sources.push({ url: r.url, title: r.title, timestamp: result.value.timestamp, tool: 'serpapi' });
          rawContent.push(`[SOCIAL BACKFILL] ${r.title}: ${r.snippet}`);
        });
    }
  }

  // ── Gemini synthesis ───────────────────────────────────────────────────────
  const systemPrompt = `You are a senior market intelligence analyst. Your job is to analyse raw signals and produce structured, grounded market trend insights.

Rules:
- Separate FACTS (verifiable from sources) from INTERPRETATION (analyst view).
- Never hallucinate. Only state what the signals support.
- Be specific: name trends, estimate directions and magnitudes.
- Output valid JSON matching the schema exactly.
${priorContext ? `\nPrior conversation context:\n${priorContext}` : ''}`;

  const userPrompt = `Query: "${query}"
Product: ${product}
${competitor ? `Competitor: ${competitor}` : ''}

Raw signals collected:
${rawContent.join('\n')}

Produce a JSON object with this exact shape:
{
  "facts": string[],          // 4-6 verifiable claims directly from the signals
  "interpretation": string[], // 3-4 analyst insights derived from the facts
  "trends": [
    {
      "keyword": string,
      "direction": "up" | "down" | "flat",
      "changePercent": number,
      "signal": string,
      "source": string
    }
  ],
  "categoryOutlook": "accelerating" | "consolidating" | "maturing" | "emerging",
  "keySignals": string[],     // top 3 leading indicators
  "timeHorizon": string,
  "synthesizedAnswer": string, // 2-3 sentence plain-English summary
  "confidenceScore": number    // 0.0 - 1.0
}`;

  let parsed: any = {};
  try {
    parsed = await generateHuggingFaceJson<any>(systemPrompt, userPrompt, {
      maxNewTokens: 1400,
      temperature: 0.2,
    });
  } catch {
    parsed = {
      facts: rawContent.slice(0, 4).map(s => s.replace(/^\[[^\]]+\]\s*/, '')).filter(s => s.length > 15),
      interpretation: ['Analysis synthesis is temporarily unavailable. Raw data signals are shown below.'],
      trends: [],
      categoryOutlook: 'emerging',
      keySignals: [],
      timeHorizon: '6-12 months',
      synthesizedAnswer: 'Market trend data was collected but synthesis encountered an error.',
      confidenceScore: 0.4,
    };
  }

  const rawScore: number = typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.6;
  // Penalise the Gemini-reported score by the aggregate signal quality of the
  // tool calls that fed it — a synthesis with 3 failed tools shouldn't get the
  // same confidence as one with all tools succeeding.
  const toolResults = extractToolResults([
    webResult,
    newsResult,
    trendsResult,
    hnResult,
    redditResult,
    webTargetedResult,
    webHypothesisResult,
    socialPulseResult,
    ...socialBackfillResults,
  ]);
  const signalPenalty = computeSignalQualityPenalty(toolResults, 8 + socialBackfillResults.length);
  const confScore = Number.parseFloat((rawScore * signalPenalty).toFixed(2));
  const confidence: ConfidenceLevel = scoreToLevel(confScore);

  const output: MarketTrendsOutput = {
    agentId: 'market-trends',
    domain: 'market-trends',
    artifactType: 'trend-chart',
    confidence,
    confidenceScore: confScore,
    facts: parsed.facts ?? [],
    interpretation: parsed.interpretation ?? [],
    sources,
    generatedAt: new Date().toISOString(),
    trends: (parsed.trends ?? []) as TrendDataPoint[],
    categoryOutlook: parsed.categoryOutlook ?? 'emerging',
    keySignals: parsed.keySignals ?? [],
    timeHorizon: parsed.timeHorizon ?? '6-12 months',
  };

  return output;
}

export const marketTrendsAgent: AgentConfig = {
  id: 'market-trends',
  name: 'Trend Sensor',
  description: 'Detects market direction via job postings, funding signals, search trends, and news.',
  run,
};
