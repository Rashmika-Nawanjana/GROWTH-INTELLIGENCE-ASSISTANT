'use client';

import React from 'react';
import type { AgentOutput, MarketTrendsOutput, CompetitiveOutput, WinLossOutput, PricingOutput, PositioningOutput, AdjacentOutput, MindMapOutput, ExecutionPlanOutput, ForecastOutput, StealPlaybookOutput, OrchestratorOutput, RefinementDelta } from '@/lib/agents/types';
import { TrendChart } from './TrendChart';
import { CompetitiveMatrix } from './CompetitiveMatrix';
import { WinLossScorecard } from './WinLossScorecard';
import { PricingTable } from './PricingTable';
import { PositioningGap } from './PositioningGap';
import { ThreatHeatmap } from './ThreatHeatmap';
import { MindMap } from './MindMap';
import { ExecutionPlan } from './ExecutionPlan';
import { ForecastChart } from './ForecastChart';
import { StealPlaybook } from './StealPlaybook';
import { EmptyArtifact } from './EmptyArtifact';
import { InsufficientEvidence } from './InsufficientEvidence';

interface Props {
  output: AgentOutput;
  product: string;
  // Feedback loop — only needed for ExecutionPlan; ignored by other artifacts.
  sessionId?: string | null;
  messageId?: string | null;
  onRefined?: (result: { plan: ExecutionPlanOutput; orchestratorOutput?: OrchestratorOutput; changes?: RefinementDelta[] }) => void;
}

// Defensively normalise an output's arrays so child components can iterate
// without optional-chaining everywhere. Returns the same object reference
// when no patches were needed (cheap fast-path).
function withArrayDefaults<T extends Record<string, any>>(output: T, fields: (keyof T)[]): T {
  let patched: T | null = null;
  for (const f of fields) {
    if (output[f] === undefined || output[f] === null) {
      if (!patched) patched = { ...output };
      (patched as any)[f] = [];
    }
  }
  return patched ?? output;
}

export function ArtifactRenderer({ output, product, sessionId, messageId, onRefined }: Props) {
  if (!output) return <EmptyArtifact label="Artifact" reason="No agent output to render." />;

  if (output.evidence?.status === 'insufficient') {
    return <InsufficientEvidence output={output} />;
  }

  switch (output.artifactType) {
    case 'trend-chart': {
      const o = withArrayDefaults(output as MarketTrendsOutput, ['trends', 'keySignals']);
      if (!o.trends.length && !o.keySignals.length) {
        return <EmptyArtifact label="Market Trend Analysis" reason="No measurable trends surfaced from this run." />;
      }
      return <TrendChart output={o} />;
    }
    case 'competitive-matrix': {
      const o = withArrayDefaults(output as CompetitiveOutput, ['matrix', 'hiringSignals', 'recentMoves']);
      if (!o.matrix.length && !o.competitorSummary) {
        return <EmptyArtifact label="Feature Comparison Matrix" reason="No comparable feature data was found." />;
      }
      return <CompetitiveMatrix output={o} product={product} />;
    }
    case 'win-loss-scorecard': {
      const o = withArrayDefaults(output as WinLossOutput, ['competitorWins', 'competitorLosses', 'topSwitchTriggers']);
      if (!o.competitorWins.length && !o.competitorLosses.length) {
        return <EmptyArtifact label="Win / Loss Analysis" reason="No buyer-side wins or losses surfaced." />;
      }
      return <WinLossScorecard output={o} competitor={o.competitor} product={product} />;
    }
    case 'pricing-table': {
      const o = withArrayDefaults(output as PricingOutput, ['competitorPricing', 'pricingSignals']);
      if (!o.competitorPricing.length && !o.pricingSignals.length) {
        return <EmptyArtifact label="Pricing Intelligence" reason="No competitor pricing or willingness-to-pay signals found." />;
      }
      return <PricingTable output={o} />;
    }
    case 'positioning-gap': {
      const o = withArrayDefaults(output as PositioningOutput, ['gaps', 'adThemes']);
      if (!o.gaps.length && !o.yourPositioning) {
        return <EmptyArtifact label="Positioning Gap Analysis" reason="No positioning gaps detected in this run." />;
      }
      return <PositioningGap output={o} product={product} competitor={o.competitor} />;
    }
    case 'threat-heatmap': {
      const o = withArrayDefaults(output as AdjacentOutput, ['threats', 'defensiveActions']);
      if (!o.threats.length && !o.defensiveActions.length) {
        return <EmptyArtifact label="Adjacent Threat Heatmap" reason="No adjacent-market threats detected." />;
      }
      return <ThreatHeatmap output={o} />;
    }
    case 'mind-map': {
      const o = withArrayDefaults(output as MindMapOutput, ['branches']);
      if (!o.branches.length) {
        return <EmptyArtifact label="Mind Map" reason="Synthesis produced no usable mind-map branches." />;
      }
      return <MindMap output={o} />;
    }
    case 'execution-plan': {
      const o = withArrayDefaults(output as ExecutionPlanOutput, ['variants', 'deployment']);
      if (!o.variants.length && !o.brief?.objective) {
        return <EmptyArtifact label="Execution Plan" reason="Execution Engine returned no variants or brief." />;
      }
      return <ExecutionPlan output={o} product={product} sessionId={sessionId} messageId={messageId} onRefined={onRefined} />;
    }
    case 'forecast-chart': {
      const o = output as ForecastOutput;
      // Empty-state guard — hide card when swarm is unavailable
      if (!o.question || !o.swarmSize) {
        return <EmptyArtifact label="Swarm Forecast" reason="MiroFish simulation unavailable or not yet bootstrapped for this product." />;
      }
      return <ForecastChart output={o} product={product} />;
    }
    case 'steal-playbook': {
      const o = withArrayDefaults(output as StealPlaybookOutput, [
        'historicalCompetitiveMoves',
        'modernEntrantPlaybook',
      ]);
      if (!o.historicalCompetitiveMoves.length && !o.modernEntrantPlaybook.length && !o.summary) {
        return <EmptyArtifact label="Steal Playbook" reason="No grounded competitive history surfaced for this company." />;
      }
      return <StealPlaybook output={o} />;
    }
    default:
      return <EmptyArtifact label="Artifact" reason="Unknown artifact type." />;
  }
}
