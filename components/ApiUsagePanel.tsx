'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTheme } from '@/lib/theme-provider';
import type { RunMetrics } from '@/lib/agents/types';

/** Mirrors chat stream `liveMetrics` in page.tsx. */
type LiveStreamMetrics = {
  elapsedMs: number;
  agentCount: number;
  completedAgentCount: number;
  failedAgentCount: number;
  runningAgentCount: number;
  estimatedCostUsd: number;
  geminiCallCount: number;
  toolCallCount: number;
};

type UsageInfo = {
  models: { text: string; embedding: string; embeddingDimensions: number };
  providers: { id: string; label: string; kind: string; configured: boolean; usageNote: string }[];
};

type SessionUsage = {
  queries: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  totalGeminiCalls: number;
  totalToolCalls: number;
};

export function ApiUsagePanel({
  lastMetrics,
  lastLive,
  sessionTotals,
}: {
  lastMetrics?: RunMetrics;
  lastLive?: LiveStreamMetrics;
  sessionTotals: SessionUsage;
}) {
  const { isDark, surface, border, text, textMuted, textSubtle } = useTheme();
  const [info, setInfo] = useState<UsageInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await fetch('/api/usage-info');
      if (!res.ok) {
        setErr(res.status === 401 ? 'Sign in to see usage details.' : 'Could not load usage info.');
        return;
      }
      setInfo(await res.json() as UsageInfo);
    } catch {
      setErr('Network error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const latencyMs = lastMetrics?.totalLatencyMs ?? lastLive?.elapsedMs;
  const cost = lastMetrics?.estimatedCostUsd ?? lastLive?.estimatedCostUsd;
  const geminiCalls = lastMetrics?.geminiCallCount ?? lastLive?.geminiCallCount;
  const toolCalls = lastMetrics?.toolCallCount ?? lastLive?.toolCallCount;
  const agentN = lastMetrics?.agentCount ?? lastLive?.agentCount;
  const doneN = lastMetrics?.completedAgentCount ?? lastLive?.completedAgentCount;

  return (
    <div className="flex flex-col gap-6 max-w-3xl w-full">
      <div>
        <h2 className="text-lg font-bold tracking-tight" style={{ color: text }}>API and model usage</h2>
        <p className="text-[13px] mt-1" style={{ color: textMuted }}>
          In-app numbers are estimated from the last intelligence run and your session. Provider dashboards are authoritative for billing.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl p-4" style={{ border: `1px solid ${border}`, background: surface }}>
          <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Last run (authoritative when finished)</p>
          {lastMetrics || lastLive ? (
            <ul className="mt-2 text-[12px] font-mono space-y-1" style={{ color: textMuted }}>
              {latencyMs != null && <li>Latency: {(latencyMs / 1000).toFixed(1)}s</li>}
              {cost != null && <li>Est. model cost: ${Number(cost).toFixed(4)}</li>}
              {geminiCalls != null && <li>Model calls (est.): {geminiCalls}</li>}
              {toolCalls != null && <li>Tool invocations (est.): {toolCalls}</li>}
              {agentN != null && <li>Agents: {doneN ?? '—'}/{agentN}</li>}
            </ul>
          ) : (
            <p className="mt-2 text-[12px]" style={{ color: textMuted }}>Run a query on the Intelligence tab to populate metrics.</p>
          )}
        </div>
        <div className="rounded-xl p-4" style={{ border: `1px solid ${border}`, background: surface }}>
          <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Session (this tab session)</p>
          <ul className="mt-2 text-[12px] font-mono space-y-1" style={{ color: textMuted }}>
            <li>Queries with metrics: {sessionTotals.queries}</li>
            <li>Sum est. cost: ${sessionTotals.totalCostUsd.toFixed(4)}</li>
            <li>Sum latency: {(sessionTotals.totalLatencyMs / 1000).toFixed(1)}s</li>
            <li>Sum model calls (est.): {sessionTotals.totalGeminiCalls}</li>
            <li>Sum tool calls (est.): {sessionTotals.totalToolCalls}</li>
          </ul>
        </div>
      </div>

      {err && <p className="text-[12px] text-amber-600">{err}</p>}

      {info && (
        <div className="space-y-4">
          <div className="rounded-xl p-4" style={{ border: `1px solid ${border}`, background: surface }}>
            <p className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: textSubtle }}>Configured models (env)</p>
            <p className="text-[12px] font-mono" style={{ color: textMuted }}>
              Text: {info.models.text} · Embeddings: {info.models.embedding} ({info.models.embeddingDimensions}d)
            </p>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${border}`, background: surface }}>
            <div className="px-3 py-2" style={{ borderBottom: `1px solid ${border}` }}>
              <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Integrations</p>
            </div>
            <ul className="divide-y" style={{ borderColor: border }}>
              {info.providers.map(p => (
                <li key={p.id} className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1">
                  <div>
                    <span className="text-[12px] font-medium" style={{ color: text }}>{p.label}</span>
                    <span className="ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: p.configured ? '#10b981' : textMuted, background: p.configured ? 'rgba(16,185,129,0.1)' : 'rgba(100,100,100,0.1)' }}>{p.configured ? 'configured' : 'not set'}</span>
                    <p className="text-[11px] mt-0.5" style={{ color: textMuted }}>{p.usageNote}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
