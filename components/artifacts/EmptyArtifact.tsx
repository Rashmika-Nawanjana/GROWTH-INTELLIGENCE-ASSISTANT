'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  /** Short label of the artifact (e.g. "Market Trend Analysis") */
  label: string;
  /** Optional one-line reason — usually "Agent returned no signal." */
  reason?: string;
}

/**
 * Inline fallback rendered when an artifact has no usable data.
 *
 * Goals:
 *  - Never crash or render an empty panel.
 *  - Make it obvious that an agent ran but did not return enough signal,
 *    so the user can re-ask or pivot.
 *  - Match the design system (`.veracity-card`-style surface, mono labels).
 */
export function EmptyArtifact({ label, reason }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 flex items-start gap-2.5">
        <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
        <div className="flex flex-col gap-0.5">
          <p className="text-xs text-muted-foreground leading-snug">
            {reason ?? 'Agent returned no usable signal for this view.'}
          </p>
          <p className="text-[10px] font-mono text-muted-foreground/70">
            Try a more specific query or rerun to refresh signals.
          </p>
        </div>
      </div>
    </div>
  );
}
