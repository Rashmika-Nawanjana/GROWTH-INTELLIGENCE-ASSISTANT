/**
 * Member 3 — Sub-agent 1: Content Agent (Brief + Angles)
 *
 * Skill ref: .claude/.agents/skills/campaign-brief-generator/SKILL.md
 *
 * Responsibilities:
 *  - Scrape the product landing/pricing page for brand voice
 *  - Search Reddit/HN for buyer pain points
 *  - Synthesise a structured CampaignBrief + list of copy angles
 *  - Each angle becomes a direct input to the A/B Variant Agent
 */

import { scrapePage } from '../../tools/firecrawl';
import { searchReddit } from '../../tools/reddit';
import { searchNews } from '../../tools/serpapi';
import { generateHuggingFaceJson } from '../gemini';
import type {
  AgentContext,
  AgentOutput,
  AgentSource,
  CampaignBrief,
  ConfidenceLevel,
} from '../types';
import { scoreToLevel } from '../types';
import { computeSignalQualityPenalty, extractToolResults } from '../../tools/fallback';

export interface ContentAgentOutput extends AgentOutput {
  artifactType: 'execution-plan';
  brief: CampaignBrief;
  angles: string[];   // raw angle list for AB-variant agent
}

export async function runContentAgent(ctx: AgentContext): Promise<ContentAgentOutput> {
  const { query, product, competitor, priorContext, researchOutputs = [] } = ctx;

  const productUrl = ctx.productUrl ?? '';

  // ── Parallel tool fetch ───────────────────────────────────────────────────
  const [pageResult, redditResult, newsResult] = await Promise.allSettled([
    productUrl ? scrapePage(productUrl) : Promise.resolve(null),
    searchReddit(`${product} pain points complaints buyers`),
    searchNews(`${product} ${competitor ?? ''} GTM messaging 2025 2026`),
  ]);

  const sources: AgentSource[] = [];
  const rawContent: string[] = [];

  // Research findings as grounding context
  if (researchOutputs.length > 0) {
    const researchSummary = researchOutputs
      .map(o => `[${o.domain}] FACTS: ${o.facts.slice(0, 3).join('; ')} | INTERPRETATION: ${o.interpretation.slice(0, 2).join('; ')}`)
      .join('\n');
    rawContent.push(`[RESEARCH GROUNDING]\n${researchSummary}`);
  }

  if (pageResult.status === 'fulfilled' && pageResult.value) {
    const page = pageResult.value.data;
    sources.push({ url: page.url, title: `${product} Website`, timestamp: pageResult.value.timestamp, tool: 'firecrawl' });
    rawContent.push(`[PRODUCT PAGE] ${page.excerpt}`);
  }

  if (redditResult.status === 'fulfilled') {
    redditResult.value.data.slice(0, 4).forEach(p => {
      sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'reddit' });
      rawContent.push(`[BUYER VOICE] ${p.title}: ${p.snippet}`);
    });
  }

  if (newsResult.status === 'fulfilled') {
    newsResult.value.data.slice(0, 3).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: newsResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[NEWS] ${r.title}: ${r.snippet}`);
    });
  }

  // ── Gemini synthesis ──────────────────────────────────────────────────────
  const systemPrompt = `You are a senior growth strategist and campaign brief writer for B2B SaaS companies.

Your job is to synthesise live market signals into a structured campaign brief and a list of distinct copy angles that a growth team can execute immediately.

Rules:
- Base every angle on a signal from the raw data — no unsourced claims.
- Angles must be meaningfully different (ROI, competitor gap, pain point, insight-led, no-headcount, etc.).
- Brief sections must be concise, bullet-friendly, and ready for a growth team to act on.
- Output valid JSON matching the schema exactly.
${priorContext ? `\nPrior conversation context (build on this, do not repeat it):\n${priorContext}` : ''}`;

  const userPrompt = `Query: "${query}"
Product: ${product}
${competitor ? `Competitor: ${competitor}` : ''}

Raw signals:
${rawContent.join('\n')}

Produce a JSON object with this exact shape:
{
  "brief": {
    "objective": string,
    "targetAudience": string,
    "painPoints": string[],            // 3-5 buyer pain points grounded in signals
    "keyMessagingAngles": [
      { "angle": string, "hypothesis": string }
    ],                                  // 3-4 distinct angles, each with a falsifiable hypothesis
    "variantsSummary": string,
    "channelStrategy": string,
    "successMetrics": string[],        // e.g. "reply rate > 4%"
    "nextSteps": string[]
  },
  "angles": string[],                  // flat list of angle labels for AB-variant agent
  "facts": string[],                   // 3-5 verifiable claims from signals
  "interpretation": string[],          // 2-3 analyst insights
  "confidenceScore": number            // 0.0 - 1.0
}`;

  let parsed: any = {};
  try {
    parsed = await generateHuggingFaceJson<any>(systemPrompt, userPrompt, {
      maxNewTokens: 1400,
      temperature: 0.2,
      stage: 'execution',
    });
  } catch {
    parsed = {
      brief: {
        objective: `Drive pipeline for ${product}`,
        targetAudience: 'VP Sales / Head of Growth at Series B+ SaaS',
        painPoints: ['Manual outreach at scale', 'Poor signal-to-noise in prospecting', 'Headcount constraints'],
        keyMessagingAngles: [
          { angle: 'ROI-focused', hypothesis: 'Buyers prioritise cost-per-meeting over features' },
          { angle: 'Competitor gap', hypothesis: 'Highlighting competitor weakness increases curiosity' },
        ],
        variantsSummary: 'Two initial variants: ROI and competitor-gap angles',
        channelStrategy: 'Cold email + LinkedIn',
        successMetrics: ['reply rate > 4%', 'meetings booked per 100 outreach'],
        nextSteps: ['Run A/B test on Variant A vs B', 'Analyse reply sentiment after 72h'],
      },
      angles: ['ROI-focused', 'Competitor gap', 'Insight-led'],
      facts: rawContent.slice(0, 3).map(s => s.replace(/^\[[^\]]+\]\s*/, '')).filter(s => s.length > 15),
      interpretation: ['Content synthesis temporarily unavailable — raw data used as fallback.'],
      confidenceScore: 0.4,
    };
  }

  const rawScore: number = typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.6;
  const toolResults = extractToolResults([pageResult, redditResult, newsResult]);
  const confScore = Number.parseFloat((rawScore * computeSignalQualityPenalty(toolResults, 3)).toFixed(2));
  const confidence: ConfidenceLevel = scoreToLevel(confScore);

  return {
    agentId: 'content-agent',
    domain: 'execution-engine',
    artifactType: 'execution-plan',
    confidence,
    confidenceScore: confScore,
    facts: parsed.facts ?? [],
    interpretation: parsed.interpretation ?? [],
    sources,
    generatedAt: new Date().toISOString(),
    brief: parsed.brief ?? {},
    angles: parsed.angles ?? [],
  };
}
