'use client';

import React from 'react';
import { ExternalLink } from 'lucide-react';
import type {
  EntrantPlay,
  HistoricalMove,
  StealPlaybookOutput,
} from '@/lib/agents/types';

interface Props {
  output: StealPlaybookOutput;
}

const CONFIDENCE_CONFIG = {
  high: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-red-50 text-red-600 border-red-200',
};

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 30);
  }
}

/** Clickable source chips so every claim is traceable. */
function CitationChips({ urls }: { urls: string[] }) {
  if (!urls?.length) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {urls.map(url => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono px-2 py-1 rounded border border-accent/20 bg-accent/5 text-accent hover:bg-accent/10 transition-colors flex items-center gap-1.5"
        >
          {hostname(url)}
          <ExternalLink size={11} />
        </a>
      ))}
    </div>
  );
}

function MoveRow({ move }: { move: HistoricalMove }) {
  return (
    <li className="rounded-xl border border-border bg-muted/20 p-4 flex flex-col gap-1.5">
      <span className="text-base font-semibold text-foreground leading-snug">{move.move}</span>
      {move.context && (
        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          {move.context}
        </span>
      )}
      {move.effectOnRivals && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground">Effect on rivals: </span>
          {move.effectOnRivals}
        </p>
      )}
      <CitationChips urls={move.sourceUrls} />
    </li>
  );
}

function PlayRow({ play }: { play: EntrantPlay }) {
  return (
    <li className="rounded-xl border border-border bg-muted/20 p-4 flex flex-col gap-2">
      <span className="text-base font-semibold text-foreground leading-snug">{play.analogy}</span>
      {play.applicationToday && (
        <p className="text-sm text-muted-foreground leading-relaxed">{play.applicationToday}</p>
      )}
      {play.exampleTactics.length > 0 && (
        <ul className="flex flex-col gap-1.5 pt-0.5">
          {play.exampleTactics.map((tactic, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-foreground">
              <span className="text-accent shrink-0 mt-0.5">›</span>
              <span className="leading-snug">{tactic}</span>
            </li>
          ))}
        </ul>
      )}
      <CitationChips urls={play.sourceUrls} />
    </li>
  );
}

export function StealPlaybook({ output }: Props) {
  const moves = output.historicalCompetitiveMoves ?? [];
  const plays = output.modernEntrantPlaybook ?? [];
  const sources = output.sources ?? [];

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-mono text-muted-foreground uppercase tracking-wider">
          Steal Playbook — {output.company}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span
            className={`text-xs font-mono px-2.5 py-1 rounded border ${CONFIDENCE_CONFIG[output.confidence]}`}
          >
            {output.confidence} confidence
          </span>
          <span className="text-xs font-mono text-muted-foreground">
            {sources.length} source{sources.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {output.summary && (
        <p className="text-base text-foreground leading-relaxed">{output.summary}</p>
      )}

      {moves.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Historical competitive moves
          </div>
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {moves.map((m, i) => (
              <MoveRow key={i} move={m} />
            ))}
          </ul>
        </div>
      )}

      {plays.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Modern entrant playbook
          </div>
          <ul className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {plays.map((p, i) => (
              <PlayRow key={i} play={p} />
            ))}
          </ul>
        </div>
      )}

      {output.guardrails && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-col gap-1.5">
          <p className="text-xs font-mono uppercase text-amber-700 tracking-wider">
            Guardrails
          </p>
          <p className="text-sm text-amber-800 leading-relaxed">{output.guardrails}</p>
        </div>
      )}

      {sources.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
            Sources
          </div>
          <div className="flex flex-wrap gap-2">
            {sources.map((s, i) => (
              <a
                key={`${s.url}-${i}`}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono px-2 py-1 rounded border border-border bg-muted text-muted-foreground hover:text-accent hover:border-accent/30 transition-colors flex items-center gap-1.5"
                title={s.title}
              >
                [{i + 1}] {hostname(s.url)}
                <ExternalLink size={11} />
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
