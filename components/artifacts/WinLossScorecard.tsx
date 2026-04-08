'use client';

import React from 'react';
import type { WinLossOutput, WinReason } from '@/lib/agents/types';

interface Props {
  output: WinLossOutput;
  competitor: string;
  product: string;
}

const FREQ_CONFIG = {
  often:     { width: '90%', color: 'bg-accent',      label: 'Often'     },
  sometimes: { width: '55%', color: 'bg-amber-400',   label: 'Sometimes' },
  rarely:    { width: '25%', color: 'bg-slate-300',   label: 'Rarely'    },
};

const SENTIMENT_CONFIG = {
  positive: { label: 'Positive Sentiment', class: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  mixed:    { label: 'Mixed Sentiment',    class: 'text-amber-700 bg-amber-50 border-amber-200'       },
  negative: { label: 'Negative Sentiment', class: 'text-red-600 bg-red-50 border-red-200'             },
};

function ReasonRow({ reason, type }: { reason: WinReason; type: 'win' | 'loss' }) {
  const freq = FREQ_CONFIG[reason.frequency];
  return (
    <div className="flex flex-col gap-1.5 py-2.5 border-b border-border/40 last:border-0">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-foreground font-medium leading-snug flex-1">{reason.reason}</span>
        <span className="text-[10px] font-mono text-muted-foreground shrink-0">{freq.label}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${freq.color} ${type === 'loss' ? 'opacity-70' : ''}`}
          style={{ width: freq.width }}
        />
      </div>
      {reason.evidence && (
        <p className="text-xs text-muted-foreground italic leading-relaxed">"{reason.evidence}"</p>
      )}
    </div>
  );
}

export function WinLossScorecard({ output, competitor, product }: Props) {
  const competitorWins = output.competitorWins ?? [];
  const competitorLosses = output.competitorLosses ?? [];
  const buyerSentiment = output.buyerSentiment;
  const topSwitchTriggers = output.topSwitchTriggers ?? [];
  const sentCfg = SENTIMENT_CONFIG[buyerSentiment] ?? SENTIMENT_CONFIG.mixed;
  const competitorLabel = competitor && competitor !== 'main competitor' ? competitor : 'Competitor';
  const productLabel = product || 'Us';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Win / Loss Analysis</div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono font-semibold text-foreground uppercase tracking-wider px-2 py-0.5 rounded bg-accent/10 border border-accent/20">{competitorLabel}</span>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${sentCfg.class}`}>
            {sentCfg.label}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Competitor wins (where competitor beats you) */}
        {competitorWins.length > 0 && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 flex flex-col gap-0.5">
            <p className="text-[10px] font-mono uppercase text-red-500 tracking-wider mb-1">Where <span className="font-bold">{competitorLabel}</span> wins</p>
            {competitorWins.slice(0, 4).map((r, i) => (
              <ReasonRow key={i} reason={r} type="loss" />
            ))}
          </div>
        )}

        {/* Competitor losses (where competitor loses to you) */}
        {competitorLosses.length > 0 && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex flex-col gap-0.5">
            <p className="text-[10px] font-mono uppercase text-emerald-600 tracking-wider mb-1">Where <span className="font-bold">{productLabel}</span> wins</p>
            {competitorLosses.slice(0, 4).map((r, i) => (
              <ReasonRow key={i} reason={r} type="win" />
            ))}
          </div>
        )}
      </div>

      {/* Switch triggers */}
      {topSwitchTriggers.length > 0 && (
        <div className="rounded-xl border border-border p-3 flex flex-col gap-1.5">
          <p className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">Top Switch Triggers</p>
          <div className="flex flex-wrap gap-2 mt-1">
            {topSwitchTriggers.map((t, i) => (
              <span key={i} className="text-xs font-mono bg-accent/5 text-accent border border-accent/20 px-2 py-1 rounded-full">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
