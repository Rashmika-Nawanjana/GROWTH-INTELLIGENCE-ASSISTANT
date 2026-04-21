import { marketTrendsAgent } from './market-trends';
import { competitiveAgent } from './competitive';
import { winLossAgent } from './win-loss';
import { pricingAgent } from './pricing';
import { positioningAgent } from './positioning';
import { adjacentAgent } from './adjacent';
import { executionEngineAgent } from './execution/execution-engine';
import { mirofishAgent } from './mirofish';
import { detectExecutionIntent } from './execution-intent';
import { generateHuggingFaceText } from './gemini';
import type {
  AgentConfig,
  AgentContext,
  AgentOutput,
  AgentRun,
  OrchestratorOutput,
  RunMetrics,
  Recommendation,
  ConversationMessage,
  ConfidenceLevel,
  IntelligenceDomain,
  ImageAttachment,
  MindMapOutput,
  MindMapNode,
} from './types';
import { scoreToLevel } from './types';

// ── Cost estimation constants ───────────────────────────────────────────────
// Lightweight model-call estimate used for the UI metrics readout.
// The exact provider cost varies, so this intentionally stays heuristic.
const EST_INPUT_TOKENS_PER_CALL = 2000;
const EST_OUTPUT_TOKENS_PER_CALL = 1000;
const COST_PER_INPUT_TOKEN = 0.10 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 0.40 / 1_000_000;
const EST_COST_PER_MODEL_CALL =
  EST_INPUT_TOKENS_PER_CALL * COST_PER_INPUT_TOKEN +
  EST_OUTPUT_TOKENS_PER_CALL * COST_PER_OUTPUT_TOKEN;

const HF_MODEL = process.env.HUGGING_FACE_MODEL?.trim() || 'Qwen/Qwen2.5-7B-Instruct';

// ── All registered domain agents (6 fast Stage-1 agents) ────────────────────
const ALL_AGENTS: AgentConfig[] = [
  marketTrendsAgent,
  competitiveAgent,
  winLossAgent,
  pricingAgent,
  positioningAgent,
  adjacentAgent,
];
// mirofishAgent is opt-in and runs separately after the main result is sent
// (see runMirofishAgent below)

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

interface OrchestrateOptions {
  injectedContext?: string; // extra context injected into agents and synthesizer (e.g. feedback loop)
  forceExecution?: boolean; // force stage-2 execution even when classifier says false
  followUpMode?: 'full' | 'targeted'; // targeted runs only classifier-selected research domains
  selectedAgents?: string[]; // optional UI-selected domains from client
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
    const imageNote = images.length > 0
      ? `\n\nAttached images: ${images.length}. Use them as contextual metadata only; the specialist agents inspect the actual image content.`
      : '';
    const raw = await generateHuggingFaceText(prompt + imageNote, {
      model: HF_MODEL,
      maxNewTokens: 512,
      temperature: 0.1,
    });
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
    const imageNote = images.length > 0
      ? `\nThe user has also attached ${images.length} image(s). Reference their visual content (text, UI elements, charts, pricing tables, etc.) directly in your answer.`
      : '';
    const raw = await generateHuggingFaceText(prompt + imageNote, {
      model: HF_MODEL,
      maxNewTokens: 768,
      temperature: 0.2,
    });
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
    confidenceScore: o.confidenceScore,
    facts: o.facts.slice(0, 5),
    interpretation: o.interpretation.slice(0, 3),
  }));

  const prompt = `You are building a strategic mind map from multi-agent intelligence findings.

Product: "${product}"
Query: "${query}"
Agent findings (use domain names exactly as given for sourceAgent):
${JSON.stringify(outputSummaries, null, 2)}

Create a mind map with 4-6 top-level branches. Each branch maps to one of the intelligence domains above.
Each branch should have 2-4 child nodes. Key children with deep insights may have 1-3 grandchildren.
Every node must have a sentiment: "positive", "negative", "warning", or "neutral".

CRITICAL RULES:
- Every "id" must be globally unique (e.g. "branch-1", "leaf-1-2", "gc-1-2-1")
- Every "label" MUST be a complete, meaningful phrase (3-8 words). NEVER use one-word labels
- Every node MUST have a non-empty label and a non-empty "detail" string
- Keep branch labels concise (2-5 words); child/grandchild labels slightly longer (4-10 words)
- Each branch MUST set "sourceAgent" to the exact domain string that most contributed to it (e.g. "market-trends", "competitive", "win-loss", "pricing", "positioning", "adjacent")
- Each branch MUST set "confidence" to the confidence level of its source domain ("high", "medium", or "low")

Return ONLY valid JSON (no markdown, no fences):
{
  "centralTopic": "string — core topic (3-8 words)",
  "summary": "string — one-line overview of the map",
  "branches": [
    {
      "id": "branch-1",
      "label": "string — branch title (2-5 words)",
      "detail": "string — one sentence branch summary",
      "sentiment": "positive" | "neutral" | "negative" | "warning",
      "confidence": "high" | "medium" | "low",
      "sourceAgent": "market-trends" | "competitive" | "win-loss" | "pricing" | "positioning" | "adjacent",
      "children": [
        {
          "id": "leaf-1-1",
          "label": "string — complete descriptive insight (4-10 words)",
          "detail": "string — supporting evidence or context",
          "sentiment": "positive" | "neutral" | "negative" | "warning",
          "children": [
            {
              "id": "gc-1-1-1",
              "label": "string — specific data point or sub-insight (4-10 words)",
              "detail": "string — evidence or source context",
              "sentiment": "positive" | "neutral" | "negative" | "warning"
            }
          ]
        }
      ]
    }
  ]
}`;

  try {
    const raw = await generateHuggingFaceText(prompt, {
      model: HF_MODEL,
      maxNewTokens: 1024,
      temperature: 0.15,
    });
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
  options?: OrchestrateOptions,
): Promise<OrchestratorOutput> {
  const orchestrationStart = Date.now();

  // Step 1: Classify query and extract context  (1 model call)
  const classification = await classifyQuery(query, history, images, memoryContext);
  let modelCallCount = 1;

  const { product, competitor, productUrl, competitorUrl, intent, runExecution } = classification;
  const allowedAgents = new Set(options?.selectedAgents?.length ? options.selectedAgents : ALL_AGENTS.map(a => a.id));
  const executionEnabled = allowedAgents.has('execution-engine');
  const shouldRunExecution = executionEnabled && (runExecution || options?.forceExecution === true);

  // Build prior context string for agents
  const priorContext = history
    .slice(-4)
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.slice(0, 400)}`)
    .join('\n');

  const combinedPriorContext = [priorContext, options?.injectedContext]
    .filter(Boolean)
    .join('\n\n');

  const synthesisMemoryContext = [memoryContext, options?.injectedContext]
    .filter(Boolean)
    .join('\n\n') || undefined;

  const agentContext: AgentContext = {
    query: intent,
    product,
    competitor,
    productUrl,
    competitorUrl,
    priorContext: combinedPriorContext || undefined,
    images: images.length > 0 ? images : undefined,
    memoryContext: memoryContext || undefined,
  };

  // Step 2: Select research agents.
  // Main queries default to full sweep; follow-ups may run targeted domains.
  const classifiedDomains = new Set(classification.domains ?? []);
  const availableResearchAgents = ALL_AGENTS.filter(agent => allowedAgents.has(agent.id));
  const targetedAgents = availableResearchAgents.filter(agent => classifiedDomains.has(agent.id as IntelligenceDomain));
  const agentsToRun = options?.followUpMode === 'targeted'
    ? (targetedAgents.length > 0 ? targetedAgents : availableResearchAgents)
    : availableResearchAgents;

  // Initialise agent run tracking
  const agentRuns: AgentRun[] = agentsToRun.map(a => ({
    agentId: a.id,
    name: a.name,
    status: 'pending',
  }));

  // Step 3: Fan-out — all selected agents run in parallel
  const agentLatencies: Record<string, number> = {};
  const agentPromises = agentsToRun.map(async (agent, i): Promise<AgentOutput | null> => {
    // Mark as running
    const agentStart = Date.now();
    agentRuns[i] = { ...agentRuns[i], status: 'running', startedAt: new Date().toISOString() };
    onAgentUpdate?.(agentRuns[i]);

    try {
      const output = await agent.run(agentContext);
      agentLatencies[agent.id] = Date.now() - agentStart;
      agentRuns[i] = { ...agentRuns[i], status: 'completed', completedAt: new Date().toISOString() };
      onAgentUpdate?.(agentRuns[i]);
      return output;
    } catch (err) {
      agentLatencies[agent.id] = Date.now() - agentStart;
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

  // Each research agent makes ~1 model call
  modelCallCount += agentsToRun.length;

  // ── Stage 2: Execution Engine (only if execution intent detected) ──────────
  if (shouldRunExecution) {
    const execStart = Date.now();
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
      agentLatencies['execution-engine'] = Date.now() - execStart;
      execRun.status = 'completed';
      execRun.completedAt = new Date().toISOString();
      outputs.push(executionOutput);
      modelCallCount += 3; // 3 sub-agents
    } catch (err) {
      agentLatencies['execution-engine'] = Date.now() - execStart;
      execRun.status = 'failed';
      execRun.error = err instanceof Error ? err.message : String(err);
    }
    onAgentUpdate?.(execRun);
  }

  // Step 4: Synthesise + generate mind map in parallel (2 model calls)
  const [synthesisResult, mindMapResult] = await Promise.all([
    synthesize(query, outputs, history, images, synthesisMemoryContext),
    generateMindMap(query, product, outputs),
  ]);
  modelCallCount += 2; // synthesis + mind map
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

  // Step 6: Build run metrics
  // Tool call count: each successful agent typically makes 2-4 tool calls.
  // We estimate based on completed agents (a rough heuristic — agents don't
  // currently report exact tool call counts back).
  const completedAgents = agentRuns.filter(r => r.status === 'completed').length;
  const failedAgents = agentRuns.filter(r => r.status === 'failed').length;
  const toolCallCount = completedAgents * 3; // conservative average

  const metrics: RunMetrics = {
    totalLatencyMs: Date.now() - orchestrationStart,
    agentLatencies,
    estimatedCostUsd: Number.parseFloat((modelCallCount * EST_COST_PER_MODEL_CALL).toFixed(5)),
    toolCallCount,
    geminiCallCount: modelCallCount,
    agentCount: agentRuns.length,
    completedAgentCount: completedAgents,
    failedAgentCount: failedAgents,
  };

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
    metrics,
  };
}

// ── Optional MiroFish agent — runs independently after main result ────────────
// Called by the route handler only when the user has toggled "MiroFish Forecast".
// This keeps orchestrate() fast (6 agents) while MiroFish completes in the
// background with the stream still open.
export async function runMirofishAgent(
  query: string,
  history: ConversationMessage[],
  onAgentUpdate?: (run: AgentRun) => void,
  images: ImageAttachment[] = [],
  memoryContext?: string,
): Promise<AgentOutput | null> {
  // Re-classify so mirofish has the same product context as the main run
  const classification = await classifyQuery(query, history, images, memoryContext);
  const { product, competitor, productUrl, competitorUrl, intent } = classification;

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

  const run: AgentRun = { agentId: mirofishAgent.id, name: mirofishAgent.name, status: 'running', startedAt: new Date().toISOString() };
  onAgentUpdate?.(run);

  try {
    const output = await mirofishAgent.run(agentContext);
    onAgentUpdate?.({ ...run, status: 'completed', completedAt: new Date().toISOString() });
    return output;
  } catch (err) {
    onAgentUpdate?.({ ...run, status: 'failed', completedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
