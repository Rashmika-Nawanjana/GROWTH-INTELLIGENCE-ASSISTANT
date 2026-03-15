import { searchWeb, searchNews, searchTrends } from '../tools/serpapi';
import { searchHN, getTechSentiment } from '../tools/hn-algolia';
import { searchReddit } from '../tools/reddit';
import { GoogleGenAI } from '@google/genai';
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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext } = ctx;

  // ── Parallel data fetch ────────────────────────────────────────────────────
  const category = competitor
    ? `${product} vs ${competitor}`
    : product;

  const [webResult, newsResult, trendsResult, hnResult, redditResult] = await Promise.allSettled([
    searchWeb(`${category} market trends 2025 2026`),
    searchNews(`${product} ${competitor ?? ''} AI market growth funding`),
    searchTrends([product, competitor ?? 'AI SDR', 'AI sales automation', 'voice AI sales'].filter(Boolean)),
    getTechSentiment(`${product} ${competitor ?? ''}`),
    searchReddit(`${category} market growth trend`, 'sales'),
  ]);

  // ── Collect sources ────────────────────────────────────────────────────────
  const sources: AgentSource[] = [];
  const rawContent: string[] = [];

  if (webResult.status === 'fulfilled') {
    webResult.value.data.slice(0, 5).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: webResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[WEB] ${r.title}: ${r.snippet}`);
    });
  }
  if (newsResult.status === 'fulfilled') {
    newsResult.value.data.slice(0, 5).forEach(r => {
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
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: systemPrompt,
        responseMimeType: 'application/json',
      },
    });
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    parsed = JSON.parse(text);
  } catch {
    parsed = {
      facts: rawContent.slice(0, 4),
      interpretation: ['Analysis could not be synthesised due to an error.'],
      trends: [],
      categoryOutlook: 'emerging',
      keySignals: [],
      timeHorizon: '6-12 months',
      synthesizedAnswer: 'Market trend data was collected but synthesis encountered an error.',
      confidenceScore: 0.4,
    };
  }

  const confScore: number = typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.6;
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
