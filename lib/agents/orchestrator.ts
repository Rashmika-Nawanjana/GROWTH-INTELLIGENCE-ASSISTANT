import { marketTrendsAgent } from './market-trends';
import { competitiveAgent } from './competitive';
import { winLossAgent } from './win-loss';
import { pricingAgent } from './pricing';
import { positioningAgent } from './positioning';
import { adjacentAgent } from './adjacent';
import { executionEngineAgent } from './execution/execution-engine';
import { mirofishAgent } from './mirofish';
import { mirofishLiveAgent } from './mirofish-live';
import { detectExecutionIntent } from './execution-intent';
import { generateHuggingFaceText } from './gemini';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadEvidenceForOrchestration,
  mergeEvidenceIntoAgentContext,
  mergeEvidenceIntoSynthesisMemory,
} from '../evidence/orchestrate-hook';
import {
  applyPlanToContext,
  buildResearchPlan,
  shouldSkipDomainLlm,
  type ResearchPlan,
} from './research-plan';
import { insufficientOutput } from './skipped-output';
import {
  buildCitationIndex,
  formatCitationsForPrompt,
  stripUnknownCitations,
} from './citations';
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
  GeographyContext,
  CitationEntry,
  EvidenceCandidate,
} from './types';
import { scoreToLevel } from './types';
import { filterAndRankSources } from '@/lib/tools/source-validator';
import { enrichRunMetrics } from '@/lib/observability/build-metrics';
import { runAgentObservation } from '@/lib/observability/langfuse';

// ── Cost estimation constants ───────────────────────────────────────────────
// Lightweight model-call estimate used for the UI metrics readout.
// The exact provider cost varies, so this intentionally stays heuristic.
const EST_INPUT_TOKENS_PER_CALL = 2000;
const EST_OUTPUT_TOKENS_PER_CALL = 1000;
const COST_PER_INPUT_TOKEN = 0.10 / 1_000_000;
const COST_PER_OUTPUT_TOKEN = 0.40 / 1_000_000;
export const EST_COST_PER_MODEL_CALL =
  EST_INPUT_TOKENS_PER_CALL * COST_PER_INPUT_TOKEN +
  EST_OUTPUT_TOKENS_PER_CALL * COST_PER_OUTPUT_TOKEN;

// Gemini model is resolved inside lib/agents/gemini.ts via GEMINI_MODEL env
// var (default: gemini-2.5-flash). We deliberately don't override per-call
// so that one env change switches every agent at once.

// ── All registered domain agents (6 fast Stage-1 agents) ────────────────────
export const ALL_AGENTS: AgentConfig[] = [
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
export interface ClassificationResult {
  product: string;
  competitor?: string;
  productUrl?: string;
  competitorUrl?: string;
  domains: IntelligenceDomain[];
  intent: string;
  runExecution: boolean;  // true when query is execution-intent (write copy, outreach, variants, brief)
  geography?: GeographyContext;
  category?: string;
  namedEntities?: string[];
  requiredTerms?: string[];
}

const VALID_DOMAINS: IntelligenceDomain[] = [
  'market-trends',
  'competitive',
  'win-loss',
  'pricing',
  'positioning',
  'adjacent',
];

export interface OrchestrateOptions {
  injectedContext?: string; // extra context injected into agents and synthesizer (e.g. feedback loop)
  forceExecution?: boolean; // force stage-2 execution even when classifier says false
  followUpMode?: 'full' | 'targeted'; // targeted runs only classifier-selected research domains
  selectedAgents?: string[]; // optional UI-selected domains from client
  userId?: string; // authenticated user — required for evidence RAG retrieval/indexing
  /** Live status lines for the UI (e.g. “Reasoning…”, “Orchestrating…”). */
  onOrchestrationLog?: (message: string) => void;
  /** Guardrail constraints from input gate (medium risk). */
  guardrailConstraints?: {
    disableExecution: boolean;
    restrictScraping: boolean;
    maxAgents: number;
    conservativePrompt: boolean;
  };
  guardrailRisk?: 'low' | 'medium' | 'high';
}

export async function classifyQuery(
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
  "runExecution": boolean,   // true if the query is execution-intent (write copy, draft outreach, campaign brief, cold email, LinkedIn post, variants, one-pager, positioning guide, outreach sequence)
  "geography": { "name": string, "countryCode": string | null, "hl": string | null } | null,
  "category": string | null, // market category e.g. "agritech / AI in agriculture", "AI SDR"
  "namedEntities": string[], // every named product/org/company in the query (even unfamiliar ones)
  "requiredTerms": string[]  // 3-8 terms a relevant source must relate to (geo, category, product names)
}

Geography rules (CRITICAL):
- Any place, region, country, or city in the query MUST be returned in geography.name
- countryCode: ISO 3166-1 alpha-2 lowercase when known (Sri Lanka→lk, India→in, US→us, UK→gb)
- hl: language hint (usually "en")
- If no geography is mentioned, set geography to null

Named entity rules:
- Include every proper noun org/product in namedEntities even if you do not recognise it
- Do NOT invent entities that are not in the query or conversation history

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
      maxNewTokens: 512,
      temperature: 0.1,
      stage: 'classify',
    });
    const parsed = safeParseJson(raw);
    return {
      product: (parsed.product as string) ?? 'the product',
      competitor: (parsed.competitor as string) ?? undefined,
      productUrl: (parsed.productUrl as string) ?? undefined,
      competitorUrl: (parsed.competitorUrl as string) ?? undefined,
      domains: normalizeDomains(parsed.domains),
      intent: (parsed.intent as string) ?? query,
      runExecution: ((parsed.runExecution as boolean) ?? false) || regexExecution,
      geography: normalizeGeography(parsed.geography),
      category: typeof parsed.category === 'string' && parsed.category.trim()
        ? parsed.category.trim()
        : undefined,
      namedEntities: normalizeStringArray(parsed.namedEntities),
      requiredTerms: normalizeStringArray(parsed.requiredTerms),
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

function normalizeDomains(rawDomains: unknown): IntelligenceDomain[] {
  if (!Array.isArray(rawDomains)) {
    return ['market-trends', 'competitive', 'win-loss'];
  }
  const filtered = rawDomains
    .filter((domain): domain is IntelligenceDomain =>
      typeof domain === 'string' && VALID_DOMAINS.includes(domain as IntelligenceDomain),
    );
  if (filtered.length >= 3) return filtered;
  const merged = [...new Set([...filtered, 'market-trends', 'competitive', 'win-loss'])];
  return merged.slice(0, 6) as IntelligenceDomain[];
}

function normalizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .map(t => t.trim());
  return items.length > 0 ? [...new Set(items)] : undefined;
}

function normalizeGeography(raw: unknown): GeographyContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  if (!name) return undefined;
  const countryCode =
    typeof obj.countryCode === 'string' && obj.countryCode.trim()
      ? obj.countryCode.trim().toLowerCase()
      : undefined;
  const hl =
    typeof obj.hl === 'string' && obj.hl.trim()
      ? obj.hl.trim().toLowerCase()
      : undefined;
  return { name, countryCode, hl };
}

// ── Synthesizer — merges all agent outputs into a final answer ────────────────
export async function synthesize(
  query: string,
  outputs: AgentOutput[],
  history: ConversationMessage[],
  images: ImageAttachment[] = [],
  memoryContext?: string,
  citations: CitationEntry[] = [],
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
    evidenceStatus: o.evidence?.status,
    evidenceGaps: o.evidence?.gaps?.slice(0, 3),
    searchedFor: o.evidence?.searchedFor?.slice(0, 4),
  }));

  const insufficientDomains = outputs.filter(o => o.evidence?.status === 'insufficient');
  const evidenceBlock = insufficientDomains.length > 0
    ? `\nEvidence gaps (DO NOT invent or fill these with unrelated global data):\n${insufficientDomains
        .map(o => `- ${o.domain}: ${o.evidence?.gaps?.join('; ') || 'insufficient local evidence'} (searched: ${(o.evidence?.searchedFor ?? []).slice(0, 3).join(' | ')})`)
        .join('\n')}\n`
    : '';

  const citationBlock = citations.length > 0
    ? `\nNumbered sources (cite as [n] inline):\n${formatCitationsForPrompt(citations)}\n`
    : '';

  const prompt = `You are the synthesis layer of a multi-agent growth intelligence system. Your job is to produce a clean, direct, well-written answer.

Original query: "${query}"
${memoryContext ? `${memoryContext}\n` : ''}${priorSummary ? `Prior conversation context:\n${priorSummary}\n` : ''}
Agent findings from ${outputs.length} specialist agents:
${JSON.stringify(outputSummaries, null, 2)}
${evidenceBlock}${citationBlock}
Rules:
1. If the query asks a FACTUAL question (revenue, funding amount, year founded, etc.), lead with the direct answer in the first sentence.
2. Write in clean prose — no raw tool labels like [WEB], [NEWS], [REDDIT]. Never output bracket prefixes except numbered citations [1], [2].
3. Reference insights by domain only when relevant (e.g. "Competitive data shows...").
4. Be specific and concrete — cite actual company names, numbers, trends from the findings.
5. Every concrete claim (number, company name, pricing point) MUST carry an inline citation [n] matching the numbered sources list. Drop claims you cannot cite.
6. Keep the "answer" field under 180 words. Make it readable and insightful.
7. Only include recommendations if directly actionable from the findings. 2-3 max.
8. When a domain has evidenceStatus "insufficient", NAME THE GAP explicitly and recommend next research steps. Never substitute generic industry stats, unrelated vendor pricing (Figma, Salesforce), or global listicles for missing local evidence.

Return ONLY valid JSON (no markdown, no fences):
{
  "answer": "string — direct, clean prose answer with [n] citations. Start with the most important finding. No raw tool labels.",
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
      maxNewTokens: 768,
      temperature: 0.2,
      stage: 'synthesis',
    });
    const parsed = safeParseJson(raw);
    const answerRaw = (parsed.answer as string) || buildFallbackAnswer(outputs, query);
    const answer = stripUnknownCitations(answerRaw, citations.length);
    return {
      answer,
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
export async function generateMindMap(
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
      maxNewTokens: 2048,
      temperature: 0.15,
      stage: 'mind-map',
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
      sources: filterAndRankSources(outputs.flatMap(o => o.sources), 10),
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
  supabase?: SupabaseClient,
): Promise<OrchestratorOutput> {
  const orchestrationStart = Date.now();
  const log = options?.onOrchestrationLog;

  // Step 1: Classify query and extract context  (1 model call)
  log?.('Reasoning about your query and selecting intelligence domains…');
  const classification = await classifyQuery(query, history, images, memoryContext);
  let modelCallCount = 1;

  const { product, competitor, productUrl, competitorUrl, intent, runExecution } = classification;
  const allowedAgents = new Set(options?.selectedAgents?.length ? options.selectedAgents : ALL_AGENTS.map(a => a.id));
  const executionEnabled = allowedAgents.has('execution-engine');
  const gc = options?.guardrailConstraints;
  const shouldRunExecution =
    executionEnabled &&
    !gc?.disableExecution &&
    (runExecution || options?.forceExecution === true);

  // Build prior context string for agents
  const priorContext = history
    .slice(-4)
    .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.slice(0, 400)}`)
    .join('\n');

  const combinedPriorContext = [priorContext, options?.injectedContext]
    .filter(Boolean)
    .join('\n\n');

  const { CONSERVATIVE_PREAMBLE } = await import('@/lib/guardrails');
  const synthesisMemoryContext = [
    gc?.conservativePrompt ? CONSERVATIVE_PREAMBLE : null,
    memoryContext,
    options?.injectedContext,
  ]
    .filter(Boolean)
    .join('\n\n') || undefined;

  const evidenceContext = await loadEvidenceForOrchestration(supabase, {
    userId: options?.userId,
    query,
    classification,
  });
  if (evidenceContext.hits.length > 0) {
    log?.(`Recalled ${evidenceContext.hits.length} prior evidence chunk(s) from your research library.`);
  }

  const agentContextBase: AgentContext = {
    query: intent,
    product,
    competitor,
    productUrl,
    competitorUrl,
    priorContext: combinedPriorContext || undefined,
    images: images.length > 0 ? images : undefined,
    memoryContext: synthesisMemoryContext,
    geography: classification.geography,
    category: classification.category,
    namedEntities: classification.namedEntities,
    requiredTerms: classification.requiredTerms,
    guardrailConstraints: gc,
    guardrailRisk: options?.guardrailRisk,
  };

  // Step 1b: Shared discovery + research planner (1 model call, budgeted)
  const plannerRun: AgentRun = {
    agentId: 'research-planner',
    name: 'Research Planner',
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  onAgentUpdate?.(plannerRun);
  const plannerStart = Date.now();
  let plan: ResearchPlan;
  try {
    plan = await buildResearchPlan(agentContextBase, {
      budgetMs: 12_000,
      onLog: log,
    });
    modelCallCount += 1;
    plannerRun.status = 'completed';
    plannerRun.completedAt = new Date().toISOString();
  } catch (err) {
    plan = {
      localEntities: [],
      perDomainQueries: {},
      gapQueries: [],
      applicableDomains: ['market-trends', 'competitive', 'win-loss', 'pricing', 'positioning', 'adjacent'],
      notes: ['Research planner failed; using template queries.'],
      searchedFor: [],
      scrapedCount: 0,
      searchCallCount: 0,
    };
    plannerRun.status = 'failed';
    plannerRun.completedAt = new Date().toISOString();
    plannerRun.error = err instanceof Error ? err.message : String(err);
  }
  onAgentUpdate?.(plannerRun);

  // Merge discovered entities into base context
  const entityNames = plan.localEntities.map(e => e.name);
  let agentContext: AgentContext = mergeEvidenceIntoAgentContext({
    ...agentContextBase,
    namedEntities: [...new Set([...(agentContextBase.namedEntities ?? []), ...entityNames])],
    requiredTerms: [
      ...new Set([
        ...(agentContextBase.requiredTerms ?? []),
        ...entityNames,
        ...(classification.geography?.name ? [classification.geography.name] : []),
      ]),
    ],
    discoveredEntities: plan.localEntities,
    gapQueries: plan.gapQueries,
    planNotes: plan.notes,
  }, evidenceContext);

  const synthesisMemoryWithEvidence = mergeEvidenceIntoSynthesisMemory(
    synthesisMemoryContext,
    evidenceContext,
  );

  // Step 2: Select research agents.
  // Main queries default to full sweep; follow-ups may run targeted domains.
  const classifiedDomains = new Set(classification.domains ?? []);
  const availableResearchAgents = ALL_AGENTS.filter(agent => allowedAgents.has(agent.id));
  const targetedAgents = availableResearchAgents.filter(agent => classifiedDomains.has(agent.id as IntelligenceDomain));
  const agentsToRunRaw = options?.followUpMode === 'targeted'
    ? (targetedAgents.length > 0 ? targetedAgents : availableResearchAgents)
    : availableResearchAgents;
  const maxAgents = gc?.maxAgents && gc.maxAgents > 0 ? gc.maxAgents : agentsToRunRaw.length;
  const agentsToRun = agentsToRunRaw.slice(0, maxAgents);

  const sweepLabel = options?.followUpMode === 'targeted' ? 'targeted follow-up' : 'full research sweep';
  log?.(`Dividing work across ${agentsToRun.length} specialist agents (${sweepLabel})…`);
  log?.('Orchestrating parallel research — search, fetch, and extract…');

  // Initialise agent run tracking (planner first, then specialists)
  const agentRuns: AgentRun[] = [
    plannerRun,
    ...agentsToRun.map(a => ({
      agentId: a.id,
      name: a.name,
      status: 'pending' as const,
    })),
  ];

  const planCandidates: EvidenceCandidate[] = plan.localEntities.map(e => ({
    name: e.name,
    url: e.url,
    classification:
      e.type === 'government'
        ? 'government'
        : e.type === 'research'
          ? 'research'
          : e.type === 'vendor'
            ? 'potential'
            : 'global',
  }));

  // Step 3: Fan-out — skip LLM for entity-dependent domains with no local entities
  const agentLatencies: Record<string, number> = {
    'research-planner': Date.now() - plannerStart,
  };
  let skippedLlmCount = 0;

  const specialistRuns = agentRuns.slice(1);
  const agentPromises = agentsToRun.map(async (agent, i): Promise<AgentOutput | null> => {
    const agentStart = Date.now();
    specialistRuns[i] = {
      ...specialistRuns[i],
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    agentRuns[i + 1] = specialistRuns[i];
    onAgentUpdate?.(specialistRuns[i]);

    try {
      if (
        shouldSkipDomainLlm(
          agent.id as IntelligenceDomain,
          plan,
          classification.geography,
          product,
        )
      ) {
        skippedLlmCount += 1;
        const output = insufficientOutput({
          domain: agent.id as IntelligenceDomain,
          searchedFor: plan.searchedFor,
          gaps: plan.notes,
          candidates: planCandidates,
          geographyName: classification.geography?.name,
          category: classification.category,
        });
        agentLatencies[agent.id] = Date.now() - agentStart;
        specialistRuns[i] = {
          ...specialistRuns[i],
          status: 'completed',
          completedAt: new Date().toISOString(),
        };
        agentRuns[i + 1] = specialistRuns[i];
        onAgentUpdate?.(specialistRuns[i]);
        return output;
      }

      const domainCtx = applyPlanToContext(agentContext, plan, agent.id as IntelligenceDomain);
      const output = await runAgentObservation(agent.id, agent.name, () => agent.run(domainCtx));
      agentLatencies[agent.id] = Date.now() - agentStart;
      specialistRuns[i] = {
        ...specialistRuns[i],
        status: 'completed',
        completedAt: new Date().toISOString(),
      };
      agentRuns[i + 1] = specialistRuns[i];
      onAgentUpdate?.(specialistRuns[i]);
      return output;
    } catch (err) {
      agentLatencies[agent.id] = Date.now() - agentStart;
      const error = err instanceof Error ? err.message : String(err);
      specialistRuns[i] = {
        ...specialistRuns[i],
        status: 'failed',
        completedAt: new Date().toISOString(),
        error,
      };
      agentRuns[i + 1] = specialistRuns[i];
      onAgentUpdate?.(specialistRuns[i]);
      return null;
    }
  });

  const settledOutputs = await Promise.allSettled(agentPromises);
  const outputs: AgentOutput[] = settledOutputs
    .filter((r): r is PromiseFulfilledResult<AgentOutput> =>
      r.status === 'fulfilled' && r.value !== null
    )
    .map(r => r.value as AgentOutput);

  // Model calls only for agents that actually ran LLM synthesis
  modelCallCount += agentsToRun.length - skippedLlmCount;

  // ── Stage 2: Execution Engine (only if execution intent detected) ──────────
  if (shouldRunExecution) {
    log?.('Execution intent detected — running execution engine for deliverables…');
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

  // Step 4: Rank sources, assign citations, then synthesise + mind map
  log?.('Reasoning over findings — synthesizing answer and strategic mind map…');
  const preferReviewSites = !classification.geography;
  for (const output of outputs) {
    output.sources = filterAndRankSources(output.sources, 8, { preferReviewSites });
  }
  const citations = buildCitationIndex(outputs);
  const [synthesisResult, mindMapResult] = await Promise.all([
    synthesize(query, outputs, history, images, synthesisMemoryWithEvidence, citations),
    generateMindMap(query, product, outputs),
  ]);
  modelCallCount += 2; // synthesis + mind map
  const { answer: rawAnswer, recommendations, followUps } = synthesisResult;

  const { guardOutput } = await import('@/lib/guardrails');
  const guarded = guardOutput(rawAnswer);
  const answer = guarded.safeText;
  const safetyScore = guarded.safetyScore;

  // Append mind map to outputs if generated successfully
  if (mindMapResult) {
    outputs.push(mindMapResult);
  }

  const finalCitations = citations;

  // Step 6: Compute overall confidence
  const avgConfidence = outputs.length > 0
    ? outputs.reduce((sum, o) => sum + o.confidenceScore, 0) / outputs.length
    : 0.5;
  const totalConfidence: ConfidenceLevel = scoreToLevel(avgConfidence);

  // Step 7: Build run metrics
  const completedAgents = agentRuns.filter(r => r.status === 'completed').length;
  const failedAgents = agentRuns.filter(r => r.status === 'failed').length;
  const toolCallCount = outputs.reduce((sum, o) => sum + (o.toolCallCount ?? 0), 0)
    + plan.searchCallCount + plan.scrapedCount
    || completedAgents * 3;
  const searchCallCount =
    plan.searchCallCount +
    outputs.reduce((sum, o) => sum + (o.searchCallCount ?? 0), 0);
  const scrapeCallCount =
    plan.scrapedCount +
    outputs.reduce((sum, o) => sum + (o.scrapeCallCount ?? 0), 0);
  const droppedIrrelevantCount = outputs.reduce(
    (sum, o) => sum + (o.droppedIrrelevantCount ?? 0),
    0,
  );

  const metrics: RunMetrics = enrichRunMetrics({
    totalLatencyMs: Date.now() - orchestrationStart,
    agentLatencies,
    estimatedCostUsd: Number.parseFloat((modelCallCount * EST_COST_PER_MODEL_CALL).toFixed(5)),
    toolCallCount,
    geminiCallCount: modelCallCount,
    agentCount: agentRuns.length,
    completedAgentCount: completedAgents,
    failedAgentCount: failedAgents,
    searchCallCount,
    scrapeCallCount,
    droppedIrrelevantCount,
    localEntityCount: plan.localEntities.length,
    safetyScore,
    guardrailRisk: options?.guardrailRisk,
  });

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
    citations: finalCitations,
    retrievedEvidence: evidenceContext.hits.length > 0 ? evidenceContext.hits : undefined,
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
  onOrchestrationLog?: (message: string) => void,
): Promise<AgentOutput | null> {
  // Re-classify so mirofish has the same product context as the main run
  onOrchestrationLog?.('MiroFish: refreshing product context…');
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
    onOrchestrationLog?.('MiroFish: running forecast agent…');
    const output = await mirofishAgent.run(agentContext);
    onAgentUpdate?.({ ...run, status: 'completed', completedAt: new Date().toISOString() });
    return output;
  } catch (err) {
    onAgentUpdate?.({ ...run, status: 'failed', completedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// ── MiroFish Live agent — real VPS only, no synthetic fallback ────────────────
// Dispatched only when the user has toggled "MiroFish Live" in the UI.
export async function runMirofishLiveAgent(
  query: string,
  history: ConversationMessage[],
  onAgentUpdate?: (run: AgentRun) => void,
  images: ImageAttachment[] = [],
  memoryContext?: string,
  onOrchestrationLog?: (message: string) => void,
): Promise<AgentOutput | null> {
  const isUnavailableLiveOutput = (output: AgentOutput): boolean => {
    const forecastLike = output as AgentOutput & { rationale?: string; swarmSize?: number };
    const interpretation = Array.isArray(output.interpretation) ? output.interpretation : [];
    const rationale = typeof forecastLike.rationale === 'string' ? forecastLike.rationale : '';
    const swarmSize = typeof forecastLike.swarmSize === 'number' ? forecastLike.swarmSize : undefined;
    return (
      interpretation.some(line => /mirofish live unavailable|live swarm unavailable|live swarm interviews failed/i.test(line)) ||
      /unavailable|interviews failed|no responses/i.test(rationale) ||
      swarmSize === 0
    );
  };

  onOrchestrationLog?.('MiroFish Live: connecting to real VPS (168.144.36.78)…');
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

  const liveRun: AgentRun = {
    agentId: mirofishLiveAgent.id,
    name: mirofishLiveAgent.name,
    status: 'running',
    startedAt: new Date().toISOString(),
  };
  onAgentUpdate?.(liveRun);

  try {
    onOrchestrationLog?.('MiroFish Live: interviewing live swarm…');
    const output = await mirofishLiveAgent.run(agentContext);
    const failed = isUnavailableLiveOutput(output);
    onAgentUpdate?.({
      ...liveRun,
      status: failed ? 'failed' : 'completed',
      completedAt: new Date().toISOString(),
      ...(failed ? { error: (output as AgentOutput & { rationale?: string }).rationale ?? 'Live swarm unavailable' } : {}),
    });
    return output;
  } catch (err) {
    onAgentUpdate?.({
      ...liveRun,
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
