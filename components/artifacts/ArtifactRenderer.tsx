'use client';

import React from 'react';
import type { AgentOutput, MarketTrendsOutput, CompetitiveOutput, WinLossOutput, PricingOutput, PositioningOutput, AdjacentOutput } from '@/lib/agents/types';
import { TrendChart } from './TrendChart';
import { CompetitiveMatrix } from './CompetitiveMatrix';
import { WinLossScorecard } from './WinLossScorecard';
import { PricingTable } from './PricingTable';
import { PositioningGap } from './PositioningGap';
import { ThreatHeatmap } from './ThreatHeatmap';

interface Props {
  output: AgentOutput;
  product: string;
}

export function ArtifactRenderer({ output, product }: Props) {
  // Only render if the output has meaningful domain-specific data
  switch (output.artifactType) {
    case 'trend-chart': {
      const o = output as MarketTrendsOutput;
      if (!o.trends?.length && !o.keySignals?.length) return null;
      return <TrendChart output={o} />;
    }
    case 'competitive-matrix': {
      const o = output as CompetitiveOutput;
      if (!o.matrix?.length && !o.competitorSummary) return null;
      return <CompetitiveMatrix output={o} product={product} />;
    }
    case 'win-loss-scorecard': {
      const o = output as WinLossOutput;
      if (!o.competitorWins?.length && !o.competitorLosses?.length) return null;
      return <WinLossScorecard output={o} competitor={o.competitor} product={product} />;
    }
    case 'pricing-table': {
      const o = output as PricingOutput;
      if (!o.competitorPricing?.length && !o.pricingSignals?.length) return null;
      return <PricingTable output={o} />;
    }
    case 'positioning-gap': {
      const o = output as PositioningOutput;
      if (!o.gaps?.length && !o.yourPositioning) return null;
      return <PositioningGap output={o} product={product} competitor={o.competitor} />;
    }
    case 'threat-heatmap': {
      const o = output as AdjacentOutput;
      if (!o.threats?.length && !o.defensiveActions?.length) return null;
      return <ThreatHeatmap output={o} />;
    }
    default:
      return null;
  }
}
