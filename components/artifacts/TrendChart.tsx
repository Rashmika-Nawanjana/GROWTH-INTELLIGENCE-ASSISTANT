'use client';

import React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { MarketTrendsOutput, TrendDataPoint } from '@/lib/agents/types';

interface TrendChartProps {
  output: MarketTrendsOutput;
}

const OUTLOOK_COLOR = {
  accelerating: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  consolidating: 'text-amber-700 bg-amber-50 border-amber-200',
  maturing: 'text-blue-600 bg-blue-50 border-blue-200',
  emerging: 'text-violet-600 bg-violet-50 border-violet-200',
};

const DIRECTION_COLOR = {
  up: '#10b981',
  flat: '#94a3b8',
  down: '#ef4444',
};

function CustomTooltip({ active, payload, label }: any) {
  if (active && payload && payload.length) {
    const d: TrendDataPoint = payload[0].payload;
    return (
      <div className="bg-card border border-border rounded-xl shadow-lg p-3 text-xs max-w-[220px]">
        <p className="font-mono font-medium text-foreground mb-1">{d.keyword}</p>
        <p className="text-muted-foreground leading-relaxed">{d.signal}</p>
        <p className="text-[10px] text-muted-foreground mt-1 font-mono">Source: {d.source}</p>
      </div>
    );
  }
  return null;
}

export function TrendChart({ output }: TrendChartProps) {
  const { trends, categoryOutlook, keySignals, timeHorizon } = output;

  const chartData = trends.map(t => ({
    ...t,
    displayValue: t.direction === 'down' ? -Math.abs(t.changePercent) : Math.abs(t.changePercent || 5),
    absValue: Math.abs(t.changePercent || 5),
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Market Trend Analysis</div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase tracking-wider ${OUTLOOK_COLOR[categoryOutlook] ?? OUTLOOK_COLOR.emerging}`}>
            {categoryOutlook}
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">{timeHorizon}</span>
        </div>
      </div>

      {/* Bar chart */}
      {chartData.length > 0 && (
        <div className="w-full" style={{ height: Math.max(160, chartData.length * 44) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
            >
              <XAxis
                type="number"
                hide
                domain={['dataMin - 5', 'dataMax + 5']}
              />
              <YAxis
                type="category"
                dataKey="keyword"
                width={110}
                tick={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fill: '#64748b' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,82,255,0.04)' }} />
              <Bar dataKey="absValue" radius={[0, 6, 6, 0]} maxBarSize={22}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={DIRECTION_COLOR[d.direction]} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-[10px] font-mono text-muted-foreground">
        {(['up', 'flat', 'down'] as const).map(dir => (
          <span key={dir} className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: DIRECTION_COLOR[dir] }} />
            {dir === 'up' ? 'Growing' : dir === 'flat' ? 'Stable' : 'Declining'}
          </span>
        ))}
      </div>

      {/* Key signals */}
      {keySignals.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">Key Signals</p>
          {keySignals.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-foreground">
              <span className="text-accent shrink-0 mt-0.5">›</span>
              <span className="leading-snug">{s}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
