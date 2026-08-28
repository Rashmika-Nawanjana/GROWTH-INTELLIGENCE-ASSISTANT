/**
 * Build a valid AgentOutput without an LLM call when evidence cannot support
 * the domain (e.g. no local vendors for Pricing in a geo-constrained query).
 */

import type {
  AdjacentOutput,
  CompetitiveOutput,
  EvidenceAssessment,
  EvidenceCandidate,
  IntelligenceDomain,
  PositioningOutput,
  PricingOutput,
  WinLossOutput,
  AgentOutput,
} from './types';

export interface InsufficientOutputOptions {
  domain: IntelligenceDomain;
  searchedFor?: string[];
  gaps?: string[];
  candidates?: EvidenceCandidate[];
  geographyName?: string;
  category?: string;
}

function buildEvidence(opts: InsufficientOutputOptions): EvidenceAssessment {
  const label = opts.domain.replace(/-/g, ' ');
  const scope = [opts.geographyName, opts.category].filter(Boolean).join(' / ');
  const gaps =
    opts.gaps && opts.gaps.length > 0
      ? opts.gaps
      : [
          `No verified local organisations found for ${label}${scope ? ` in ${scope}` : ''}.`,
          'Skipped model synthesis to avoid inventing competitors or unrelated global pricing.',
        ];

  return {
    status: 'insufficient',
    relevantSourceCount: 0,
    searchedFor: opts.searchedFor?.filter(Boolean) ?? [],
    gaps,
    candidates: opts.candidates?.length ? opts.candidates : undefined,
  };
}

function baseFields(opts: InsufficientOutputOptions, evidence: EvidenceAssessment) {
  return {
    agentId: opts.domain,
    domain: opts.domain,
    confidence: 'low' as const,
    confidenceScore: 0.25,
    facts: [] as string[],
    interpretation: evidence.gaps,
    sources: [],
    generatedAt: new Date().toISOString(),
    evidence,
    toolCallCount: 0,
    searchCallCount: 0,
    scrapeCallCount: 0,
    droppedIrrelevantCount: 0,
  };
}

/**
 * Zero-LLM insufficient evidence output for entity-dependent domains.
 */
export function insufficientOutput(opts: InsufficientOutputOptions): AgentOutput {
  const evidence = buildEvidence(opts);
  const base = baseFields(opts, evidence);
  const gap0 = evidence.gaps[0] ?? 'Insufficient evidence.';

  switch (opts.domain) {
    case 'pricing': {
      const out: PricingOutput = {
        ...base,
        domain: 'pricing',
        artifactType: 'pricing-table',
        competitorPricing: [],
        yourPricing: [],
        willingnessToPay: 'mid-market',
        pricingSignals: [],
        recommendation: gap0,
      };
      return out;
    }
    case 'win-loss': {
      const out: WinLossOutput = {
        ...base,
        domain: 'win-loss',
        artifactType: 'win-loss-scorecard',
        competitor: 'unknown',
        competitorWins: [],
        competitorLosses: [],
        buyerSentiment: 'mixed',
        topSwitchTriggers: [],
      };
      return out;
    }
    case 'positioning': {
      const out: PositioningOutput = {
        ...base,
        domain: 'positioning',
        artifactType: 'positioning-gap',
        competitor: 'unknown',
        gaps: evidence.gaps.map(g => ({
          dimension: 'Local market coverage',
          yourMessage: '',
          competitorMessage: '',
          gap: g,
          opportunity: 'Conduct local market research before messaging claims.',
        })),
        yourPositioning: '',
        competitorPositioning: '',
        adThemes: [],
      };
      return out;
    }
    case 'competitive': {
      const out: CompetitiveOutput = {
        ...base,
        domain: 'competitive',
        artifactType: 'competitive-matrix',
        competitor: 'unknown',
        matrix: [],
        competitorSummary: gap0,
        hiringSignals: [],
        recentMoves: [],
      };
      return out;
    }
    case 'adjacent': {
      const out: AdjacentOutput = {
        ...base,
        domain: 'adjacent',
        artifactType: 'threat-heatmap',
        threats: [],
        overallRisk: 'low',
        timeToImpact: 'unknown',
        defensiveActions: evidence.gaps.slice(0, 2),
      };
      return out;
    }
    default:
      return {
        ...base,
        artifactType: 'scorecard',
      };
  }
}
