'use client';

import React from 'react';
import type { CompetitiveOutput, CompetitorFeature } from '@/lib/agents/types';

interface Props {
  output: CompetitiveOutput;
  product: string;
}

const STRENGTH_CONFIG = {
  strong:  { label: '●●●', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  medium:  { label: '●●○', color: 'text-amber-600',   bg: 'bg-amber-50'   },
  weak:    { label: '●○○', color: 'text-red-500',     bg: 'bg-red-50'     },
  none:    { label: '○○○', color: 'text-muted-foreground', bg: 'bg-muted'  },
};

const GAP_CONFIG = {
  advantage:    { label: '▲ Advantage',    class: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  parity:       { label: '= Parity',        class: 'text-muted-foreground bg-muted border-border'      },
  disadvantage: { label: '▼ Gap',           class: 'text-red-500 bg-red-50 border-red-200'             },
};

function StrengthDot({ level }: { level: CompetitorFeature['yourProduct'] }) {
  const cfg = STRENGTH_CONFIG[level];
  return (
    <span className={`text-[13px] font-mono ${cfg.color} ${cfg.bg} px-2 py-0.5 rounded tracking-widest`}>
      {cfg.label}
    </span>
  );
}

export function CompetitiveMatrix({ output, product }: Props) {
  const matrix = output.matrix ?? [];
  const competitor = output.competitor;
  const competitorSummary = output.competitorSummary;
  const hiringSignals = output.hiringSignals ?? [];
  const recentMoves = output.recentMoves ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Feature Comparison Matrix</div>

      {/* Competitor summary */}
      {competitorSummary && (
        <p className="text-sm text-muted-foreground leading-relaxed">{competitorSummary}</p>
      )}

      {/* Matrix table */}
      {matrix.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/60 border-b border-border">
                <th className="text-left px-4 py-2.5 text-xs font-mono text-muted-foreground uppercase tracking-wider w-[40%]">Feature</th>
                <th className="text-center px-3 py-2.5 text-xs font-mono text-accent uppercase tracking-wider w-[20%]">{product}</th>
                <th className="text-center px-3 py-2.5 text-xs font-mono text-muted-foreground uppercase tracking-wider w-[20%]">{competitor}</th>
                <th className="text-center px-3 py-2.5 text-xs font-mono text-muted-foreground uppercase tracking-wider w-[20%]">Gap</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row, i) => {
                const gapCfg = GAP_CONFIG[row.gapDirection];
                return (
                  <tr key={i} className={`border-b border-border/50 transition-colors hover:bg-muted/30 ${i % 2 === 0 ? '' : 'bg-muted/10'}`}>
                    <td className="px-4 py-2.5 text-foreground font-medium">{row.feature}</td>
                    <td className="px-3 py-2.5 text-center">
                      <StrengthDot level={row.yourProduct} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <StrengthDot level={row.competitor} />
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${gapCfg.class}`}>
                        {gapCfg.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Hiring + recent moves */}
      <div className="grid grid-cols-2 gap-3">
        {hiringSignals.length > 0 && (
          <div className="rounded-xl border border-border p-3 flex flex-col gap-1.5">
            <p className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">Hiring Signals</p>
            {hiringSignals.slice(0, 3).map((s, i) => (
              <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="text-amber-500 shrink-0">↑</span>{s}
              </p>
            ))}
          </div>
        )}
        {recentMoves.length > 0 && (
          <div className="rounded-xl border border-border p-3 flex flex-col gap-1.5">
            <p className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">Recent Moves</p>
            {recentMoves.slice(0, 3).map((s, i) => (
              <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="text-accent shrink-0">›</span>{s}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
