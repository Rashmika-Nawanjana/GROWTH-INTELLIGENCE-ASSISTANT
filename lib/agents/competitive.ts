import { searchWeb, searchNews } from '../tools/serpapi';
import { scrapePage, scrapeCompetitorPricing } from '../tools/firecrawl';
import { searchHN } from '../tools/hn-algolia';
import { GoogleGenAI } from '@google/genai';
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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, competitorUrl, priorContext } = ctx;

  const competitorName = competitor ?? 'main competitor';
  // Infer competitor URL if not provided
  const compUrl = competitorUrl ??
    `https://${competitorName.toLowerCase().replace(/\s+/g, '')}.com`;

  // ── Parallel data fetch ────────────────────────────────────────────────────
  const [webResult, newsResult, hnResult, scrapeResult, pricingResult] = await Promise.allSettled([
    searchWeb(`${competitorName} AI SDR features changelog product update 2025`),
    searchNews(`${competitorName} funding launch feature announcement`),
    searchHN(`${competitorName} ${product}`),
    scrapePage(compUrl),
    scrapeCompetitorPricing(compUrl),
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
  if (scrapeResult.status === 'fulfilled') {
    const page = scrapeResult.value.data;
    sources.push({ url: page.url, title: page.title, timestamp: scrapeResult.value.timestamp, tool: 'firecrawl' });
    rawContent.push(`[COMPETITOR HOMEPAGE] ${page.excerpt}`);
  }
  if (pricingResult.status === 'fulfilled') {
    const page = pricingResult.value.data;
    sources.push({ url: page.url, title: `${competitorName} Pricing`, timestamp: pricingResult.value.timestamp, tool: 'firecrawl' });
    rawContent.push(`[COMPETITOR PRICING] ${page.excerpt}`);
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

For the matrix, evaluate these dimensions: AI Email Automation, Voice AI, CRM Integrations, Personalization Engine, LinkedIn Outreach, Analytics & Reporting, Workflow Builder, API & Integrations, Onboarding UX, Pricing Flexibility.`;

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
      facts: rawContent.slice(0, 3),
      interpretation: ['Competitive synthesis encountered an error.'],
      competitorSummary: `${competitorName} competitive data collected.`,
      matrix: [],
      hiringSignals: [],
      recentMoves: [],
      synthesizedAnswer: 'Competitive data was gathered but synthesis failed.',
      confidenceScore: 0.4,
    };
  }

  const confScore: number = typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.6;
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
