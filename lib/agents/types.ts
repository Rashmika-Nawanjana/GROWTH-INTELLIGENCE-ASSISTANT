// ─── Source citation ──────────────────────────────────────────────────────────
export interface AgentSource {
  url: string;
  title: string;
  timestamp: string;
  tool: 'serpapi' | 'firecrawl' | 'reddit' | 'hn' | 'synthesis';
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
}

// ─── Intelligence domains ─────────────────────────────────────────────────────
export type IntelligenceDomain =
  | 'market-trends'
  | 'competitive'
  | 'win-loss'
  | 'pricing'
  | 'positioning'
  | 'adjacent';

// ─── Artifact types (drives which component renders) ─────────────────────────
export type ArtifactType =
  | 'trend-chart'
  | 'competitive-matrix'
  | 'win-loss-scorecard'
  | 'pricing-table'
  | 'positioning-gap'
  | 'threat-heatmap'
  | 'scorecard';

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

// ─── Orchestrator output ──────────────────────────────────────────────────────
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
}

export interface Recommendation {
  title: string;
  rationale: string;
  evidence: string[];
  confidence: ConfidenceLevel;
  priority: 'immediate' | 'short-term' | 'strategic';
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
}
