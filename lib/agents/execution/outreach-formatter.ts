/**
 * Member 3 — Sub-agent 3: Outreach Formatter (Sequences + Deployment)
 *
 * Skill refs:
 *   .claude/.agents/skills/growth-copywriter/SKILL.md
 *   .claude/.agents/skills/humanizer/SKILL.md
 *
 * Responsibilities:
 *  - Search for current outbound best practices / subject-line patterns
 *  - For each variant from ABVariantAgent, enrich email/LinkedIn channels
 *    with humanised, fully-written sequences (no placeholders)
 *  - Generate a DeploymentStep[] timeline
 */

import { searchWeb } from '../../tools/serpapi';
import { scrapePage } from '../../tools/firecrawl';
import { generateHuggingFaceJson } from '../gemini';
import type {
  AgentContext,
  AgentOutput,
  AgentSource,
  CampaignVariant,
  DeploymentStep,
  ConfidenceLevel,
} from '../types';
import { scoreToLevel } from '../types';
import { computeSignalQualityPenalty, extractToolResults } from '../../tools/fallback';

export interface OutreachFormatterOutput extends AgentOutput {
  artifactType: 'execution-plan';
  enrichedVariants: CampaignVariant[];   // variants with fully-written sequences
  deployment: DeploymentStep[];
}

export async function runOutreachFormatter(
  ctx: AgentContext,
  inputVariants: CampaignVariant[] = [],
): Promise<OutreachFormatterOutput> {
  const { query, product, competitor, priorContext } = ctx;

  // ── Parallel tool fetch ───────────────────────────────────────────────────
  const [bestPracticesResult, landingResult] = await Promise.allSettled([
    searchWeb('B2B SaaS cold email best practices subject lines 2025 reply rate'),
    ctx.productUrl ? scrapePage(ctx.productUrl) : Promise.resolve(null),
  ]);

  const sources: AgentSource[] = [];
  const rawContent: string[] = [];

  if (bestPracticesResult.status === 'fulfilled') {
    bestPracticesResult.value.data.slice(0, 3).forEach(r => {
      sources.push({ url: r.url, title: r.title, timestamp: bestPracticesResult.value.timestamp, tool: 'serpapi' });
      rawContent.push(`[BEST PRACTICE] ${r.title}: ${r.snippet}`);
    });
  }

  if (landingResult.status === 'fulfilled' && landingResult.value) {
    const page = landingResult.value.data;
    sources.push({ url: page.url, title: `${product} Landing Page`, timestamp: landingResult.value.timestamp, tool: 'firecrawl' });
    rawContent.push(`[PRODUCT VOICE] ${page.excerpt}`);
  }

  // Serialise variants as JSON for Gemini
  const variantsSummary = inputVariants.length > 0
    ? JSON.stringify(inputVariants.map(v => ({ id: v.id, angle: v.angle, hypothesis: v.hypothesis, groundedSignals: v.groundedSignals })), null, 2)
    : 'No variants provided — generate 3 default variants.';

  // ── Gemini synthesis ──────────────────────────────────────────────────────
  const systemPrompt = `You are an expert B2B SaaS cold outreach writer and humaniser.

Your job is to:
1. Take structured message variants and write fully-humanised, ready-to-send outreach sequences for each.
2. Generate a realistic deployment timeline.

Rules:
- No placeholders like [Name], [Company] — write as if sending to a specific ICP (VP Sales at Series B SaaS).
- Tone: confident, helpful, non-salesy — like a strategic operator who did deep research.
- Subject lines must be curiosity-driven, under 8 words, no exclamation marks.
- Email bodies: 3-5 sentences max. No features dump. One clear CTA.
- Follow-ups: shorter, add a new angle, never just "bumping this up".
- LinkedIn posts: punchy hook (first line stops the scroll), 3-4 sentences, conversational.
- Deployment timeline: realistic B2B cadence — Day 0 email, Day 3 follow-up, Day 5 LinkedIn, Day 8 final follow-up.
- Output valid JSON matching the schema exactly.
${priorContext ? `\nPrior context:\n${priorContext}` : ''}`;

  const userPrompt = `Query: "${query}"
Product: ${product}
${competitor ? `Competitor: ${competitor}` : ''}

Outreach best practices:
${rawContent.join('\n')}

Input variants to enrich:
${variantsSummary}

Produce a JSON object with this exact shape:
{
  "enrichedVariants": [
    {
      "id": string,
      "angle": string,
      "hypothesis": string,
      "successMetric": string,
      "variable": string,
      "channels": {
        "email": {
          "subject": string,
          "body": string,
          "followUps": string[]   // 2 follow-up messages, each different angle
        },
        "linkedin": {
          "hook": string,
          "post": string
        }
      },
      "groundedSignals": string[]
    }
  ],
  "deployment": [
    {
      "day": number,
      "action": string,          // e.g. "Send Variant A email to Segment X"
      "channel": "email" | "linkedin" | "ads",
      "audience": string         // e.g. "VP Sales at Series B SaaS (50-200 employees)"
    }
  ],
  "facts": string[],
  "interpretation": string[],
  "confidenceScore": number
}`;

  let parsed: any = {};
  try {
    parsed = await generateHuggingFaceJson<any>(systemPrompt, userPrompt, {
      maxNewTokens: 1800,
      temperature: 0.25,
    });
  } catch {
    // Fallback: return input variants unchanged + default deployment
    parsed = {
      enrichedVariants: inputVariants,
      deployment: [
        { day: 0, action: 'Send Variant A cold email', channel: 'email', audience: 'VP Sales at Series B SaaS' },
        { day: 0, action: 'Send Variant B cold email', channel: 'email', audience: 'Head of Growth at Series B SaaS' },
        { day: 3, action: 'Send Variant A follow-up 1', channel: 'email', audience: 'Non-responders from Day 0' },
        { day: 5, action: 'Publish Variant A LinkedIn post', channel: 'linkedin', audience: 'VP Sales network' },
        { day: 5, action: 'Publish Variant B LinkedIn post', channel: 'linkedin', audience: 'Head of Growth network' },
        { day: 8, action: 'Send final follow-up (insight angle)', channel: 'email', audience: 'All non-responders' },
      ],
      facts: rawContent.slice(0, 2).map(s => s.replace(/^\[[^\]]+\]\s*/, '')).filter(s => s.length > 15),
      interpretation: ['Outreach formatting temporarily unavailable — input variants returned unchanged.'],
      confidenceScore: 0.4,
    };
  }

  const rawScore: number = typeof parsed.confidenceScore === 'number' ? parsed.confidenceScore : 0.65;
  const toolResults = extractToolResults([bestPracticesResult, landingResult]);
  const confScore = Number.parseFloat((rawScore * computeSignalQualityPenalty(toolResults, 2)).toFixed(2));
  const confidence: ConfidenceLevel = scoreToLevel(confScore);

  return {
    agentId: 'outreach-formatter',
    domain: 'execution-engine',
    artifactType: 'execution-plan',
    confidence,
    confidenceScore: confScore,
    facts: parsed.facts ?? [],
    interpretation: parsed.interpretation ?? [],
    sources,
    generatedAt: new Date().toISOString(),
    enrichedVariants: (parsed.enrichedVariants ?? inputVariants) as CampaignVariant[],
    deployment: (parsed.deployment ?? []) as DeploymentStep[],
  };
}
