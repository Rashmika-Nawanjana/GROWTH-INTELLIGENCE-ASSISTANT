import { GoogleGenAI } from '@google/genai';
import { marketTrendsAgent } from './market-trends';
import { competitiveAgent } from './competitive';
import { winLossAgent } from './win-loss';
import { pricingAgent } from './pricing';
import { positioningAgent } from './positioning';
import { adjacentAgent } from './adjacent';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  AgentRun,
  OrchestratorOutput,
  Recommendation,
  ConversationMessage,
  ConfidenceLevel,
  IntelligenceDomain,
} from './types';
import { scoreToLevel } from './types';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// ── All registered domain agents ─────────────────────────────────────────────
const ALL_AGENTS: AgentConfig[] = [
  marketTrendsAgent,
  competitiveAgent,
  winLossAgent,
  pricingAgent,
  positioningAgent,
  adjacentAgent,
];

// ── Query classifier ──────────────────────────────────────────────────────────
interface ClassificationResult {
  product: string;
  competitor?: string;
  productUrl?: string;
  competitorUrl?: string;
  domains: IntelligenceDomain[];
  intent: string;
}

async function classifyQuery(
  query: string,
  history: ConversationMessage[]
): Promise<ClassificationResult> {
  // Build context from prior messages
  const priorContext = history
    .slice(-6) // last 3 turns
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
    .join('\n');

  const prompt = `You are a query classifier for a growth intelligence system. Given a user query and conversation history, extract structured information.

Conversation history:
${priorContext || 'None'}

Current query: "${query}"

Respond with JSON:
{
  "product": string,         // The product being analysed (infer from context if not explicit)
  "competitor": string | null,  // Competitor name if mentioned or inferable from context
  "productUrl": string | null,  // Product website if known (e.g. vectoragents.ai)
  "competitorUrl": string | null,
  "domains": string[],       // Which intelligence domains to activate. Options: market-trends, competitive, win-loss, pricing, positioning, adjacent
  "intent": string           // One-line description of what the user wants to know
}

Domain selection rules:
- "vs", "compare", "competitive" → include competitive, win-loss, positioning
- "market", "trend", "category", "growing" → include market-trends
- "pricing", "cost", "expensive" → include pricing
- "messaging", "positioning", "marketing" → include positioning
- "disruption", "threat", "outside", "adjacent" → include adjacent
- "build", "roadmap", "strategy" → include market-trends, competitive, adjacent
- Vague / broad queries → include all 6 domains
- Always include at least 3 domains`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });
    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const parsed = safeParseJson(raw);
    return {
      product: (parsed.product as string) ?? 'the product',
      competitor: (parsed.competitor as string) ?? undefined,
      productUrl: (parsed.productUrl as string) ?? undefined,
      competitorUrl: (parsed.competitorUrl as string) ?? undefined,
      domains: (parsed.domains as IntelligenceDomain[]) ?? ['market-trends', 'competitive', 'win-loss'],
      intent: (parsed.intent as string) ?? query,
    };
  } catch {
    // Fallback: activate all domains
    return {
      product: 'Vector Agents',
      domains: ['market-trends', 'competitive', 'win-loss', 'pricing', 'positioning', 'adjacent'],
      intent: query,
    };
  }
}

// Strip markdown code fences Gemini sometimes wraps around JSON
function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(stripJsonFences(raw));
  } catch {
    // Try extracting first JSON object/array from the string
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* ignore */ }
    }
    return {};
  }
}

// ── Synthesizer — merges all agent outputs into a final answer ────────────────
async function synthesize(
  query: string,
  outputs: AgentOutput[],
  history: ConversationMessage[],
): Promise<{ answer: string; recommendations: Recommendation[]; followUps: string[] }> {
  const priorSummary = history
    .slice(-4)
    .filter(m => m.role === 'assistant')
    .map(m => m.content.slice(0, 300))
    .join('\n');

  const outputSummaries = outputs.map(o => ({
    domain: o.domain,
    confidence: o.confidence,
    facts: o.facts.slice(0, 4),
    interpretation: o.interpretation.slice(0, 3),
  }));

  const prompt = `You are the synthesis layer of a multi-agent growth intelligence system. Your job is to produce a clean, direct, well-written answer.

Original query: "${query}"
${priorSummary ? `Prior conversation context:\n${priorSummary}\n` : ''}
Agent findings from ${outputs.length} specialist agents:
${JSON.stringify(outputSummaries, null, 2)}

Rules:
1. If the query asks a FACTUAL question (revenue, funding amount, year founded, etc.), lead with the direct answer in the first sentence.
2. Write in clean prose — no raw tool labels like [WEB], [NEWS], [REDDIT]. Never output bracket prefixes.
3. Reference insights by domain only when relevant (e.g. "Competitive data shows...").
4. Be specific and concrete — cite actual company names, numbers, trends from the findings.
5. Keep the "answer" field under 180 words. Make it readable and insightful.
6. Only include recommendations if directly actionable from the findings. 2-3 max.

Return ONLY valid JSON (no markdown, no fences):
{
  "answer": "string — direct, clean prose answer. Start with the most important finding. No raw tool labels.",
  "recommendations": [
    {
      "title": "string — short action title",
      "rationale": "string — 1-2 sentences grounded in specific findings",
      "evidence": ["string — specific fact or quote from findings"],
      "confidence": "high" | "medium" | "low",
      "priority": "immediate" | "short-term" | "strategic"
    }
  ],
  "followUps": ["string — 3 specific follow-up questions the user would naturally ask next"]
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });
    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const parsed = safeParseJson(raw);
    return {
      answer: (parsed.answer as string) || buildFallbackAnswer(outputs, query),
      recommendations: (parsed.recommendations as Recommendation[]) ?? [],
      followUps: (parsed.followUps as string[]) ?? [],
    };
  } catch (err) {
    console.error('[Orchestrator synthesis error]', err instanceof Error ? err.message : err);
    return {
      answer: buildFallbackAnswer(outputs, query),
      recommendations: [],
      followUps: [],
    };
  }
}

function buildFallbackAnswer(outputs: AgentOutput[], query: string): string {
  if (outputs.length === 0) return `I couldn't retrieve signal data for "${query}". Please check your API keys and try again.`;
  // Produce clean prose from agent outputs, filtering out raw tool prefixes
  const cleanFacts = outputs
    .flatMap(o => o.facts)
    .filter(f => !f.startsWith('['))
    .slice(0, 4);
  const domains = outputs.map(o => o.domain.replace(/-/g, ' ')).join(', ');
  if (cleanFacts.length > 0) {
    return `Based on intelligence gathered across ${domains}:\n\n${cleanFacts.map(f => `• ${f}`).join('\n')}`;
  }
  return `Intelligence gathered from ${outputs.length} agents covering: ${domains}. Expand the Agent Findings below for detailed insights.`;
}

// ── Main orchestrator ─────────────────────────────────────────────────────────
export async function orchestrate(
  query: string,
  history: ConversationMessage[],
  onAgentUpdate?: (run: AgentRun) => void,
): Promise<OrchestratorOutput> {

  // Step 1: Classify query and extract context
  const classification = await classifyQuery(query, history);

  const { product, competitor, productUrl, competitorUrl, domains, intent } = classification;

  // Build prior context string for agents
  const priorContext = history
    .slice(-4)
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.slice(0, 400)}`)
    .join('\n');

  const agentContext: AgentContext = {
    query: intent,
    product,
    competitor,
    productUrl,
    competitorUrl,
    priorContext: priorContext || undefined,
  };

  // Step 2: Always run all 6 agents for full intelligence coverage
  const agentsToRun = ALL_AGENTS;

  // Initialise agent run tracking
  const agentRuns: AgentRun[] = agentsToRun.map(a => ({
    agentId: a.id,
    name: a.name,
    status: 'pending',
  }));

  // Step 3: Fan-out — all selected agents run in parallel
  const agentPromises = agentsToRun.map(async (agent, i): Promise<AgentOutput | null> => {
    // Mark as running
    agentRuns[i] = { ...agentRuns[i], status: 'running', startedAt: new Date().toISOString() };
    onAgentUpdate?.(agentRuns[i]);

    try {
      const output = await agent.run(agentContext);
      agentRuns[i] = { ...agentRuns[i], status: 'completed', completedAt: new Date().toISOString() };
      onAgentUpdate?.(agentRuns[i]);
      return output;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      agentRuns[i] = { ...agentRuns[i], status: 'failed', completedAt: new Date().toISOString(), error };
      onAgentUpdate?.(agentRuns[i]);
      return null;
    }
  });

  const settledOutputs = await Promise.allSettled(agentPromises);
  const outputs: AgentOutput[] = settledOutputs
    .filter((r): r is PromiseFulfilledResult<AgentOutput> =>
      r.status === 'fulfilled' && r.value !== null
    )
    .map(r => r.value as AgentOutput);

  // Step 4: Synthesise
  const { answer, recommendations, followUps } = await synthesize(query, outputs, history);

  // Step 5: Compute overall confidence
  const avgConfidence = outputs.length > 0
    ? outputs.reduce((sum, o) => sum + o.confidenceScore, 0) / outputs.length
    : 0.5;
  const totalConfidence: ConfidenceLevel = scoreToLevel(avgConfidence);

  return {
    query,
    product,
    competitor,
    agentRuns,
    outputs,
    synthesizedAnswer: answer,
    topRecommendations: recommendations,
    suggestedFollowUps: followUps,
    totalConfidence,
    generatedAt: new Date().toISOString(),
  };
}
