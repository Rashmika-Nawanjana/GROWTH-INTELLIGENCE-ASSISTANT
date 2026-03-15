import { searchWeb, searchNews } from '../tools/serpapi';
import { getTechSentiment } from '../tools/hn-algolia';
import { searchReddit } from '../tools/reddit';
import { GoogleGenAI } from '@google/genai';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  AdjacentOutput,
  AdjacentThreat,
  AgentSource,
  ConfidenceLevel,
} from './types';
import { scoreToLevel } from './types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

async function run(ctx: AgentContext): Promise<AgentOutput> {
  const { query, product, competitor, priorContext } = ctx;

  const category = competitor
    ? `${product} vs ${competitor}`
    : product;

  // ── Parallel data fetch — fully dynamic based on actual product ────────────
  const [
    platformThreatResult,
    aiFundingResult,
    disruptorResult,
    fundingResult,
    hnAdjacentResult,
    redditAdjacentResult,
  ] = await Promise.allSettled([
    searchWeb(`${product} competitors alternatives disruption market 2025 2026`),
    searchWeb(`${product} category adjacent market expansion threat 2025`),
    searchWeb(`companies replacing ${product} OR disrupting ${category} 2025 2026`),
    searchNews(`${product}${competitor ? ` ${competitor}` : ''} market disruption funding threat`),
    getTechSentiment(`${product} disruption threat`),
    searchReddit(`${product} alternatives what are people using instead`),
  ]);

  // Patent signals scoped to actual product
  const [patentResult] = await Promise.allSettled([
    searchWeb(`${product} patent filing technology site:patents.google.com OR site:patents.justia.com`),
  ]);

  // ── Collect sources ────────────────────────────────────────────────────────
  const sources: AgentSource[] = [];
  const rawContent: string[] = [];

  const addWebResults = (result: PromiseSettledResult<Awaited<ReturnType<typeof searchWeb>>>, label: string) => {
    if (result.status === 'fulfilled') {
      result.value.data.slice(0, 4).forEach((r: { url: string; title: string; snippet: string }) => {
        sources.push({ url: r.url, title: r.title, timestamp: result.value.timestamp, tool: 'serpapi' });
        rawContent.push(`[${label}] ${r.title}: ${r.snippet}`);
      });
    }
  };

  addWebResults(platformThreatResult, 'PLATFORM THREAT');
  addWebResults(aiFundingResult, 'ADJACENT MARKET');
  addWebResults(disruptorResult, 'DISRUPTOR');
  addWebResults(fundingResult, 'FUNDING');

  if (hnAdjacentResult.status === 'fulfilled') {
    const { hnResult, summary } = hnAdjacentResult.value;
    hnResult.data.slice(0, 3).forEach(p => {
      sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'hn' });
    });
    rawContent.push(`[HN TECH SENTIMENT] ${summary}`);
  }
  if (redditAdjacentResult.status === 'fulfilled') {
    redditAdjacentResult.value.data.slice(0, 4).forEach(p => {
      sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'reddit' });
      rawContent.push(`[REDDIT ADJACENT] ${p.title}: ${p.snippet}`);
    });
  }
  if (patentResult.status === 'fulfilled') {
    addWebResults(patentResult, 'PATENT SIGNAL');
  }

  // ── Gemini synthesis ───────────────────────────────────────────────────────
  const systemPrompt = `You are a strategic threat analyst who identifies companies from OUTSIDE the primary category that could disrupt it. You think in terms of market adjacency, platform expansion, and category convergence.

Key question: What companies or trends are NOT currently in the ${category} space but have the distribution, data, or technology to enter it or displace it credibly within 12-18 months?

Types of adjacent threats to watch:
1. Platform expansion — large platforms adding the same capability as a feature
2. Infrastructure players — lower-level tech companies moving up-stack
3. Horizontal AI — general-purpose AI agents expanding into this vertical
4. Category convergence — adjacent tools expanding into this space
${priorContext ? `\nPrior conversation context:\n${priorContext}` : ''}`;

  const userPrompt = `Query: "${query}"
Product category: ${category}

Raw signals:
${rawContent.join('\n')}

Produce JSON:
{
  "facts": string[],
  "interpretation": string[],
  "threats": [
    {
      "company": string,
      "category": string,
      "threatVector": string,
      "riskLevel": "high" | "medium" | "low",
      "evidence": string
    }
  ],
  "overallRisk": "high" | "medium" | "low",
  "timeToImpact": string,
  "defensiveActions": string[],
  "synthesizedAnswer": string,
  "confidenceScore": number
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
    const clean = text.replace(/```jsons*/i,'').replace(/```s*/i,'').replace(/s*```$/i,'').trim(); parsed = JSON.parse(clean);
  } catch {
    parsed = {
      facts: rawContent.slice(0, 3).map(s => s.replace(/^\[[^\]]+\]\s*/, '')).filter(s => s.length > 15),
      interpretation: ['Analysis synthesis is temporarily unavailable. Raw data signals are shown below.'],
      threats: [],
      overallRisk: 'medium',
      timeToImpact: '12-18 months',
      defensiveActions: [],
      synthesizedAnswer: 'Adjacent threat data collected but synthesis failed.',
      confidenceScore: 0.4,
    };
  }

  const confScore: number = typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.6;
  const confidence: ConfidenceLevel = scoreToLevel(confScore);

  const output: AdjacentOutput = {
    agentId: 'adjacent',
    domain: 'adjacent',
    artifactType: 'threat-heatmap',
    confidence,
    confidenceScore: confScore,
    facts: parsed.facts ?? [],
    interpretation: parsed.interpretation ?? [],
    sources,
    generatedAt: new Date().toISOString(),
    threats: (parsed.threats ?? []) as AdjacentThreat[],
    overallRisk: parsed.overallRisk ?? 'medium',
    timeToImpact: parsed.timeToImpact ?? '12-18 months',
    defensiveActions: parsed.defensiveActions ?? [],
  };

  return output;
}

export const adjacentAgent: AgentConfig = {
  id: 'adjacent',
  name: 'Adjacent Threat Agent',
  description: 'Identifies companies from outside the category that could disrupt it — platform expansion, infrastructure players, category convergence.',
  run,
};
