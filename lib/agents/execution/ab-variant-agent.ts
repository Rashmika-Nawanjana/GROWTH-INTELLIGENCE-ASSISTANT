/**
 * Member 3 — Sub-agent 2: A/B Variant Agent
 *
 * Skill ref: .claude/.agents/skills/ab-test-orchestrator/SKILL.md
 *
 * Responsibilities:
 *  - Scrape competitor Meta Ad Library for real ad messaging
 *  - Search HN for sentiment signals
 *  - For each copy angle from ContentAgent, produce a CampaignVariant with:
 *    - A single falsifiable hypothesis tied to a specific research signal
 *    - A defined success metric
 *    - The single variable being tested
 *    - Grounded signal pointers
 */

import { searchMetaAds } from '../../tools/meta-ads';
import { searchHN } from '../../tools/hn-algolia';
import { searchWeb } from '../../tools/serpapi';
import { GoogleGenAI } from '@google/genai';
import type {
  AgentContext,
  AgentOutput,
  AgentSource,
  CampaignVariant,
  ConfidenceLevel,
} from '../types';
import { scoreToLevel } from '../types';
import { buildContentParts } from '../gemini-utils';
import { computeSignalQualityPenalty, extractToolResults } from '../../tools/fallback';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export interface ABVariantOutput extends AgentOutput {
  artifactType: 'execution-plan';
  variants: CampaignVariant[];
}

export async function runABVariantAgent(ctx: AgentContext): Promise<ABVariantOutput> {
  const { query, product, competitor, priorContext, researchOutputs = [], images } = ctx;

  // ── Parallel tool fetch ───────────────────────────────────────────────────
  const [metaAdsResult, hnResult, webResult] = await Promise.allSettled([
    competitor ? searchMetaAds(competitor) : searchMetaAds(product),
    searchHN(`${product} ${competitor ?? ''} outreach messaging`),
    searchWeb(`${product} vs ${competitor ?? 'competitors'} buyer decision 2025`),
  ]);

  const sources: AgentSource[] = [];
  const rawContent: string[] = [];

  // Research findings as grounding
  if (researchOutputs.length > 0) {
    const researchSummary = researchOutputs
      .map(o => `[${o.domain}] FACTS: ${o.facts.slice(0, 3).join('; ')} | INTERPRETATION: ${o.interpretation.slice(0, 2).join('; ')}`)
      .join('\n');
    rawContent.push(`[RESEARCH GROUNDING]\n${researchSummary}`);
  }

  if (metaAdsResult.status === 'fulfilled') {
    metaAdsResult.value.data.slice(0, 5).forEach(ad => {
      if (ad.ad_snapshot_url) {
        sources.push({ url: ad.ad_snapshot_url, title: `${ad.page_name} Ad`, timestamp: metaAdsResult.value.timestamp, tool: 'firecrawl' });
      }
      if (ad.ad_creative_body) rawContent.push(`[COMPETITOR AD] ${ad.page_name}: "${ad.ad_creative_body}"`);
    });
  }

  if (hnResult.status === 'fulfilled') {
    hnResult.value.data.slice(0, 4).forEach(p => {
      sources.push({ url: p.url, title: p.title, timestamp: p.created, tool: 'hn' });
      rawContent.push(`[HN SENTIMENT] ${p.title}`);
    });
  }

  if (webResult.status === 'fulfilled') {
    webResult.value.data.slice(0, 3).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: webResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[BUYER DECISION] ${r.title}: ${r.snippet}`);
    });
  }

  // ── Gemini synthesis ──────────────────────────────────────────────────────
  const systemPrompt = `You are a specialist A/B test strategist for B2B SaaS outreach campaigns.

Your job is to produce 3 structured, hypothesis-driven message variants grounded in live signals.

Rules:
- Each variant tests ONE variable (angle/hook/frame) — not multiple things at once.
- Every hypothesis must be falsifiable: it predicts a specific outcome for a specific audience because of a specific signal.
- Variants must be meaningfully different: ROI, competitor gap, insight-led, no-headcount, pain-point-first are all distinct.
- Success metrics must be concrete and measurable (reply rate, meetings booked, etc.).
- Ground every hypothesis explicitly in a signal from the research or raw data.
- Output valid JSON matching the schema exactly.
${priorContext ? `\nPrior conversation context (build on this):\n${priorContext}` : ''}`;

  const userPrompt = `Query: "${query}"
Product: ${product}
${competitor ? `Competitor: ${competitor}` : ''}

Raw signals:
${rawContent.join('\n')}

Produce a JSON object with this exact shape:
{
  "variants": [
    {
      "id": string,                  // e.g. "V1-ROI"
      "angle": string,               // e.g. "ROI-focused"
      "hypothesis": string,          // falsifiable — e.g. "ROI messaging outperforms competitor-gap for Series B VP Sales because pricing-agent found 73% cite budget pressure"
      "successMetric": string,       // e.g. "reply rate > 4% within 72h"
      "variable": string,            // single thing being tested, e.g. "opening hook angle"
      "channels": {
        "email": {
          "subject": string,
          "body": string,            // 3-4 sentences, no placeholders
          "followUps": string[]      // 1-2 follow-up messages
        },
        "linkedin": {
          "hook": string,            // first line — must create curiosity
          "post": string             // 3-5 sentences
        }
      },
      "groundedSignals": string[]    // 2-3 direct quotes or paraphrases from raw signals above
    }
  ],
  "facts": string[],
  "interpretation": string[],
  "confidenceScore": number
}`;

  let parsed: any = {};
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: buildContentParts(userPrompt, images) }],
      config: { systemInstruction: systemPrompt, responseMimeType: 'application/json' },
    });
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const clean = text.replace(/```json\s*/i, '').replace(/```\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(clean);
  } catch {
    parsed = {
      variants: [
        {
          id: 'V1-ROI',
          angle: 'ROI-focused',
          hypothesis: `ROI messaging outperforms competitor-gap for VP Sales at Series B because budget pressure is the primary buying signal for ${product}`,
          successMetric: 'reply rate > 4% within 72h',
          variable: 'opening hook angle',
          channels: {
            email: { subject: `What if ${product} paid for itself in 30 days?`, body: `Most teams spend 60% of selling time on manual research. ${product} flips that ratio — your reps get live-sourced intelligence in minutes, not days.\n\nWorth a 20-minute call to show you the math?`, followUps: [`Following up — did the ROI angle land?`] },
            linkedin: { hook: `Your top reps are losing deals to intel lag.`, post: `${product} surfaces live competitor, pricing, and buyer signals before the call even starts. Happy to share what that looks like for a team your size.` },
          },
          groundedSignals: ['Budget pressure identified in research signals', 'Competitor ad messaging focuses on speed'],
        },
        {
          id: 'V2-COMPETITOR-GAP',
          angle: 'Competitor gap',
          hypothesis: `Highlighting a specific competitor weakness increases curiosity opens for buyers already evaluating alternatives`,
          successMetric: 'click-through on demo link > 8%',
          variable: 'competitive framing vs ROI framing',
          channels: {
            email: { subject: `What ${competitor ?? 'your current tool'} doesn't show you`, body: `${competitor ?? 'Most intelligence tools'} gives you static reports. ${product} pulls live signals — funding moves, job postings, ad shifts — in real time.\n\nCurious what that difference looks like for your team?`, followUps: [`Still thinking it over? Happy to share a side-by-side.`] },
            linkedin: { hook: `Static research is a competitive liability in 2025.`, post: `${product} vs ${competitor ?? 'legacy tools'}: one surfaces live signals before the call, one summarises what happened last quarter. Reach out if you want to see the gap in action.` },
          },
          groundedSignals: ['Competitor ads emphasise static reports', 'HN sentiment shows frustration with lagging intel'],
        },
        {
          id: 'V3-INSIGHT-LED',
          angle: 'Insight-led',
          hypothesis: `Opening with a specific, non-obvious insight about the prospect's market increases reply rates among analytical buyers`,
          successMetric: 'reply rate > 5% for VP-level prospects',
          variable: 'personalised insight hook vs generic value prop',
          channels: {
            email: { subject: `One signal your team is probably missing`, body: `I ran ${product} against your category this morning — three competitors increased ad spend in the last 30 days while pulling back on pricing pages. That's usually a pivot signal.\n\nWant me to walk you through what it means for your Q3 positioning?`, followUps: [`Wanted to check — did the market signal angle resonate?`] },
            linkedin: { hook: `I found something interesting about your market this morning.`, post: `Using ${product} I spotted a pattern: three of your top competitors shifted ad messaging this week. Curious what that might mean for your positioning? Happy to share the breakdown.` },
          },
          groundedSignals: ['Market trend agent detected competitor ad spend shifts', 'Positioning agent identified untapped messaging angles'],
        },
      ],
      facts: rawContent.slice(0, 3).map(s => s.replace(/^\[[^\]]+\]\s*/, '')).filter(s => s.length > 15),
      interpretation: ['A/B variant synthesis temporarily unavailable — default variants generated.'],
      confidenceScore: 0.4,
    };
  }

  const rawScore: number = typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.65;
  const toolResults = extractToolResults([metaAdsResult, hnResult, webResult]);
  const confScore = Number.parseFloat((rawScore * computeSignalQualityPenalty(toolResults, 3)).toFixed(2));
  const confidence: ConfidenceLevel = scoreToLevel(confScore);

  return {
    agentId: 'ab-variant-agent',
    domain: 'execution-engine',
    artifactType: 'execution-plan',
    confidence,
    confidenceScore: confScore,
    facts: parsed.facts ?? [],
    interpretation: parsed.interpretation ?? [],
    sources,
    generatedAt: new Date().toISOString(),
    variants: (parsed.variants ?? []) as CampaignVariant[],
  };
}
