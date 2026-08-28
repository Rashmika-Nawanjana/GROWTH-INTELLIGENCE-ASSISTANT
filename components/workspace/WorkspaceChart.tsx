'use client';

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, LineChart, Line, AreaChart, Area,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Legend,
} from 'recharts';
import { useTheme } from '@/lib/theme-provider';
import {
  type ChartSeries,
  type ChartType,
  seriesToRows,
  SERIES_COLORS,
} from '@/lib/workspace/chart-adapters';

interface Props {
  series: ChartSeries[];
  chartType: ChartType;
  height?: number;
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: Record<string, unknown> }>;
  label?: string;
}) {
  const { surface, border, text, textMuted } = useTheme();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl p-3 text-xs max-w-[220px] shadow-lg" style={{ background: surface, border: `1px solid ${border}` }}>
      <p className="font-mono font-medium mb-1" style={{ color: text }}>{label ?? payload[0]?.name}</p>
      {payload.map((entry, i) => (
        <p key={i} className="font-mono" style={{ color: textMuted }}>
          {entry.name ? `${entry.name}: ` : ''}{entry.value}
        </p>
      ))}
    </div>
  );
}

export function WorkspaceChart({ series, chartType, height = 240 }: Props) {
  const { textMuted, border, text } = useTheme();
  const rows = seriesToRows(series);
  const single = series.length <= 1;
  const primary = series[0];

  if (chartType === 'table') {
    return (
      <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${border}` }}>
        <table className="w-full text-left text-xs font-mono">
          <thead>
            <tr style={{ borderBottom: `1px solid ${border}` }}>
              <th className="px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: textMuted }}>Name</th>
              {series.map(s => (
                <th key={s.label} className="px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: textMuted }}>
                  {s.label}
                </th>
              ))}
              {single && primary?.points.some(p => p.meta) ? (
                <th className="px-3 py-2 font-semibold uppercase tracking-wider" style={{ color: textMuted }}>Detail</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {single
              ? (primary?.points ?? []).map((p, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${border}` }}>
                    <td className="px-3 py-2" style={{ color: text }}>{p.name}</td>
                    <td className="px-3 py-2" style={{ color: text }}>{p.value}</td>
                    {primary.points.some(x => x.meta) ? (
                      <td className="px-3 py-2 max-w-[240px] truncate" style={{ color: textMuted }} title={p.meta}>
                        {p.meta ?? ''}
                      </td>
                    ) : null}
                  </tr>
                ))
              : rows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${border}` }}>
                    <td className="px-3 py-2" style={{ color: text }}>{row.name}</td>
                    {series.map(s => (
                      <td key={s.label} className="px-3 py-2" style={{ color: text }}>{row[s.label]}</td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <p className="text-sm font-mono" style={{ color: textMuted }}>
        No quantitative data to chart for this view.
      </p>
    );
  }

  const tick = { fontSize: 11, fontFamily: 'JetBrains Mono, monospace', fill: textMuted };

  if (chartType === 'pie' || chartType === 'donut') {
    // Always use palette index colors so adjacent slices stay visually distinct
    // (direction/risk colors often collide when multiple points share the same status).
    const pieData = (primary?.points ?? []).map((p, i) => ({
      name: p.name,
      value: p.value,
      fill: SERIES_COLORS[i % SERIES_COLORS.length],
    }));
    return (
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={pieData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={chartType === 'donut' ? 50 : 0}
              outerRadius={80}
              paddingAngle={2}
            >
              {pieData.map((d, i) => (
                <Cell key={i} fill={d.fill} fillOpacity={0.9} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (chartType === 'radar') {
    return (
      <div style={{ height: Math.max(height, 280) }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={rows}>
            <PolarGrid stroke={border} />
            <PolarAngleAxis dataKey="name" tick={tick} />
            <PolarRadiusAxis tick={tick} />
            {single ? (
              <Radar dataKey="value" stroke={SERIES_COLORS[0]} fill={SERIES_COLORS[0]} fillOpacity={0.25} />
            ) : (
              series.map((s, i) => (
                <Radar
                  key={s.label}
                  dataKey={s.label}
                  stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                  fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                  fillOpacity={0.2}
                />
              ))
            )}
            <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }} />
            <Tooltip content={<CustomTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    );
  }

  if (chartType === 'line' || chartType === 'area') {
    const sharedAxes = (
      <>
        <XAxis dataKey="name" tick={tick} axisLine={false} tickLine={false} />
        <YAxis tick={tick} axisLine={false} tickLine={false} width={36} />
        <Tooltip content={<CustomTooltip />} />
      </>
    );

    const seriesNodes = single ? (
      chartType === 'area' ? (
        <Area type="monotone" dataKey="value" stroke={SERIES_COLORS[0]} fill={SERIES_COLORS[0]} fillOpacity={0.2} />
      ) : (
        <Line type="monotone" dataKey="value" stroke={SERIES_COLORS[0]} strokeWidth={2} dot={{ r: 4 }} />
      )
    ) : (
      <>
        {series.map((s, i) =>
          chartType === 'area' ? (
            <Area
              key={s.label}
              type="monotone"
              dataKey={s.label}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              fill={SERIES_COLORS[i % SERIES_COLORS.length]}
              fillOpacity={0.15}
            />
          ) : (
            <Line
              key={s.label}
              type="monotone"
              dataKey={s.label}
              stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          ),
        )}
        <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }} />
      </>
    );

    return (
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'area' ? (
            <AreaChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              {sharedAxes}
              {seriesNodes}
            </AreaChart>
          ) : (
            <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              {sharedAxes}
              {seriesNodes}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    );
  }

  // bar | horizontal-bar
  const horizontal = chartType === 'horizontal-bar';
  const barHeight = horizontal ? Math.max(height, rows.length * 36) : height;

  return (
    <div style={{ height: barHeight }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout={horizontal ? 'vertical' : 'horizontal'}
          margin={{ top: 8, right: 12, left: horizontal ? 8 : 0, bottom: 4 }}
        >
          {horizontal ? (
            <>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={100} tick={tick} axisLine={false} tickLine={false} />
            </>
          ) : (
            <>
              <XAxis dataKey="name" tick={tick} axisLine={false} tickLine={false} />
              <YAxis tick={tick} axisLine={false} tickLine={false} width={36} />
            </>
          )}
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,82,255,0.04)' }} />
          {single ? (
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={28}>
              {(primary?.points ?? []).map((_, i) => (
                <Cell key={i} fill={SERIES_COLORS[i % SERIES_COLORS.length]} fillOpacity={0.9} />
              ))}
            </Bar>
          ) : (
            series.map((s, i) => (
              <Bar
                key={s.label}
                dataKey={s.label}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                fillOpacity={0.85}
                radius={[4, 4, 0, 0]}
                maxBarSize={22}
              />
            ))
          )}
          {!single && <Legend wrapperStyle={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
