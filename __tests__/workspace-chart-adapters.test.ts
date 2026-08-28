import { describe, it, expect } from 'vitest';
import {
  supportedChartTypes,
  toChartSeries,
  seriesToRows,
} from '@/lib/workspace/chart-adapters';
import type {
  MarketTrendsOutput,
  CompetitiveOutput,
  ForecastOutput,
  MindMapOutput,
  PricingOutput,
} from '@/lib/agents/types';

const base = {
  agentId: 'test',
  domain: 'market-trends' as const,
  confidence: 'high' as const,
  confidenceScore: 0.9,
  facts: ['f1'],
  interpretation: ['i1'],
  sources: [],
  generatedAt: new Date().toISOString(),
};

describe('workspace chart adapters', () => {
  it('maps trend-chart to absolute change series with direction colors', () => {
    const output: MarketTrendsOutput = {
      ...base,
      artifactType: 'trend-chart',
      trends: [
        { keyword: 'AI SDR', direction: 'up', changePercent: 40, signal: 'rising', source: 'news' },
        { keyword: 'Legacy CRM', direction: 'down', changePercent: -12, signal: 'falling', source: 'hn' },
      ],
      categoryOutlook: 'accelerating',
      keySignals: ['hiring surge'],
      timeHorizon: '6 months',
    };

    const series = toChartSeries(output);
    expect(series).toHaveLength(1);
    expect(series[0].points[0]).toMatchObject({ name: 'AI SDR', value: 40, color: '#10b981' });
    expect(series[0].points[1]).toMatchObject({ name: 'Legacy CRM', value: 12, color: '#ef4444' });
    expect(supportedChartTypes(output)).toContain('pie');
    expect(supportedChartTypes(output)[0]).toBe('native');
  });

  it('maps competitive matrix to two strength series', () => {
    const output: CompetitiveOutput = {
      ...base,
      domain: 'competitive',
      artifactType: 'competitive-matrix',
      competitor: 'Lilian',
      matrix: [
        { feature: 'Outbound', yourProduct: 'strong', competitor: 'medium', gapDirection: 'advantage' },
      ],
      competitorSummary: 'ok',
      hiringSignals: [],
      recentMoves: [],
    };

    const series = toChartSeries(output);
    expect(series).toHaveLength(2);
    expect(series[0].points[0].value).toBe(3);
    expect(series[1].points[0].value).toBe(2);
    expect(seriesToRows(series)[0]).toMatchObject({ name: 'Outbound', 'Your product': 3, Lilian: 2 });
    expect(supportedChartTypes(output)).toEqual(['native', 'bar', 'radar', 'table']);
  });

  it('maps forecast distribution and keeps mind-map native-only', () => {
    const forecast: ForecastOutput = {
      ...base,
      domain: 'mirofish',
      artifactType: 'forecast-chart',
      question: 'Will digital workers accelerate?',
      pointEstimate: 0.72,
      unit: 'probability',
      confidenceLow: 0.6,
      confidenceHigh: 0.85,
      direction: 'up',
      swarmSize: 40,
      timeHorizon: '6 months',
      distribution: [
        { label: 'positive', count: 28 },
        { label: 'negative', count: 12 },
      ],
      contributingSignals: [],
      rationale: 'majority positive',
    };

    expect(toChartSeries(forecast)[0].points).toHaveLength(2);
    expect(supportedChartTypes(forecast)).toContain('donut');

    const mind: MindMapOutput = {
      ...base,
      artifactType: 'mind-map',
      centralTopic: 'Vector',
      branches: [{ id: '1', label: 'Market' }],
      summary: 'overview',
    };
    expect(supportedChartTypes(mind)).toEqual(['native']);
    expect(toChartSeries(mind)).toEqual([]);
  });

  it('falls back to native+table when pricing tiers are non-numeric', () => {
    const output: PricingOutput = {
      ...base,
      domain: 'pricing',
      artifactType: 'pricing-table',
      competitorPricing: [
        { tierName: 'Pro', price: 'Contact sales', features: [], targetSegment: 'enterprise' },
      ],
      willingnessToPay: 'premium',
      pricingSignals: [],
      recommendation: 'hold',
    };

    expect(supportedChartTypes(output)).toEqual(['native', 'table']);
    expect(toChartSeries(output)).toEqual([]);
  });
});
