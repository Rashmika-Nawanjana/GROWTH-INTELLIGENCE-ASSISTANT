// ─── Source citation ──────────────────────────────────────────────────────────
export interface AgentSource {
  url: string;
  title: string;
  timestamp: string;
  tool: 'serpapi' | 'firecrawl' | 'reddit' | 'hn' | 'apify' | 'synthesis' | 'mirofish' | 'mirofish-live';
  /** Stable citation number assigned at synthesis time (1-based). */
  citationId?: number;
}

export interface CitationEntry {
  id: number;
  url: string;
  title: string;
  domains: string[];
}

export type LocalEntityType = 'vendor' | 'government' | 'research' | 'unclear';

export interface LocalEntity {
  name: string;
  url?: string;
  type: LocalEntityType;
}

// ─── Confidence ───────────────────────────────────────────────────────────────
export type ConfidenceLevel = 'high' | 'medium' | 'low';

function scoreToLevel(score: number): ConfidenceLevel {
  if (score >= 0.75) return 'high';
  if (score >= 0.5) return 'medium';
  return 'low';
}
export { scoreToLevel };

// ─── Agent lifecycle ──────────────────────────────────────────────────────────
export type AgentStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface AgentRun {
  agentId: string;
  name: string;
  status: AgentStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

// ─── Geography / grounding constraints ────────────────────────────────────────
export interface GeographyContext {
  name: string;           // e.g. "Sri Lanka"
  countryCode?: string;   // ISO 3166-1 alpha-2, e.g. "lk" (SerpAPI gl)
  hl?: string;            // language, e.g. "en"
}

export type EvidenceStatus = 'sufficient' | 'thin' | 'insufficient';

export type CandidateClassification =
  | 'direct'
  | 'adjacent'
  | 'potential'
  | 'government'
  | 'research'
  | 'global';

export interface EvidenceCandidate {
  name: string;
  url?: string;
  classification: CandidateClassification;
}

export interface EvidenceAssessment {
  status: EvidenceStatus;
  relevantSourceCount: number;
  searchedFor: string[];
  gaps: string[];
  candidates?: EvidenceCandidate[];
}

// ─── Base output every agent must return ──────────────────────────────────────
export interface AgentOutput {
  agentId: string;                  // e.g. "market-trends"
  domain: IntelligenceDomain;
  confidence: ConfidenceLevel;
  confidenceScore: number;          // 0–1
  facts: string[];                  // verifiable, source-backed claims
  interpretation: string[];         // analyst synthesis (clearly separated)
  sources: AgentSource[];
  generatedAt: string;
  artifactType: ArtifactType;
  /** Populated when research loop assesses evidence quality. */
  evidence?: EvidenceAssessment;
  /** Actual tool invocations for this agent (replaces orchestrator heuristic). */
  toolCallCount?: number;
  /** Search tool invocations for this agent. */
  searchCallCount?: number;
  /** Scrape tool invocations for this agent. */
  scrapeCallCount?: number;
  /** Hits dropped by relevance filter. */
  droppedIrrelevantCount?: number;
}

// ─── Intelligence domains ─────────────────────────────────────────────────────
export type IntelligenceDomain =
  | 'market-trends'
  | 'competitive'
  | 'win-loss'
  | 'pricing'
  | 'positioning'
  | 'adjacent'
  | 'execution-engine'
  | 'mirofish'
  | 'mirofish-live';

// ─── Artifact types (drives which component renders) ─────────────────────────
export type ArtifactType =
  | 'trend-chart'
  | 'competitive-matrix'
  | 'win-loss-scorecard'
  | 'pricing-table'
  | 'positioning-gap'
  | 'threat-heatmap'
  | 'mind-map'
  | 'scorecard'
  | 'execution-plan'
  | 'forecast-chart';

// ─── Domain-specific output shapes ───────────────────────────────────────────

export interface TrendDataPoint {
  keyword: string;
  direction: 'up' | 'down' | 'flat';
  changePercent: number;    // positive = growth
  signal: string;           // human-readable signal
  source: string;
}

export interface MarketTrendsOutput extends AgentOutput {
  artifactType: 'trend-chart';
  trends: TrendDataPoint[];
  categoryOutlook: 'accelerating' | 'consolidating' | 'maturing' | 'emerging';
  keySignals: string[];     // top 3 leading indicators
  timeHorizon: string;      // e.g. "6-12 months"
}

export interface CompetitorFeature {
  feature: string;
  yourProduct: 'strong' | 'medium' | 'weak' | 'none';
  competitor: 'strong' | 'medium' | 'weak' | 'none';
  gapDirection: 'advantage' | 'parity' | 'disadvantage';
}

export interface CompetitiveOutput extends AgentOutput {
  artifactType: 'competitive-matrix';
  competitor: string;
  matrix: CompetitorFeature[];
  competitorSummary: string;
  hiringSignals: string[];  // job posting signals
  recentMoves: string[];    // funding, launches, pivots
}

export interface WinReason {
  reason: string;
  frequency: 'often' | 'sometimes' | 'rarely';
  evidence: string;         // quote or source snippet
}

export interface WinLossOutput extends AgentOutput {
  artifactType: 'win-loss-scorecard';
  competitor: string;
  competitorWins: WinReason[];
  competitorLosses: WinReason[];
  buyerSentiment: 'positive' | 'mixed' | 'negative';
  topSwitchTriggers: string[];  // reasons buyers switch
}

export interface PricingTier {
  tierName: string;
  price: string;
  features: string[];
  targetSegment: string;
}

export interface PricingOutput extends AgentOutput {
  artifactType: 'pricing-table';
  competitorPricing: PricingTier[];
  yourPricing?: PricingTier[];
  willingnessToPay: 'premium' | 'mid-market' | 'price-sensitive';
  pricingSignals: string[];   // what buyers say about pricing
  recommendation: string;
}

export interface MessagingGap {
  dimension: string;        // e.g. "Value framing"
  yourMessage: string;
  competitorMessage: string;
  gap: string;              // the insight
  opportunity: string;      // what to do about it
}

export interface PositioningOutput extends AgentOutput {
  artifactType: 'positioning-gap';
  competitor: string;
  gaps: MessagingGap[];
  yourPositioning: string;       // how you market yourself
  competitorPositioning: string; // how they market themselves
  adThemes: string[];            // observed ad messaging themes
}

export interface AdjacentThreat {
  company: string;
  category: string;
  threatVector: string;    // how they could enter your space
  riskLevel: 'high' | 'medium' | 'low';
  evidence: string;
}

export interface AdjacentOutput extends AgentOutput {
  artifactType: 'threat-heatmap';
  threats: AdjacentThreat[];
  overallRisk: 'high' | 'medium' | 'low';
  timeToImpact: string;    // e.g. "6-18 months"
  defensiveActions: string[];
}

// ─── Mind map output ─────────────────────────────────────────────────────────

export interface MindMapNode {
  id: string;
  label: string;
  detail?: string;                // short description shown on hover/expand
  sentiment?: 'positive' | 'neutral' | 'negative' | 'warning';
  confidence?: ConfidenceLevel;   // per-node confidence (from source agent)
  sourceAgent?: string;           // which intelligence domain produced this branch
  children?: MindMapNode[];
}

export interface MindMapOutput extends AgentOutput {
  artifactType: 'mind-map';
  centralTopic: string;           // root node label
  branches: MindMapNode[];        // top-level branches
  summary: string;                // one-line overview
}

// ─── Orchestrator output ──────────────────────────────────────────────────────
export interface RunMetrics {
  totalLatencyMs: number;          // wall-clock time from start to final response
  agentLatencies: Record<string, number>;  // per-agent latency in ms
  estimatedCostUsd: number;        // lightweight cost estimate
  toolCallCount: number;           // total tool invocations across all agents
  geminiCallCount: number;         // total model calls (classification + synthesis + agents)
  agentCount: number;              // total agents dispatched (research + execution)
  completedAgentCount: number;     // agents that finished with status "completed"
  failedAgentCount: number;        // agents that finished with status "failed"
  /** Search tool invocations (SerpAPI / SearXNG / news). */
  searchCallCount?: number;
  /** Page scrape invocations (Firecrawl / Playwright). */
  scrapeCallCount?: number;
  /** Hits dropped by relevance filter across agents. */
  droppedIrrelevantCount?: number;
  /** Local entities discovered by the research planner. */
  localEntityCount?: number;
}

export interface OrchestratorOutput {
  query: string;
  product: string;
  competitor?: string;
  agentRuns: AgentRun[];
  outputs: AgentOutput[];
  synthesizedAnswer: string;       // prose summary for chat
  topRecommendations: Recommendation[];
  suggestedFollowUps: string[];
  totalConfidence: ConfidenceLevel;
  generatedAt: string;
  metrics?: RunMetrics;            // cost + latency — populated by orchestrator
  refinement?: RefinementInfo;     // present when generated by /api/refine loop
  /** Deduped numbered citations for the synthesized answer. */
  citations?: CitationEntry[];
  /** Prior evidence recalled via RAG (context only). */
  retrievedEvidence?: RetrievedEvidenceHit[];
}

export interface Recommendation {
  title: string;
  rationale: string;
  evidence: string[];
  confidence: ConfidenceLevel;
  priority: 'immediate' | 'short-term' | 'strategic';
}

export interface FeedbackAppliedCounts {
  recommendationFeedback: number;
  recommendationActions: number;
  variantResults: number;
}

export interface RefinementDelta {
  domain: IntelligenceDomain;
  summary: string;
  beforeConfidence?: ConfidenceLevel;
  afterConfidence?: ConfidenceLevel;
}

export interface RefinementInfo {
  refinedFromMessageId: string;
  focus?: string;
  feedbackApplied: FeedbackAppliedCounts;
  deltas: RefinementDelta[];
  feedbackSummary: string;
}

// ─── MiroFish Forecast output (Member 3 — Swarm-Simulation Agent) ────────────

export interface ForecastSignal {
  persona: string;        // e.g. "skeptical VP of Engineering"
  weight: number;         // -1 to +1 (positive = supports the forecast direction)
  excerpt?: string;       // short representative quote from the swarm response
}

export interface DistributionBucket {
  label: string;          // e.g. "strongly positive"
  count: number;          // number of simulated personas in this bucket
}

export interface ForecastOutput extends AgentOutput {
  artifactType: 'forecast-chart';
  question: string;                     // LLM-rewritten forecast question from user query
  pointEstimate: number;                // 0-1 probability
  unit: 'probability' | 'value' | 'percent';
  confidenceLow: number;                // lower bound of 90% CI
  confidenceHigh: number;               // upper bound of 90% CI
  direction: 'up' | 'down' | 'flat';   // headline direction of the predicted outcome
  swarmSize: number;                    // number of simulated personas polled
  timeHorizon: string;                  // e.g. "6 months", "Q3 2026"
  distribution: DistributionBucket[];   // sentiment distribution across the swarm
  contributingSignals: ForecastSignal[]; // top 3-5 personas + influence weight
  rationale: string;                    // 2-3 sentence plain-English forecast summary
}

// ─── Image attachment ────────────────────────────────────────────────────────
export interface ImageAttachment {
  data: string;       // base64-encoded image data (no data: prefix)
  mimeType: string;   // e.g. "image/png", "image/jpeg"
}

// ─── Chat message ─────────────────────────────────────────────────────────────
export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: ImageAttachment[];
  agentOutput?: OrchestratorOutput;
  timestamp: string;
}

// ─── Agent config (what the orchestrator dispatches) ─────────────────────────
export interface AgentConfig {
  id: IntelligenceDomain;
  name: string;
  description: string;
  run: (context: AgentContext) => Promise<AgentOutput>;
}

export interface AgentContext {
  query: string;
  product: string;
  competitor?: string;
  productUrl?: string;
  competitorUrl?: string;
  priorContext?: string;    // serialised prior conversation findings
  images?: ImageAttachment[];  // optional visual context from user
  memoryContext?: string;      // persistent user memory across all sessions
  researchOutputs?: AgentOutput[];  // stage-1 research findings — populated for Execution Engine only
  /** Geographic constraint extracted by classifier (e.g. Sri Lanka). */
  geography?: GeographyContext;
  /** Inferred category (e.g. "agritech / AI in agriculture"). */
  category?: string;
  /** Named orgs/products from the query that must be investigated. */
  namedEntities?: string[];
  /** Terms a source must plausibly relate to for relevance filtering. */
  requiredTerms?: string[];
  /** Entities discovered by the shared research planner (pre-fan-out). */
  discoveredEntities?: LocalEntity[];
  /** Domain-specific queries from the research planner (1–2). */
  plannedQueries?: string[];
  /** Gap-fill queries for Round 2 (tool-only). */
  gapQueries?: string[];
  /** Planner notes (what was searched / missing). */
  planNotes?: string[];
  /** Prior indexed evidence hits (RAG) — context only, not live verification. */
  retrievedEvidence?: RetrievedEvidenceHit[];
}

export interface RetrievedEvidenceHit {
  id: string;
  documentId: string;
  kind: 'page' | 'fact';
  content: string;
  similarity: number;
  url: string;
  title?: string;
  sourceTool: string;
  domain?: string;
  product?: string;
  fetchedAt: string;
  ageDays: number;
}

// ─── Execution Engine output shapes (Member 3) ───────────────────────────────

export interface CampaignVariant {
  id: string;                                    // e.g. "V1-ROI"
  angle: string;                                 // e.g. "ROI-focused"
  hypothesis: string;                            // falsifiable — tied to a research signal
  successMetric: string;                         // e.g. "reply rate > 4%"
  variable: string;                              // the single variable being tested
  channels: {
    email?: { subject: string; body: string; followUps?: string[] };
    linkedin?: { hook: string; post: string };
  };
  groundedSignals: string[];                     // pointers back to research agent findings
}

export interface CampaignBrief {
  objective: string;
  targetAudience: string;
  painPoints: string[];
  keyMessagingAngles: { angle: string; hypothesis: string }[];
  variantsSummary: string;
  channelStrategy: string;
  successMetrics: string[];
  nextSteps: string[];
}

export interface DeploymentStep {
  day: number;
  action: string;                                // e.g. "Send Variant A to Segment X"
  channel: 'email' | 'linkedin' | 'ads';
  audience: string;
}

export interface ExecutionPlanOutput extends AgentOutput {
  artifactType: 'execution-plan';
  variants: CampaignVariant[];
  brief: CampaignBrief;
  deployment: DeploymentStep[];
}
