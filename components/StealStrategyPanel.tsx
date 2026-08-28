'use client';

import { useTheme } from '@/lib/theme-provider';
import { Check, Crosshair, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { StealPlaybook } from '@/components/artifacts/StealPlaybook';
import { AddToWorkspaceButton } from '@/components/workspace/AddToWorkspaceButton';
import type { AgentRun, StealPlaybookOutput } from '@/lib/agents/types';

export interface StealPanelState {
  company: string;
  market: string;
  newContext: string;
  runs: AgentRun[];
  output: StealPlaybookOutput | null;
  loading: boolean;
  error: string | null;
}

export const initialStealPanelState: StealPanelState = {
  company: '',
  market: '',
  newContext: '',
  runs: [],
  output: null,
  loading: false,
  error: null,
};

type StealStreamChunk =
  | { type: 'agent_update'; run: AgentRun }
  | { type: 'result'; output: StealPlaybookOutput }
  | { type: 'error'; message: string };

interface Props {
  state: StealPanelState;
  onChange: (patch: Partial<StealPanelState>) => void;
  savedKeys: Set<string>;
  onSaved: (key: string) => void;
}

/** Merge an incoming run into the list, replacing any prior entry for the same id. */
function mergeRun(runs: AgentRun[], incoming: AgentRun): AgentRun[] {
  const idx = runs.findIndex(r => r.agentId === incoming.agentId);
  if (idx === -1) return [...runs, incoming];
  const next = [...runs];
  next[idx] = { ...next[idx], ...incoming };
  return next;
}

function RunPill({ run }: { run: AgentRun }) {
  const done = run.status === 'completed';
  const failed = run.status === 'failed';
  return (
    <span
      className={`text-xs font-mono uppercase tracking-wider px-2.5 py-1.5 rounded border flex items-center gap-1.5 ${
        failed
          ? 'bg-red-50 text-red-600 border-red-200'
          : done
            ? 'bg-muted text-muted-foreground border-border'
            : 'bg-amber-50 text-amber-700 border-amber-200'
      }`}
    >
      {run.name}
      {done ? (
        <Check size={12} className="text-emerald-500" />
      ) : failed ? null : (
        <RefreshCw size={12} className="animate-spin" />
      )}
    </span>
  );
}

export function StealStrategyPanel({ state, onChange, savedKeys, onSaved }: Props) {
  const { isDark, surface, border, text, textMuted, textSubtle } = useTheme();
  const { company, market, newContext, runs, output, loading, error } = state;

  const run = async () => {
    if (!company.trim() || loading) return;
    onChange({ loading: true, error: null, output: null, runs: [] });

    let liveRuns: AgentRun[] = [];

    try {
      const res = await fetch('/api/steal-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: company.trim(),
          market: market.trim() || undefined,
          newCompanyContext: newContext.trim() || undefined,
        }),
      });

      // Guard rejections (auth / validation / quota) still return JSON.
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        onChange({
          loading: false,
          error: (j as { error?: string }).error ?? 'Request failed',
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          let chunk: StealStreamChunk;
          try {
            chunk = JSON.parse(line.slice(5).trim()) as StealStreamChunk;
          } catch {
            continue;
          }

          if (chunk.type === 'agent_update') {
            liveRuns = mergeRun(liveRuns, chunk.run);
            onChange({ runs: liveRuns });
          } else if (chunk.type === 'result') {
            onChange({ output: chunk.output });
          } else if (chunk.type === 'error') {
            onChange({ error: chunk.message });
          }
        }
      }
    } catch {
      onChange({ error: 'Network error' });
    } finally {
      onChange({ loading: false });
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full">
      <div>
        <h2 className="text-xl font-bold tracking-tight flex items-center gap-2" style={{ color: text }}>
          <Crosshair size={22} className="shrink-0" style={{ color: textSubtle }} />
          Steal strategy
        </h2>
        <p className="text-sm mt-1.5 leading-relaxed max-w-3xl" style={{ color: textMuted }}>
          Live-sourced case study: how a company historically competed against same-type rivals, and how a new entrant might apply those patterns ethically today. Every claim carries a source. Not legal advice; verify facts for your market.
        </p>
      </div>

      <div className="rounded-xl p-5 space-y-4" style={{ border: `1px solid ${border}`, background: surface }}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Company to analyse *</label>
            <input
              value={company}
              onChange={e => onChange({ company: e.target.value })}
              placeholder="e.g. Salesforce, Notion, Stripe"
              className="mt-1.5 w-full rounded-lg px-3.5 py-3 text-sm outline-none"
              style={{ border: `1px solid ${border}`, background: isDark ? '#0d0d0d' : '#fff', color: text }}
            />
          </div>
          <div>
            <label className="text-xs font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Market (optional)</label>
            <input
              value={market}
              onChange={e => onChange({ market: e.target.value })}
              placeholder="e.g. B2B CRM, headless CMS, fintech cards"
              className="mt-1.5 w-full rounded-lg px-3.5 py-3 text-sm outline-none"
              style={{ border: `1px solid ${border}`, background: isDark ? '#0d0d0d' : '#fff', color: text }}
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Your new company or angle (optional)</label>
          <input
            value={newContext}
            onChange={e => onChange({ newContext: e.target.value })}
            placeholder="e.g. 20-person PLG startup in Europe"
            className="mt-1.5 w-full rounded-lg px-3.5 py-3 text-sm outline-none"
            style={{ border: `1px solid ${border}`, background: isDark ? '#0d0d0d' : '#fff', color: text }}
          />
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading || !company.trim()}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-40"
          style={{ background: '#0070f3', color: '#fff' }}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {loading ? 'Researching…' : 'Generate'}
        </button>
      </div>

      {runs.length > 0 && (
        <div className="rounded-xl p-5 flex flex-col gap-3" style={{ border: `1px solid ${border}`, background: surface }}>
          <p className="text-xs font-mono uppercase tracking-widest" style={{ color: textSubtle }}>
            Agent progress
          </p>
          <div className="flex flex-wrap gap-2">
            {runs.map(r => (
              <RunPill key={r.agentId} run={r} />
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {output && (
        <div className="rounded-xl overflow-hidden w-full" style={{ border: `1px solid ${border}`, background: surface }}>
          <div
            className="flex items-center justify-between gap-2 px-5 py-3"
            style={{ borderBottom: `1px solid ${border}` }}
          >
            <span className="text-xs font-mono uppercase tracking-widest" style={{ color: textSubtle }}>
              Steal playbook
            </span>
            <AddToWorkspaceButton
              output={output}
              product={output.company}
              competitor={null}
              title={`Steal playbook · ${output.company}`}
              sessionId={null}
              messageId={`steal-${output.generatedAt}`}
              savedKeys={savedKeys}
              onSaved={onSaved}
            />
          </div>
          <div className="p-5 md:p-6">
            <StealPlaybook output={output} />
          </div>
        </div>
      )}
    </div>
  );
}
