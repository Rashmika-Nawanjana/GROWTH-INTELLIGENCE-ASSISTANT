import type {
  AgentOutput,
  AdjacentOutput,
  CompetitiveOutput,
  ForecastOutput,
  MarketTrendsOutput,
  PricingOutput,
  PositioningOutput,
  WinLossOutput,
} from '@/lib/agents/types';

export type ChartType =
  | 'native'
  | 'bar'
  | 'horizontal-bar'
  | 'pie'
  | 'donut'
  | 'line'
  | 'area'
  | 'radar'
  | 'table';

export interface ChartPoint {
  name: string;
  value: number;
  color?: string;
  meta?: string;
}

export interface ChartSeries {
  label: string;
  points: ChartPoint[];
}

const DIRECTION_COLOR = {
  up: '#10b981',
  flat: '#94a3b8',
  down: '#ef4444',
} as const;

const RISK_COLOR = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#10b981',
} as const;

const STRENGTH_SCORE = {
  strong: 3,
  medium: 2,
  weak: 1,
  none: 0,
} as const;

const FREQUENCY_SCORE = {
  often: 3,
  sometimes: 2,
  rarely: 1,
} as const;

const QUANT_TYPES: ChartType[] = ['native', 'bar', 'horizontal-bar', 'pie', 'donut', 'line', 'radar', 'table'];
const FORECAST_TYPES: ChartType[] = ['native', 'bar', 'pie', 'donut', 'line', 'area', 'table'];
const GROUPED_TYPES: ChartType[] = ['native', 'bar', 'radar', 'table'];
const WINLOSS_TYPES: ChartType[] = ['native', 'bar', 'pie', 'table'];
const THREAT_TYPES: ChartType[] = ['native', 'bar', 'pie', 'donut', 'table'];
const TABLE_NATIVE: ChartType[] = ['native', 'table'];
const NATIVE_ONLY: ChartType[] = ['native'];

function parsePrice(price: string): number | null {
  const cleaned = price.replace(/,/g, '');
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

export function toChartSeries(output: AgentOutput): ChartSeries[] {
  switch (output.artifactType) {
    case 'trend-chart': {
      const o = output as MarketTrendsOutput;
      return [{
        label: 'Change %',
        points: (o.trends ?? []).map(t => ({
          name: t.keyword,
          value: Math.abs(t.changePercent || 5),
          color: DIRECTION_COLOR[t.direction] ?? DIRECTION_COLOR.flat,
          meta: t.signal,
        })),
      }];
    }
    case 'forecast-chart': {
      const o = output as ForecastOutput;
      return [{
        label: 'Swarm distribution',
        points: (o.distribution ?? []).map(b => ({
          name: b.label,
          value: b.count,
          meta: `${b.count} personas`,
        })),
      }];
    }
    case 'competitive-matrix': {
      const o = output as CompetitiveOutput;
      return [
        {
          label: 'Your product',
          points: (o.matrix ?? []).map(m => ({
            name: m.feature,
            value: STRENGTH_SCORE[m.yourProduct] ?? 0,
            meta: m.yourProduct,
          })),
        },
        {
          label: o.competitor || 'Competitor',
          points: (o.matrix ?? []).map(m => ({
            name: m.feature,
            value: STRENGTH_SCORE[m.competitor] ?? 0,
            meta: m.competitor,
          })),
        },
      ];
    }
    case 'win-loss-scorecard': {
      const o = output as WinLossOutput;
      return [
        {
          label: 'Competitor wins',
          points: (o.competitorWins ?? []).map(w => ({
            name: w.reason,
            value: FREQUENCY_SCORE[w.frequency] ?? 1,
            color: '#ef4444',
            meta: w.evidence,
          })),
        },
        {
          label: 'Competitor losses',
          points: (o.competitorLosses ?? []).map(w => ({
            name: w.reason,
            value: FREQUENCY_SCORE[w.frequency] ?? 1,
            color: '#10b981',
            meta: w.evidence,
          })),
        },
      ];
    }
    case 'threat-heatmap': {
      const o = output as AdjacentOutput;
      const threats = o.threats ?? [];
      const byRisk: ChartSeries = {
        label: 'Threats by risk',
        points: (['high', 'medium', 'low'] as const).map(level => ({
          name: level,
          value: threats.filter(t => t.riskLevel === level).length,
          color: RISK_COLOR[level],
        })).filter(p => p.value > 0),
      };
      const perThreat: ChartSeries = {
        label: 'Threat score',
        points: threats.map(t => ({
          name: t.company,
          value: t.riskLevel === 'high' ? 3 : t.riskLevel === 'medium' ? 2 : 1,
          color: RISK_COLOR[t.riskLevel],
          meta: t.threatVector,
        })),
      };
      return [byRisk, perThreat].filter(s => s.points.length > 0);
    }
    case 'pricing-table': {
      const o = output as PricingOutput;
      const tiers = o.competitorPricing ?? [];
      const points: ChartPoint[] = [];
      for (const t of tiers) {
        const value = parsePrice(t.price);
        if (value === null) continue;
        points.push({
          name: t.tierName,
          value,
          meta: `${t.price} · ${t.targetSegment}`,
        });
      }
      return points.length ? [{ label: 'Price', points }] : [];
    }
    case 'positioning-gap': {
      const o = output as PositioningOutput;
      return [{
        label: 'Gaps',
        points: (o.gaps ?? []).map((g, i) => ({
          name: g.dimension || `Gap ${i + 1}`,
          value: 1,
          meta: g.gap,
        })),
      }];
    }
    default:
      return [];
  }
}

export function supportedChartTypes(output: AgentOutput): ChartType[] {
  switch (output.artifactType) {
    case 'trend-chart':
      return QUANT_TYPES;
    case 'forecast-chart':
      return FORECAST_TYPES;
    case 'competitive-matrix':
      return GROUPED_TYPES;
    case 'win-loss-scorecard':
      return WINLOSS_TYPES;
    case 'threat-heatmap':
      return THREAT_TYPES;
    case 'pricing-table': {
      const o = output as PricingOutput;
      const tiers = o.competitorPricing ?? [];
      const allParseable = tiers.length > 0 && tiers.every(t => parsePrice(t.price) !== null);
      return allParseable ? ['native', 'bar', 'horizontal-bar', 'pie', 'donut', 'table'] : TABLE_NATIVE;
    }
    case 'positioning-gap':
      return TABLE_NATIVE;
    case 'mind-map':
    case 'execution-plan':
    case 'scorecard':
    default:
      return NATIVE_ONLY;
  }
}

/** Flatten first series (or merge names) into recharts-friendly rows for single-series charts. */
export function seriesToRows(series: ChartSeries[]): Array<Record<string, string | number>> {
  if (series.length === 0) return [];
  if (series.length === 1) {
    return series[0].points.map(p => ({
      name: p.name,
      value: p.value,
      ...(p.color ? { color: p.color } : {}),
    }));
  }

  const names = new Set<string>();
  for (const s of series) for (const p of s.points) names.add(p.name);

  return Array.from(names).map(name => {
    const row: Record<string, string | number> = { name };
    for (const s of series) {
      const point = s.points.find(p => p.name === name);
      row[s.label] = point?.value ?? 0;
    }
    return row;
  });
}

export const CHART_TYPE_LABELS: Record<ChartType, string> = {
  native: 'Native',
  bar: 'Bar',
  'horizontal-bar': 'H-Bar',
  pie: 'Pie',
  donut: 'Donut',
  line: 'Line',
  area: 'Area',
  radar: 'Radar',
  table: 'Table',
};

export const SERIES_COLORS = [
  '#0052FF',
  '#4D7CFF',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
];
