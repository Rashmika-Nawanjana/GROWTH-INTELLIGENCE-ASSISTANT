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
    ? `${product} ${competitor} AI SDR`
    : `${product} AI sales automation`;

  // ── Parallel data fetch ────────────────────────────────────────────────────
  const [
    crmThreatResult,
    openaiThreatResult,
    voiceThreatResult,
    fundingResult,
    hnAdjacentResult,
    redditAdjacentResult,
  ] = await Promise.allSettled([
    searchWeb('CRM Salesforce HubSpot AI SDR built-in sales automation 2025'),
    searchWeb('OpenAI agents GPT sales outreach automation disruption 2025'),
    searchWeb('voice AI sales automation startup funding 2025'),
    searchNews('AI sales automation funding round Series A B 2025'),
    getTechSentiment('AI SDR disruption CRM'),
    searchReddit('AI SDR alternatives CRM built-in sales AI automation'),
  ]);

  // Scrape a patent signal (USPTO) if possible
  const [patentResult] = await Promise.allSettled([
    searchWeb(`"AI sales development representative" OR "AI SDR" patent filing site:patents.google.com OR site:patents.justia.com`),
  ]);

  // ── Collect sources ────────────────────────────────────────────────────────
  const sources: AgentSource[] = [];
  const rawContent: string[] = [];

  const addWebResults = (result: typeof crmThreatResult, label: string) => {
    if (result.status === 'fulfilled') {
      result.value.data.slice(0, 4).forEach(r => {
        sources.push({ url: r.url, title: r.title, timestamp: result.value.timestamp, tool: 'serpapi' });
        rawContent.push(`[${label}] ${r.title}: ${r.snippet}`);
      });
    }
  };

  addWebResults(crmThreatResult, 'CRM THREAT');
  addWebResults(openaiThreatResult, 'OPENAI THREAT');
  addWebResults(voiceThreatResult, 'VOICE THREAT');
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

Key question: What companies are NOT currently in the AI SDR market but have the distribution, data, or technology to enter it credibly within 12-18 months?

Types of adjacent threats to watch:
1. Platform expansion — large platforms (CRM, communication) adding adjacent features
2. Infrastructure players — AI/ML infrastructure companies moving up-stack
3. Horizontal AI — general-purpose AI agents expanding into vertical use cases
4. Category convergence — meeting AI, voice AI, or workflow tools expanding into sales
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
    parsed = JSON.parse(text);
  } catch {
    parsed = {
      facts: rawContent.slice(0, 3),
      interpretation: ['Adjacent threat synthesis encountered an error.'],
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
