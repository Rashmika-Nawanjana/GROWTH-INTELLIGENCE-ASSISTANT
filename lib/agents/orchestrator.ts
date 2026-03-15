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
    const text = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const parsed = JSON.parse(text);
    return {
      product: parsed.product ?? 'Vector Agents',
      competitor: parsed.competitor ?? undefined,
      productUrl: parsed.productUrl ?? undefined,
      competitorUrl: parsed.competitorUrl ?? undefined,
      domains: parsed.domains ?? ['market-trends', 'competitive', 'win-loss'],
      intent: parsed.intent ?? query,
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
    facts: o.facts.slice(0, 3),
    interpretation: o.interpretation.slice(0, 2),
  }));

  const systemPrompt = `You are the synthesis layer of a multi-agent growth intelligence system. You receive structured findings from 6 specialist agents and produce:
1. A clear, direct answer to the user's question
2. Prioritised strategic recommendations with confidence scores
3. Follow-up questions that would deepen the analysis

Rules:
- Be specific and actionable — no generic advice
- Reference the domain agents' findings explicitly
- Separate what you KNOW (facts) from what you INFER (interpretation)
- Keep the synthesized answer under 200 words`;

  const userPrompt = `Original query: "${query}"
${priorSummary ? `Prior conversation context:\n${priorSummary}\n` : ''}
Agent findings:
${JSON.stringify(outputSummaries, null, 2)}

Produce JSON:
{
  "answer": string,
  "recommendations": [
    {
      "title": string,
      "rationale": string,
      "evidence": string[],
      "confidence": "high" | "medium" | "low",
      "priority": "immediate" | "short-term" | "strategic"
    }
  ],
  "followUps": string[]
}`;

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
    const parsed = JSON.parse(text);
    return {
      answer: parsed.answer ?? 'Analysis complete.',
      recommendations: parsed.recommendations ?? [],
      followUps: parsed.followUps ?? [],
    };
  } catch {
    return {
      answer: 'Analysis complete. See agent findings below.',
      recommendations: [],
      followUps: [],
    };
  }
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

  // Step 2: Select agents to run
  const agentsToRun = ALL_AGENTS.filter(a => domains.includes(a.id));

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
