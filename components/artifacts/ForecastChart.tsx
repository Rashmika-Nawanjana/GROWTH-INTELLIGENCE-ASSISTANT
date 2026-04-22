'use client';

import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Fish, ChevronDown, ChevronUp, Sparkles, Gauge } from 'lucide-react';
import type { ForecastOutput, ForecastSignal, DistributionBucket } from '@/lib/agents/types';
import { useTheme } from '@/lib/theme-provider';

interface ForecastChartProps {
  output: ForecastOutput;
  product: string;
}

function formatTimeHorizonBadge(raw: string): string {
  const value = (raw ?? '').trim();
  if (!value) return 'unknown';
  const parsedMs = Date.parse(value);
  if (!Number.isNaN(parsedMs)) {
    const d = new Date(parsedMs);
    const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (d.getTime() < Date.now()) return `Historical · ${formatted}`;
    return formatted;
  }
  return value;
}

// ── Confidence badge ──────────────────────────────────────────────────────────
function ConfidenceBadge({ level }: { level?: string }) {
  if (!level) return null;
  const styles: Record<string, { color: string; bg: string; border: string }> = {
    high:   { color: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)'  },
    medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)'  },
    low:    { color: '#6b7280', bg: 'rgba(107,114,128,0.12)', border: 'rgba(107,114,128,0.25)' },
  };
  const s = styles[level] ?? styles.low;
  return (
    <span
      className="text-[10px] font-mono font-medium uppercase tracking-wide px-2 py-0.5 rounded"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}
    >
      {level}
    </span>
  );
}

// ── Direction icon ────────────────────────────────────────────────────────────
function DirectionIcon({ direction }: { direction: 'up' | 'down' | 'flat' }) {
  if (direction === 'up')   return <TrendingUp  size={18} className="text-emerald-500" />;
  if (direction === 'down') return <TrendingDown size={18} className="text-red-500" />;
  return <Minus size={18} className="text-slate-400" />;
}

function directionColor(direction: 'up' | 'down' | 'flat'): string {
  if (direction === 'up')   return '#10b981';
  if (direction === 'down') return '#ef4444';
  return '#94a3b8';
}

// ── CI bar ────────────────────────────────────────────────────────────────────
function CIBar({ low, high, point, direction }: {
  low: number; high: number; point: number; direction: 'up' | 'down' | 'flat';
}) {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const lo = clamp(low);
  const hi = clamp(high);
  const pt = clamp(point);
  const accentColor = directionColor(direction);

  return (
    <div className="relative h-5 flex items-center" style={{ minWidth: 0 }}>
      {/* Background track */}
      <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 relative overflow-visible">
        {/* CI band */}
        <div
          className="absolute h-full rounded-full opacity-30"
          style={{
            left:  `${lo  * 100}%`,
            width: `${(hi - lo) * 100}%`,
            background: accentColor,
          }}
        />
        {/* CI left cap */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-[2px] h-4 rounded"
          style={{ left: `${lo * 100}%`, background: accentColor, opacity: 0.6 }}
        />
        {/* CI right cap */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-[2px] h-4 rounded"
          style={{ left: `${hi * 100}%`, background: accentColor, opacity: 0.6 }}
        />
        {/* Point estimate marker */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow"
          style={{ left: `${pt * 100}%`, transform: 'translate(-50%, -50%)', background: accentColor }}
        />
      </div>
      {/* Labels */}
      <span className="absolute -bottom-4 left-0 text-[9px] font-mono text-slate-400">0%</span>
      <span className="absolute -bottom-4 right-0 text-[9px] font-mono text-slate-400">100%</span>
    </div>
  );
}

// ── Distribution histogram ────────────────────────────────────────────────────
function DistributionHistogram({ buckets }: { buckets: DistributionBucket[] }) {
  if (!buckets?.length) return null;
  const maxCount = Math.max(...buckets.map(b => b.count), 1);

  const barColor = (label: string): string => {
    const l = label.toLowerCase();
    if (l.includes('strongly positive')) return '#059669';
    if (l.includes('positive'))          return '#10b981';
    if (l.includes('neutral'))           return '#94a3b8';
    if (l.includes('strongly negative')) return '#dc2626';
    if (l.includes('negative'))          return '#ef4444';
    return '#6366f1';
  };

  return (
    <div>
      <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-2">
        Swarm Distribution
      </div>
      <div className="flex items-end gap-1.5 h-14">
        {buckets.map((b, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div
              className="w-full rounded-t transition-all"
              style={{
                height: `${Math.max(4, (b.count / maxCount) * 48)}px`,
                background: barColor(b.label),
                opacity: 0.8,
              }}
            />
            <span className="text-[8px] font-mono text-slate-400 truncate w-full text-center">
              {b.count}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[9px] font-mono text-emerald-500">+ positive</span>
        <span className="text-[9px] font-mono text-red-500">negative −</span>
      </div>
    </div>
  );
}

// ── Contributing signals list ─────────────────────────────────────────────────
function ContributingSignals({ signals }: { signals: ForecastSignal[] }) {
  if (!signals?.length) return null;
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? signals : signals.slice(0, 3);

  return (
    <div>
      <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-2">
        Top Contributing Perspectives
      </div>
      <div className="flex flex-col gap-1.5">
        {visible.map((s, i) => {
          const isPositive = s.weight >= 0;
          const barWidth = `${Math.abs(s.weight) * 100}%`;
          return (
            <div key={i} className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-600 dark:text-slate-300 truncate flex-1">
                  › {s.persona}
                </span>
                <span
                  className="text-[10px] font-mono font-medium shrink-0"
                  style={{ color: isPositive ? '#10b981' : '#ef4444' }}
                >
                  {isPositive ? '+' : ''}{s.weight.toFixed(2)}
                </span>
              </div>
              {/* Weight bar */}
              <div className="h-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: barWidth,
                    background: isPositive ? '#10b981' : '#ef4444',
                    opacity: 0.6,
                  }}
                />
              </div>
              {s.excerpt && (
                <p className="text-[10px] text-slate-400 italic pl-2 break-words">
                  &ldquo;{s.excerpt}&rdquo;
                </p>
              )}
            </div>
          );
        })}
      </div>
      {signals.length > 3 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="mt-2 text-[10px] font-mono text-cyan-500 hover:text-cyan-400 flex items-center gap-1"
        >
          {expanded ? <><ChevronUp size={10} /> Show less</> : <><ChevronDown size={10} /> Show {signals.length - 3} more</>}
        </button>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function ForecastChart({ output, product }: ForecastChartProps) {
  const { border: borderC, surface: cardBg, text: textMain, textMuted, textSubtle } = useTheme();

  const {
    question, pointEstimate, unit, confidenceLow, confidenceHigh,
    direction, swarmSize, timeHorizon, distribution, contributingSignals,
    rationale, confidence, facts = [], interpretation = [],
  } = output;
  const timeHorizonLabel = formatTimeHorizonBadge(timeHorizon);

  const accentColor = '#06b6d4';   // cyan-500 — MiroFish brand color
  const accentBg    = 'rgba(6,182,212,0.08)';
  const accentBorder = 'rgba(6,182,212,0.3)';

  const pct = Math.round(pointEstimate * 100);
  const ciLoPct = Math.round(confidenceLow  * 100);
  const ciHiPct = Math.round(confidenceHigh * 100);

  const unitLabel = unit === 'probability' ? '%' : unit === 'percent' ? '%' : '';
  const positiveBuckets = distribution.filter(b => /positive/i.test(b.label)).reduce((s, b) => s + b.count, 0);
  const negativeBuckets = distribution.filter(b => /negative/i.test(b.label)).reduce((s, b) => s + b.count, 0);
  const neutralBuckets = distribution.filter(b => /neutral/i.test(b.label)).reduce((s, b) => s + b.count, 0);
  const topSignal = contributingSignals?.[0];

  return (
    <div
      className="veracity-card p-6 lg:p-7 flex flex-col gap-5 w-full text-[15px]"
      style={{ background: cardBg, border: `1px solid ${accentBorder}`, boxShadow: `0 0 0 1px ${accentColor}1a` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: accentColor }}><Fish size={16} /></span>
          <div className="min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-wider mb-0.5" style={{ color: accentColor }}>
              MiroFish · Swarm Forecast
            </div>
            <div className="font-semibold text-[16px] leading-snug" style={{ color: textMain }}>
              {question}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: textMuted, background: accentBg, border: `1px solid ${accentBorder}` }}>
            {timeHorizonLabel}
          </span>
          <ConfidenceBadge level={confidence} />
        </div>
      </div>

      {/* Headline metrics */}
      <div
        className="rounded-xl p-5 flex items-center gap-6"
        style={{ background: accentBg, border: `1px solid ${accentBorder}` }}
      >
        {/* Direction + point estimate */}
        <div className="flex items-center gap-3">
          <DirectionIcon direction={direction} />
          <div>
            <div
              className="text-4xl font-mono font-bold leading-none"
              style={{ color: directionColor(direction) }}
            >
              {pct}{unitLabel}
            </div>
            <div className="text-[10px] font-mono mt-0.5" style={{ color: textSubtle }}>
              point estimate
            </div>
          </div>
        </div>

        {/* Confidence interval */}
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-mono mb-3" style={{ color: textMuted }}>
            90% confidence interval: {ciLoPct}% – {ciHiPct}%
          </div>
          <CIBar
            low={confidenceLow}
            high={confidenceHigh}
            point={pointEstimate}
            direction={direction}
          />
        </div>

        {/* Swarm size */}
        <div className="text-center shrink-0">
          <div className="text-xl font-mono font-bold" style={{ color: accentColor }}>
            {swarmSize.toLocaleString()}
          </div>
          <div className="text-[10px] font-mono" style={{ color: textSubtle }}>
            simulated<br />personas
          </div>
        </div>
      </div>

      {/* Quick insight cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="rounded-xl p-4" style={{ border: `1px solid ${borderC}`, background: cardBg }}>
          <div className="flex items-center gap-2 mb-1">
            <Gauge size={14} style={{ color: accentColor }} />
            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: textSubtle }}>Forecast Strength</span>
          </div>
          <p className="text-[18px] font-semibold" style={{ color: textMain }}>
            {direction === 'up' ? 'Bullish' : direction === 'down' ? 'Bearish' : 'Neutral'}
          </p>
          <p className="text-[12px]" style={{ color: textMuted }}>
            {ciLoPct}% to {ciHiPct}% confidence band
          </p>
        </div>
        <div className="rounded-xl p-4" style={{ border: `1px solid ${borderC}`, background: cardBg }}>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={14} style={{ color: '#10b981' }} />
            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: textSubtle }}>Swarm Tilt</span>
          </div>
          <p className="text-[18px] font-semibold" style={{ color: textMain }}>
            +{positiveBuckets} / -{negativeBuckets}
          </p>
          <p className="text-[12px]" style={{ color: textMuted }}>
            {neutralBuckets} neutral personas
          </p>
        </div>
        <div className="rounded-xl p-4" style={{ border: `1px solid ${borderC}`, background: cardBg }}>
          <div className="flex items-center gap-2 mb-1">
            <Fish size={14} style={{ color: accentColor }} />
            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: textSubtle }}>Top Driver</span>
          </div>
          <p className="text-[14px] font-semibold line-clamp-1" style={{ color: textMain }}>
            {topSignal?.persona ?? 'No dominant persona'}
          </p>
          <p className="text-[12px]" style={{ color: textMuted }}>
            Weight {topSignal ? `${topSignal.weight >= 0 ? '+' : ''}${topSignal.weight.toFixed(2)}` : 'n/a'}
          </p>
        </div>
      </div>

      {/* Distribution histogram */}
      {distribution?.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: cardBg, border: `1px solid ${borderC}` }}>
          <DistributionHistogram buckets={distribution} />
        </div>
      )}

      {/* Contributing signals */}
      {contributingSignals?.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: cardBg, border: `1px solid ${borderC}` }}>
          <ContributingSignals signals={contributingSignals} />
        </div>
      )}

      {/* Main key points */}
      {(interpretation.length > 0 || facts.length > 0) && (
        <div className="rounded-xl p-5" style={{ background: accentBg, border: `1px solid ${accentBorder}` }}>
          <div className="text-[10px] font-mono uppercase tracking-wider mb-3" style={{ color: accentColor }}>
            Key Points
          </div>
          <ul className="flex flex-col gap-2">
            {[...interpretation, ...facts].slice(0, 4).map((item, i) => (
              <li key={i} className="text-[14px] leading-relaxed flex items-start gap-2" style={{ color: textMain }}>
                <span style={{ color: accentColor }}>•</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Rationale */}
      {rationale && (
        <div className="rounded-xl p-4" style={{ background: cardBg, border: `1px solid ${borderC}` }}>
          <div className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: textMuted }}>
            Rationale
          </div>
          <p className="text-[14px] leading-relaxed" style={{ color: textMain }}>
            {rationale}
          </p>
        </div>
      )}

      {/* Facts + interpretation */}
      {(facts.length > 0 || interpretation.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {facts.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: cardBg, border: `1px solid ${borderC}` }}>
              <div className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: textMuted }}>
                Swarm Findings
              </div>
              <ul className="flex flex-col gap-1">
                {facts.map((f, i) => (
                  <li key={i} className="text-[13px] flex gap-1.5" style={{ color: textMain }}>
                    <span style={{ color: accentColor }}>›</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {interpretation.length > 0 && (
            <div className="rounded-xl p-4" style={{ background: cardBg, border: `1px solid ${borderC}` }}>
              <div className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: textMuted }}>
                Analyst Synthesis
              </div>
              <ul className="flex flex-col gap-1">
                {interpretation.map((s, i) => (
                  <li key={i} className="text-[13px] flex gap-1.5" style={{ color: textMain }}>
                    <span style={{ color: accentColor }}>›</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Footer — swarm size + product */}
      <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: borderC }}>
        <span className="text-[10px] font-mono" style={{ color: textSubtle }}>
          MiroFish swarm simulation · {product}
        </span>
        <span className="text-[10px] font-mono flex items-center gap-1" style={{ color: accentColor }}>
          <Fish size={9} /> {swarmSize} personas polled
        </span>
      </div>
    </div>
  );
}
