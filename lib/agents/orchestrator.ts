import { GoogleGenAI } from '@google/genai';
import { marketTrendsAgent } from './market-trends';
import { competitiveAgent } from './competitive';
import { winLossAgent } from './win-loss';
import { pricingAgent } from './pricing';
import { positioningAgent } from './positioning';
import { adjacentAgent } from './adjacent';
import { executionEngineAgent } from './execution/execution-engine';
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
  ImageAttachment,
  MindMapOutput,
  MindMapNode,
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
  runExecution: boolean;  // true when query is execution-intent (write copy, outreach, variants, brief)
}

// Deterministic execution-intent detector. Runs alongside the LLM classifier
// so we never miss obvious "write copy / draft outreach / generate variants"
// queries. If either signal fires, the Execution Engine kicks in.
//
// The patterns are intentionally biased toward generation verbs combined
// with marketing/outreach artifacts — they should not fire on pure research
// questions like "compare X vs Y" or "what is the market for X".
const EXECUTION_INTENT_PATTERNS: RegExp[] = [
  // verb + artifact ("write a cold email", "draft an outreach sequence")
  /\b(write|draft|create|generate|produce|craft|compose|build|make|give\s+me|send\s+me|show\s+me)\b[^.?!]*\b(cold\s*email|email|linkedin|outreach|sequence|message|messages|copy|post|posts|caption|captions|brief|one[-\s]?pager|pitch|landing\s*page|ad|ads|campaign|cta|hook|headline|tagline|script|dm|outbound|nurture)\b/i,
  // explicit framings
  /\b(campaign\s*brief|positioning\s*guide|strategy\s*doc|messaging\s*guide|launch\s*plan|go[-\s]?to[-\s]?market\s*plan|gtm\s*plan)\b/i,
  // A/B testing language
  /\b(a\/b|a\s*b\s*test|ab\s*test|variants?|test\s*angles?|message\s*variants?|message\s*test|hypotheses?|falsifiable)\b/i,
  // ship / launch / deploy verbs paired with marketing artifact
  /\b(ship|launch|deploy|roll\s*out)\b[^.?!]*\b(campaign|outreach|email|sequence|copy|message|post|ad)\b/i,
  // bare imperatives that almost always mean "generate something"
  /^\s*(write|draft|generate|create|compose)\s+/i,
];

function detectExecutionIntent(query: string): boolean {
  if (!query?.trim()) return false;
  return EXECUTION_INTENT_PATTERNS.some(re => re.test(query));
}

async function classifyQuery(
  query: string,
  history: ConversationMessage[],
  images: ImageAttachment[] = [],
  memoryContext?: string,
): Promise<ClassificationResult> {
  // Build context from prior messages
  const priorContext = history
    .slice(-6) // last 3 turns
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`)
    .join('\n');

  const prompt = `You are a query classifier for a growth intelligence system. Extract structured information using conversation history and persistent user memory.

${memoryContext ? `${memoryContext}\n\n` : ''}Conversation history:
${priorContext || 'None'}

Current query: "${query}"

Respond with JSON:
{
  "product": string,         // The product being analysed (infer from context if not explicit)
  "competitor": string | null,  // Competitor name if mentioned or inferable from context
  "productUrl": string | null,  // Product website if known (e.g. vectoragents.ai)
  "competitorUrl": string | null,
  "domains": string[],       // Which intelligence domains to activate. Options: market-trends, competitive, win-loss, pricing, positioning, adjacent
  "intent": string,          // One-line description of what the user wants to know
  "runExecution": boolean    // true if the query is execution-intent (write copy, draft outreach, campaign brief, cold email, LinkedIn post, variants, one-pager, positioning guide, outreach sequence)
}

Domain selection rules:
- "vs", "compare", "competitive" → include competitive, win-loss, positioning
- "market", "trend", "category", "growing" → include market-trends
- "pricing", "cost", "expensive" → include pricing
- "messaging", "positioning", "marketing" → include positioning
- "disruption", "threat", "outside", "adjacent" → include adjacent
- "build", "roadmap", "strategy" → include market-trends, competitive, adjacent
- Vague / broad queries → include all 6 domains
- Always include at least 3 domains

Execution intent detection (set runExecution: true if ANY of these apply):
- Generation verbs ("write", "draft", "create", "generate", "produce", "craft", "compose", "build", "make", "give me", "show me", "send me") combined with any marketing or outreach artifact (cold email, email, LinkedIn post, outreach sequence, copy, message, ad, campaign, brief, one-pager, landing page, pitch, CTA, hook, headline, tagline, DM, nurture, outbound)
- Standalone phrases: "campaign brief", "one-pager", "positioning guide", "strategy doc", "messaging guide", "launch plan", "go-to-market plan", "GTM plan"
- A/B testing language: "variants", "A/B", "AB test", "hypothesis", "test angles", "message variants", "falsifiable"
- Deployment verbs ("ship", "launch", "deploy", "roll out") combined with campaign/outreach/sequence/copy/message/post/ad
- Bare imperatives that start with a generation verb ("Write...", "Draft...", "Generate...", "Create...", "Compose...")

Set runExecution: false for pure research questions ("compare X vs Y", "what is the market for X", "is X growing", "who are the competitors of X").`;

  // Deterministic regex check — runs in parallel with the LLM classifier so
  // we never miss obvious execution intents even if Gemini misclassifies.
  const regexExecution = detectExecutionIntent(query);

  try {
    // Build multimodal parts: text prompt + any attached images
    const imageParts = images.map(img => ({
      inlineData: { mimeType: img.mimeType, data: img.data },
    }));
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }, ...imageParts] }],
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
      runExecution: ((parsed.runExecution as boolean) ?? false) || regexExecution,
    };
  } catch {
    // Fallback: activate all domains. Honour the regex execution check even
    // when Gemini errors out — a "draft a cold email" query must still trigger
    // the Execution Engine.
    return {
      product: 'the current product',
      domains: ['market-trends', 'competitive', 'win-loss', 'pricing', 'positioning', 'adjacent'],
      intent: query,
      runExecution: regexExecution,
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
  images: ImageAttachment[] = [],
  memoryContext?: string,
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
${memoryContext ? `${memoryContext}\n` : ''}${priorSummary ? `Prior conversation context:\n${priorSummary}\n` : ''}
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
    // Build multimodal parts: text prompt + any attached images
    const imageParts = images.map(img => ({
      inlineData: { mimeType: img.mimeType, data: img.data },
    }));
    const imageNote = images.length > 0
      ? `\nThe user has also attached ${images.length} image(s). Reference their visual content (text, UI elements, charts, pricing tables, etc.) directly in your answer.`
      : '';
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt + imageNote }, ...imageParts] }],
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

// ── Mind map generator — builds a visual tree from all agent outputs ─────────
async function generateMindMap(
  query: string,
  product: string,
  outputs: AgentOutput[],
): Promise<MindMapOutput | null> {
  if (outputs.length === 0) return null;

  const outputSummaries = outputs.map(o => ({
    domain: o.domain,
    confidence: o.confidence,
    facts: o.facts.slice(0, 5),
    interpretation: o.interpretation.slice(0, 3),
  }));

  const prompt = `You are building a strategic mind map from multi-agent intelligence findings.

Product: "${product}"
Query: "${query}"
Agent findings:
${JSON.stringify(outputSummaries, null, 2)}

Create a mind map with 3-6 top-level branches. Each branch should have 2-4 leaf nodes.
Every node must have a sentiment: "positive", "negative", "warning", or "neutral".

CRITICAL RULES:
- Every "id" must be a unique string (e.g. "branch-1", "leaf-1-2")
- Every "label" MUST be a complete, meaningful phrase (3-8 words). NEVER return one-word labels like "Numerous" or "Significant" — always use full descriptive phrases like "Numerous competitors in API market"
- Every node MUST have a non-empty label. Do not return empty or whitespace-only labels
- Keep branch labels short (2-5 words) and child labels slightly longer (4-10 words)

Return ONLY valid JSON (no markdown, no fences):
{
  "centralTopic": "string — the core topic (short, 3-8 words)",
  "summary": "string — one-line overview of the map",
  "branches": [
    {
      "id": "branch-1",
      "label": "string — branch title (2-5 words)",
      "detail": "string — one sentence branch summary",
      "sentiment": "positive" | "neutral" | "negative" | "warning",
      "children": [
        {
          "id": "leaf-1-1",
          "label": "string — complete descriptive insight (4-10 words)",
          "detail": "string — supporting evidence or context",
          "sentiment": "positive" | "neutral" | "negative" | "warning"
        }
      ]
    }
  ]
}`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });
    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const parsed = safeParseJson(raw);

    const branches = (parsed.branches as MindMapNode[]) ?? [];
    if (branches.length === 0) return null;

    const avgScore = outputs.reduce((s, o) => s + o.confidenceScore, 0) / outputs.length;

    return {
      agentId: 'mind-map-synthesis',
      domain: 'market-trends',
      confidence: scoreToLevel(avgScore),
      confidenceScore: avgScore,
      facts: [],
      interpretation: [],
      sources: outputs.flatMap(o => o.sources).slice(0, 10),
      generatedAt: new Date().toISOString(),
      artifactType: 'mind-map',
      centralTopic: (parsed.centralTopic as string) ?? product,
      branches,
      summary: (parsed.summary as string) ?? '',
    };
  } catch (err) {
    console.error('[MindMap generation error]', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Main orchestrator ─────────────────────────────────────────────────────────
export async function orchestrate(
  query: string,
  history: ConversationMessage[],
  onAgentUpdate?: (run: AgentRun) => void,
  images: ImageAttachment[] = [],
  memoryContext?: string,
): Promise<OrchestratorOutput> {

  // Step 1: Classify query and extract context
  const classification = await classifyQuery(query, history, images, memoryContext);

  const { product, competitor, productUrl, competitorUrl, intent, runExecution } = classification;

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
    images: images.length > 0 ? images : undefined,
    memoryContext: memoryContext || undefined,
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

  // ── Stage 2: Execution Engine (only if execution intent detected) ──────────
  if (runExecution) {
    const execRun: AgentRun = {
      agentId: 'execution-engine',
      name: 'Execution Engine',
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    agentRuns.push(execRun);
    onAgentUpdate?.(execRun);

    try {
      const executionOutput = await executionEngineAgent.run({
        ...agentContext,
        researchOutputs: outputs,   // pass stage-1 findings as grounding
      });
      execRun.status = 'completed';
      execRun.completedAt = new Date().toISOString();
      outputs.push(executionOutput);
    } catch (err) {
      execRun.status = 'failed';
      execRun.error = err instanceof Error ? err.message : String(err);
    }
    onAgentUpdate?.(execRun);
  }

  // Step 4: Synthesise + generate mind map in parallel
  const [synthesisResult, mindMapResult] = await Promise.all([
    synthesize(query, outputs, history, images, memoryContext),
    generateMindMap(query, product, outputs),
  ]);
  const { answer, recommendations, followUps } = synthesisResult;

  // Append mind map to outputs if generated successfully
  if (mindMapResult) {
    outputs.push(mindMapResult);
  }

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
