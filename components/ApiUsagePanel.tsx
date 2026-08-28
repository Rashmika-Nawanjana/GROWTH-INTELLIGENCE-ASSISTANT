'use client';

import { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useTheme } from '@/lib/theme-provider';
import type { RunMetrics } from '@/lib/agents/types';
import type { UsageStage } from '@/lib/observability/types';

type LiveStreamMetrics = {
  elapsedMs: number;
  agentCount: number;
  completedAgentCount: number;
  failedAgentCount: number;
  runningAgentCount: number;
  estimatedCostUsd: number;
  geminiCallCount: number;
  toolCallCount: number;
  inputTokens?: number;
  outputTokens?: number;
};

type UsageInfo = {
  models: { text: string; embedding: string; embeddingDimensions: number };
  pricing?: { llmInputPerM: number; llmOutputPerM: number; embedPerM: number; defaultModel: string };
  langfuse?: { enabled: boolean; baseUrl: string };
  providers: { id: string; label: string; kind: string; configured: boolean; usageNote: string }[];
};

type SessionUsage = {
  queries: number;
  totalCostUsd: number;
  totalLatencyMs: number;
  totalGeminiCalls: number;
  totalToolCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEmbeddingCalls: number;
};

type RecentRun = {
  id: string;
  query_preview: string | null;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  cost_basis: string;
  trace_url: string | null;
  created_at: string;
};

const STAGE_LABELS: Record<UsageStage, string> = {
  classify: 'Classify',
  'research-plan': 'Research plan',
  agent: 'Domain agents',
  execution: 'Execution engine',
  synthesis: 'Synthesis',
  'mind-map': 'Mind map',
  mirofish: 'MiroFish',
  'mirofish-live': 'MiroFish Live',
  'workspace-explain': 'Workspace Ask AI',
  refine: 'Refine',
  'steal-strategy': 'Steal strategy',
  'embed-api': 'Embed API',
};

function formatUsd(n: number): string {
  return `$${Number(n).toFixed(4)}`;
}

function StatusChip({ status, count }: { status: 'ok' | 'degraded' | 'failed'; count: number }) {
  if (!count) return null;
  const styles = {
    ok: 'bg-emerald-50 text-emerald-600 border-emerald-200',
    degraded: 'bg-amber-50 text-amber-700 border-amber-200',
    failed: 'bg-red-50 text-red-600 border-red-200',
  };
  return (
    <span className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${styles[status]}`}>
      {status} {count}
    </span>
  );
}

export function ApiUsagePanel({
  lastMetrics,
  lastLive,
  sessionTotals,
}: {
  lastMetrics?: RunMetrics;
  lastLive?: LiveStreamMetrics;
  sessionTotals: SessionUsage;
}) {
  const { surface, border, text, textMuted, textSubtle } = useTheme();
  const [info, setInfo] = useState<UsageInfo | null>(null);
  const [recentRuns, setRecentRuns] = useState<RecentRun[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [infoRes, metricsRes] = await Promise.all([
        fetch('/api/usage-info'),
        fetch('/api/usage-metrics?window=7d'),
      ]);
      if (!infoRes.ok) {
        setErr(infoRes.status === 401 ? 'Sign in to see usage details.' : 'Could not load usage info.');
        return;
      }
      setInfo(await infoRes.json() as UsageInfo);
      if (metricsRes.ok) {
        const data = await metricsRes.json() as { runs?: RecentRun[] };
        setRecentRuns(data.runs ?? []);
      }
    } catch {
      setErr('Network error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const metrics = lastMetrics;
  const live = lastLive;
  const usage = metrics?.usage;

  const latencyMs = metrics?.totalLatencyMs ?? live?.elapsedMs;
  const cost = metrics?.actualCostUsd ?? metrics?.estimatedCostUsd ?? live?.estimatedCostUsd;
  const costBasis = metrics?.costBasis ?? 'estimated';
  const inputTokens = metrics?.inputTokens ?? live?.inputTokens;
  const outputTokens = metrics?.outputTokens ?? live?.outputTokens;
  const geminiCalls = metrics?.geminiCallCount ?? live?.geminiCallCount;
  const toolCalls = metrics?.toolCallCount ?? live?.toolCallCount;
  const agentN = metrics?.agentCount ?? live?.agentCount;
  const doneN = metrics?.completedAgentCount ?? live?.completedAgentCount;

  const cardStyle = { border: `1px solid ${border}`, background: surface };

  return (
    <div className="flex flex-col gap-6 max-w-3xl w-full">
      <div>
        <h2 className="text-lg font-bold tracking-tight" style={{ color: text }}>API and model usage</h2>
        <p className="text-[13px] mt-1" style={{ color: textMuted }}>
          Tokens and latency are measured from live API responses. Cost uses the local rate table below — provider dashboards remain authoritative for billing.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="veracity-card p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Last run</p>
            {costBasis === 'measured' ? (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200">measured</span>
            ) : (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">estimated</span>
            )}
          </div>
          {metrics || live ? (
            <ul className="mt-2 text-[12px] font-mono space-y-1" style={{ color: textMuted }}>
              {latencyMs != null && <li>Latency: {(latencyMs / 1000).toFixed(1)}s</li>}
              {inputTokens != null && outputTokens != null && (
                <li>Tokens: {inputTokens.toLocaleString()} in / {outputTokens.toLocaleString()} out</li>
              )}
              {cost != null && <li>Cost: {formatUsd(cost)}</li>}
              {geminiCalls != null && <li>Model calls: {geminiCalls}</li>}
              {toolCalls != null && <li>Tool invocations: {toolCalls}</li>}
              {usage?.embeddings.calls ? <li>Embeddings: {usage.embeddings.calls}</li> : null}
              {agentN != null && <li>Agents: {doneN ?? '—'}/{agentN}</li>}
              {metrics?.traceUrl && (
                <li>
                  <a
                    href={metrics.traceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    Open in Langfuse <ExternalLink size={10} />
                  </a>
                </li>
              )}
            </ul>
          ) : (
            <p className="mt-2 text-[12px]" style={{ color: textMuted }}>Run a query on the Intelligence tab to populate metrics.</p>
          )}
        </div>

        <div className="veracity-card p-4">
          <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Session (this tab)</p>
          <ul className="mt-2 text-[12px] font-mono space-y-1" style={{ color: textMuted }}>
            <li>Queries: {sessionTotals.queries}</li>
            <li>Sum cost: {formatUsd(sessionTotals.totalCostUsd)}</li>
            <li>Sum latency: {(sessionTotals.totalLatencyMs / 1000).toFixed(1)}s</li>
            <li>Tokens: {sessionTotals.totalInputTokens.toLocaleString()} in / {sessionTotals.totalOutputTokens.toLocaleString()} out</li>
            <li>Model calls: {sessionTotals.totalGeminiCalls}</li>
            <li>Tool calls: {sessionTotals.totalToolCalls}</li>
            <li>Embeddings: {sessionTotals.totalEmbeddingCalls}</li>
          </ul>
        </div>
      </div>

      {usage && Object.keys(usage.llm.byStage).length > 0 && (
        <div className="veracity-card p-4">
          <p className="text-[10px] font-mono uppercase tracking-widest mb-3" style={{ color: textSubtle }}>Model calls by stage</p>
          <div className="space-y-2">
            {(Object.entries(usage.llm.byStage) as [UsageStage, { calls: number; inputTokens: number; outputTokens: number; costUsd: number }][]).map(([stage, row]) => (
              <div key={stage} className="flex flex-wrap items-center justify-between gap-2 text-[12px] font-mono" style={{ color: textMuted }}>
                <span style={{ color: text }}>{STAGE_LABELS[stage] ?? stage}</span>
                <span>{row.calls} calls · {row.inputTokens.toLocaleString()}/{row.outputTokens.toLocaleString()} tok · {formatUsd(row.costUsd)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {usage && Object.keys(usage.tools.byProvider).length > 0 && (
        <div className="veracity-card p-4">
          <p className="text-[10px] font-mono uppercase tracking-widest mb-3" style={{ color: textSubtle }}>Tool calls by provider</p>
          <div className="space-y-3">
            {Object.entries(usage.tools.byProvider).map(([provider, row]) => (
              <div key={provider} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-medium capitalize" style={{ color: text }}>{provider}</span>
                  <span className="text-[11px] font-mono" style={{ color: textMuted }}>
                    {row.calls} calls
                    {row.calls > 0 && row.totalLatencyMs > 0
                      ? ` · ${Math.round(row.totalLatencyMs / row.calls)}ms avg`
                      : ''}
                    {row.cachedHits > 0 ? ` · ${row.cachedHits} cached` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <StatusChip status="ok" count={row.ok} />
                  <StatusChip status="degraded" count={row.degraded} />
                  <StatusChip status="failed" count={row.failed} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {usage && usage.embeddings.calls > 0 && (
        <div className="veracity-card p-4">
          <p className="text-[10px] font-mono uppercase tracking-widest mb-3" style={{ color: textSubtle }}>Embeddings</p>
          <p className="text-[12px] font-mono mb-2" style={{ color: textMuted }}>
            {usage.embeddings.calls} calls · ~{usage.embeddings.estimatedTokens.toLocaleString()} tokens · {formatUsd(usage.embeddings.costUsd)}
          </p>
          <div className="space-y-1">
            {Object.entries(usage.embeddings.byPurpose).map(([purpose, row]) => (
              <div key={purpose} className="text-[11px] font-mono flex justify-between" style={{ color: textMuted }}>
                <span>{purpose}</span>
                <span>{row?.calls ?? 0} · {formatUsd(row?.costUsd ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {metrics?.agentLatencies && Object.keys(metrics.agentLatencies).length > 0 && (
        <div className="veracity-card p-4">
          <p className="text-[10px] font-mono uppercase tracking-widest mb-3" style={{ color: textSubtle }}>Per-agent latency</p>
          <div className="space-y-2">
            {Object.entries(metrics.agentLatencies)
              .sort(([, a], [, b]) => b - a)
              .map(([agentId, ms]) => {
                const maxMs = Math.max(...Object.values(metrics.agentLatencies));
                const pct = maxMs > 0 ? (ms / maxMs) * 100 : 0;
                return (
                  <div key={agentId}>
                    <div className="flex justify-between text-[11px] font-mono mb-0.5" style={{ color: textMuted }}>
                      <span className="capitalize">{agentId.replace(/-/g, ' ')}</span>
                      <span>{(ms / 1000).toFixed(1)}s</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-accent/60 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {recentRuns.length > 0 && (
        <div className="veracity-card overflow-hidden">
          <div className="px-4 py-2 border-b border-border">
            <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Recent runs (7d)</p>
          </div>
          <ul className="divide-y divide-border">
            {recentRuns.slice(0, 10).map(run => (
              <li key={run.id} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                <span className="text-[12px] truncate max-w-md" style={{ color: text }}>{run.query_preview ?? '(no preview)'}</span>
                <span className="text-[11px] font-mono shrink-0" style={{ color: textMuted }}>
                  {formatUsd(Number(run.cost_usd))} · {(run.latency_ms / 1000).toFixed(1)}s
                  {run.trace_url ? (
                    <a href={run.trace_url} target="_blank" rel="noopener noreferrer" className="ml-2 text-accent">trace</a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {err && <p className="text-[12px] text-amber-600">{err}</p>}

      {info && (
        <div className="space-y-4">
          <div className="veracity-card p-4">
            <p className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: textSubtle }}>Configured models (env)</p>
            <p className="text-[12px] font-mono" style={{ color: textMuted }}>
              Text: {info.models.text} · Embeddings: {info.models.embedding} ({info.models.embeddingDimensions}d)
            </p>
            {info.pricing && (
              <p className="text-[11px] font-mono mt-2" style={{ color: textSubtle }}>
                Rate table: ${info.pricing.llmInputPerM}/M in · ${info.pricing.llmOutputPerM}/M out · ${info.pricing.embedPerM}/M embed
              </p>
            )}
          </div>
          <div className="veracity-card overflow-hidden">
            <div className="px-3 py-2 border-b border-border">
              <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Integrations</p>
            </div>
            <ul className="divide-y divide-border">
              {info.providers.map(p => (
                <li key={p.id} className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1">
                  <div>
                    <span className="text-[12px] font-medium" style={{ color: text }}>{p.label}</span>
                    <span className={`ml-2 text-[10px] font-mono px-1.5 py-0.5 rounded ${p.configured ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-muted text-muted-foreground border border-border'}`}>
                      {p.configured ? 'configured' : 'not set'}
                    </span>
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
