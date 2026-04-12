import { searchWeb, searchAdsTransparency } from '../tools/serpapi';
import { scrapePage } from '../tools/firecrawl';
import { searchReddit } from '../tools/reddit';
import { GoogleGenAI } from '@google/genai';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  PositioningOutput,
  MessagingGap,
  AgentSource,
  ConfidenceLevel,
} from './types';
import { scoreToLevel } from './types';
import { buildContentParts } from './gemini-utils';
import { computeSignalQualityPenalty, extractToolResults } from '../tools/fallback';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, competitorUrl, productUrl, priorContext, images } = ctx;

  const competitorName = competitor ?? 'main competitor';
  const compUrl = competitorUrl ??
    `https://${competitorName.toLowerCase().replace(/\s+/g, '')}.com`;
  const prodUrl = productUrl ??
    `https://${product.toLowerCase().replace(/\s+/g, '')}.com`;

  // ── Parallel data fetch ────────────────────────────────────────────────────
  const [
    compHomeResult,
    prodHomeResult,
    compAdsResult,
    prodAdsResult,
    messagingSearchResult,
    redditPerceptionResult,
  ] = await Promise.allSettled([
    scrapePage(compUrl),
    scrapePage(prodUrl),
    searchAdsTransparency(competitorName),
    searchAdsTransparency(product),
    searchWeb(`${competitorName} vs ${product} messaging positioning marketing`),
    searchReddit(`how does ${competitorName} market itself brand positioning`),
  ]);

  // Scrape about/story pages for deeper positioning signals
  const [compAboutResult, prodAboutResult] = await Promise.allSettled([
    scrapePage(`${compUrl.replace(/\/$/, '')}/about`),
    scrapePage(`${prodUrl.replace(/\/$/, '')}/about`),
  ]);

  // ── Collect sources ────────────────────────────────────────────────────────
  const sources: AgentSource[] = [];
  const rawContent: string[] = [];

  if (compHomeResult.status === 'fulfilled') {
    const page = compHomeResult.value.data;
    sources.push({ url: page.url, title: `${competitorName} Homepage`, timestamp: compHomeResult.value.timestamp, tool: 'firecrawl' });
    rawContent.push(`[COMPETITOR HOMEPAGE] ${page.excerpt}`);
  }
  if (prodHomeResult.status === 'fulfilled') {
    const page = prodHomeResult.value.data;
    sources.push({ url: page.url, title: `${product} Homepage`, timestamp: prodHomeResult.value.timestamp, tool: 'firecrawl' });
    rawContent.push(`[OUR HOMEPAGE] ${page.excerpt}`);
  }
  if (compAboutResult.status === 'fulfilled') {
    rawContent.push(`[COMPETITOR ABOUT] ${compAboutResult.value.data.excerpt}`);
  }
  if (prodAboutResult.status === 'fulfilled') {
    rawContent.push(`[OUR ABOUT] ${prodAboutResult.value.data.excerpt}`);
  }
  if (compAdsResult.status === 'fulfilled') {
    compAdsResult.value.data.slice(0, 3).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: compAdsResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[COMPETITOR AD] ${r.title}: ${r.snippet}`);
    });
  }
  if (prodAdsResult.status === 'fulfilled') {
    prodAdsResult.value.data.slice(0, 3).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: prodAdsResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[OUR AD] ${r.title}: ${r.snippet}`);
    });
  }
  if (messagingSearchResult.status === 'fulfilled') {
    messagingSearchResult.value.data.slice(0, 4).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: messagingSearchResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[MESSAGING SEARCH] ${r.title}: ${r.snippet}`);
    });
  }
  if (redditPerceptionResult.status === 'fulfilled') {
    redditPerceptionResult.value.data.slice(0, 3).forEach(p => {
      sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'reddit' });
      rawContent.push(`[REDDIT PERCEPTION] ${p.title}: ${p.snippet}`);
    });
  }

  // ── Gemini synthesis ───────────────────────────────────────────────────────
  const systemPrompt = `You are a brand positioning strategist. You analyse how companies talk about themselves — their hero message, value frame, audience language — and find gaps and opportunities.

Key insight: Positioning is not what you build, it's how you talk about what already exists. A company can have the same product but win or lose based on messaging.

Look for:
- Value framing differences (technology-first vs outcome-first)
- Audience language differences
- Emotional vs functional emphasis
- Category claim differences (e.g. "AI SDR" vs "Revenue automation")
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
  "yourPositioning": string,
  "competitorPositioning": string,
  "gaps": [
    {
      "dimension": string,
      "yourMessage": string,
      "competitorMessage": string,
      "gap": string,
      "opportunity": string
    }
  ],
  "adThemes": string[],
  "synthesizedAnswer": string,
  "confidenceScore": number
}

Dimensions to analyse: Value Framing, Audience Language, Category Claim, Emotional Appeal, Social Proof Style, Feature Focus vs Outcome Focus, Brand Personality.`;

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
      yourPositioning: '',
      competitorPositioning: '',
      gaps: [],
      adThemes: [],
      synthesizedAnswer: 'Positioning data collected but synthesis failed.',
      confidenceScore: 0.4,
    };
  }

  const rawScore: number = typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.6;
  const toolResults = extractToolResults([compHomeResult, prodHomeResult, compAdsResult, prodAdsResult, messagingSearchResult, redditPerceptionResult, compAboutResult, prodAboutResult]);
  const confScore = Number.parseFloat((rawScore * computeSignalQualityPenalty(toolResults, 8)).toFixed(2));
  const confidence: ConfidenceLevel = scoreToLevel(confScore);

  const output: PositioningOutput = {
    agentId: 'positioning',
    domain: 'positioning',
    artifactType: 'positioning-gap',
    confidence,
    confidenceScore: confScore,
    facts: parsed.facts ?? [],
    interpretation: parsed.interpretation ?? [],
    sources,
    generatedAt: new Date().toISOString(),
    competitor: competitorName,
    yourPositioning: parsed.yourPositioning ?? '',
    competitorPositioning: parsed.competitorPositioning ?? '',
    gaps: (parsed.gaps ?? []) as MessagingGap[],
    adThemes: parsed.adThemes ?? [],
  };

  return output;
}

export const positioningAgent: AgentConfig = {
  id: 'positioning',
  name: 'Positioning Agent',
  description: 'Analyses homepages, ads, and marketing copy to surface messaging gaps and positioning opportunities.',
  run,
};
