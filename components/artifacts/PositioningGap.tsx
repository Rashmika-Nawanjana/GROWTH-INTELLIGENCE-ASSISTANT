'use client';

import React from 'react';
import type { PositioningOutput } from '@/lib/agents/types';

interface Props {
  output: PositioningOutput;
  product: string;
  competitor: string;
}

export function PositioningGap({ output, product, competitor }: Props) {
  const { gaps, yourPositioning, competitorPositioning, adThemes } = output;
  const competitorLabel = competitor && competitor !== 'main competitor' ? competitor : 'Competitor';

  return (
    <div className="flex flex-col gap-4">
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
        Positioning Gap Analysis
        <span className="ml-2 text-[10px] font-semibold text-foreground bg-accent/10 border border-accent/20 px-2 py-0.5 rounded">{product}</span>
        <span className="mx-1 text-muted-foreground">vs</span>
        <span className="text-[10px] font-semibold text-foreground bg-muted border border-border px-2 py-0.5 rounded">{competitorLabel}</span>
      </div>

      {/* Side-by-side positioning */}
      {(yourPositioning || competitorPositioning) && (
        <div className="grid grid-cols-2 gap-3">
          {yourPositioning && (
            <div className="rounded-xl border border-accent/20 bg-accent/5 p-3">
              <p className="text-[10px] font-mono uppercase text-accent tracking-wider mb-1">{product}</p>
              <p className="text-xs text-foreground leading-relaxed">{yourPositioning}</p>
            </div>
          )}
          {competitorPositioning && (
            <div className="rounded-xl border border-border bg-muted/20 p-3">
              <p className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider mb-1">{competitorLabel}</p>
              <p className="text-xs text-foreground leading-relaxed">{competitorPositioning}</p>
            </div>
          )}
        </div>
      )}

      {/* Gap table */}
      {gaps.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">Messaging Gaps</p>
          {gaps.map((gap, i) => (
            <div key={i} className="rounded-xl border border-border p-3 flex flex-col gap-2">
              <span className="text-[10px] font-mono text-accent uppercase tracking-wider">{gap.dimension}</span>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground mb-0.5">{product}</p>
                  <p className="text-foreground leading-snug">{gap.yourMessage}</p>
                </div>
                <div>
                  <p className="text-muted-foreground mb-0.5">{competitorLabel}</p>
                  <p className="text-foreground leading-snug">{gap.competitorMessage}</p>
                </div>
              </div>
              {gap.opportunity && (
                <div className="flex items-start gap-1.5 pt-2 border-t border-border/50">
                  <span className="text-emerald-500 shrink-0 text-xs">→</span>
                  <p className="text-xs text-emerald-500 leading-snug">{gap.opportunity}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Ad themes */}
      {adThemes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider">Observed Ad Themes</p>
          <div className="flex flex-wrap gap-2">
            {adThemes.map((t, i) => (
              <span key={i} className="text-xs font-mono bg-muted text-muted-foreground border border-border px-2 py-1 rounded-full">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
