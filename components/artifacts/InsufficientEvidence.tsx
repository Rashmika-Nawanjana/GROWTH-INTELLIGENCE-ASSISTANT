'use client';

import React from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import type { AgentOutput, EvidenceCandidate } from '@/lib/agents/types';

const DOMAIN_LABELS: Record<string, string> = {
  'market-trends': 'Market & Trend Sensing',
  competitive: 'Competitive Landscape',
  'win-loss': 'Win / Loss Intelligence',
  pricing: 'Pricing & Packaging',
  positioning: 'Positioning & Messaging',
  adjacent: 'Adjacent Market Collision',
};

const CLASS_STYLES: Record<string, string> = {
  direct: 'bg-accent/5 text-accent border-accent/20',
  adjacent: 'bg-amber-50 text-amber-700 border-amber-200',
  potential: 'bg-muted text-muted-foreground border-border',
  government: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  research: 'bg-muted text-muted-foreground border-border',
  global: 'bg-muted text-muted-foreground border-border',
};

interface Props {
  output: AgentOutput;
}

export function InsufficientEvidence({ output }: Props) {
  const label = DOMAIN_LABELS[output.domain] ?? output.domain;
  const evidence = output.evidence;
  const searched = evidence?.searchedFor?.slice(0, 6) ?? [];
  const gaps = evidence?.gaps ?? [];
  const candidates = evidence?.candidates ?? [];

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="veracity-card p-5 flex flex-col gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
            <AlertTriangle size={10} />
            Insufficient evidence
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {evidence?.relevantSourceCount ?? 0} relevant source
            {(evidence?.relevantSourceCount ?? 0) === 1 ? '' : 's'}
          </span>
        </div>

        {gaps.length > 0 ? (
          <div>
            <div className="text-xs font-mono text-muted-foreground mb-2 uppercase tracking-wider">
              Gaps
            </div>
            <ul className="flex flex-col gap-1.5">
              {gaps.map((g, i) => (
                <li key={i} className="text-sm text-foreground leading-snug flex gap-2">
                  <span className="text-amber-600 shrink-0">›</span>
                  {g}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {searched.length > 0 ? (
          <div>
            <div className="text-xs font-mono text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1.5">
              <Search size={10} />
              Searched
            </div>
            <ul className="flex flex-col gap-1">
              {searched.map((q, i) => (
                <li
                  key={i}
                  className="text-[11px] font-mono text-muted-foreground bg-muted/50 rounded-lg px-2.5 py-1.5 border border-border truncate"
                  title={q}
                >
                  {q}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {candidates.length > 0 ? (
          <div>
            <div className="text-xs font-mono text-muted-foreground mb-2 uppercase tracking-wider">
              Candidates (unverified)
            </div>
            <div className="flex flex-wrap gap-1.5">
              {candidates.map((c: EvidenceCandidate) => (
                <span
                  key={c.name}
                  className={`text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border ${CLASS_STYLES[c.classification] ?? CLASS_STYLES.potential}`}
                  title={c.url}
                >
                  {c.name}
                  <span className="opacity-60 ml-1 normal-case tracking-normal">
                    · {c.classification}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <p className="text-[11px] text-muted-foreground leading-snug border-t border-border pt-3">
          Recommended next research: local company registries, government digital agriculture
          programs, university projects, and named entities from the query — not global SaaS listicles.
        </p>
      </div>
    </div>
  );
}
