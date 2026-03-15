'use client';

import React from 'react';
import type { AdjacentOutput, AdjacentThreat } from '@/lib/agents/types';

interface Props {
  output: AdjacentOutput;
}

const RISK_CONFIG = {
  high:   { label: 'High Risk',   row: 'border-red-200 bg-red-50/40',   badge: 'bg-red-100 text-red-700 border-red-200',   dot: 'bg-red-500'   },
  medium: { label: 'Medium Risk', row: 'border-amber-200 bg-amber-50/40', badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-400' },
  low:    { label: 'Low Risk',    row: 'border-border bg-muted/20',       badge: 'bg-muted text-muted-foreground border-border', dot: 'bg-slate-400' },
};

const OVERALL_RISK_CONFIG = {
  high:   'text-red-600 bg-red-50 border-red-200',
  medium: 'text-amber-700 bg-amber-50 border-amber-200',
  low:    'text-emerald-600 bg-emerald-50 border-emerald-200',
};

function ThreatCard({ threat }: { threat: AdjacentThreat }) {
  const cfg = RISK_CONFIG[threat.riskLevel];
  return (
    <div className={`rounded-xl border p-3 flex flex-col gap-2 ${cfg.row}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-foreground">{threat.company}</span>
          <span className="text-[10px] font-mono text-muted-foreground">{threat.category}</span>
        </div>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${cfg.badge}`}>
          {cfg.label}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">Vector: </span>{threat.threatVector}
      </p>
      {threat.evidence && (
        <p className="text-[11px] text-muted-foreground italic border-t border-border/50 pt-2 leading-relaxed">
          {threat.evidence}
        </p>
      )}
    </div>
  );
}

export function ThreatHeatmap({ output }: Props) {
  const { threats, overallRisk, timeToImpact, defensiveActions } = output;

  const grouped = {
    high:   threats.filter(t => t.riskLevel === 'high'),
    medium: threats.filter(t => t.riskLevel === 'medium'),
    low:    threats.filter(t => t.riskLevel === 'low'),
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Adjacent Threat Heatmap</div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${OVERALL_RISK_CONFIG[overallRisk]}`}>
            Overall: {overallRisk} risk
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">{timeToImpact}</span>
        </div>
      </div>

      {/* Threat cards grouped by risk */}
      {threats.length > 0 ? (
        <div className="flex flex-col gap-3">
          {(['high', 'medium', 'low'] as const).map(level =>
            grouped[level].length > 0 ? (
              <div key={level} className="flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  <div className={`w-2 h-2 rounded-full ${RISK_CONFIG[level].dot}`} />
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{RISK_CONFIG[level].label}</span>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {grouped[level].map((t, i) => (
                    <ThreatCard key={i} threat={t} />
                  ))}
                </div>
              </div>
            ) : null
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No specific threats identified in current signals.</p>
      )}

      {/* Defensive actions */}
      {defensiveActions.length > 0 && (
        <div className="rounded-xl border border-accent/20 bg-accent/5 p-3 flex flex-col gap-1.5">
          <p className="text-[10px] font-mono uppercase text-accent tracking-wider">Defensive Actions</p>
          {defensiveActions.map((a, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-foreground">
              <span className="text-accent shrink-0 mt-0.5">›</span>
              <span className="leading-snug">{a}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
