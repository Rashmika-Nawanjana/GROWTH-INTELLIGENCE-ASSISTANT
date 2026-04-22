'use client';

import { useState } from 'react';
import { useTheme } from '@/lib/theme-provider';
import { Crosshair, Loader2, Sparkles } from 'lucide-react';

type Result = {
  summary: string;
  historicalCompetitiveMoves: { move: string; context: string; effectOnRivals: string }[];
  modernEntrantPlaybook: { analogy: string; applicationToday: string; exampleTactics: string[] }[];
  guardrails: string;
};

export function StealStrategyPanel() {
  const { isDark, surface, border, text, textMuted, textSubtle } = useTheme();
  const [company, setCompany] = useState('');
  const [market, setMarket] = useState('');
  const [newContext, setNewContext] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Result | null>(null);

  const run = async () => {
    if (!company.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
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
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError((j as { error?: string }).error ?? 'Request failed');
        return;
      }
      setData(j as Result);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl w-full">
      <div>
        <h2 className="text-lg font-bold tracking-tight flex items-center gap-2" style={{ color: text }}>
          <Crosshair size={20} className="shrink-0" style={{ color: textSubtle }} />
          Steal strategy
        </h2>
        <p className="text-[13px] mt-1" style={{ color: textMuted }}>
          Case-study view: how a company historically competed against same-type rivals, and how a new entrant might apply those patterns ethically today. Not legal advice; verify facts for your market.
        </p>
      </div>

      <div className="rounded-xl p-4 space-y-3" style={{ border: `1px solid ${border}`, background: surface }}>
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Company to analyse *</label>
          <input
            value={company}
            onChange={e => setCompany(e.target.value)}
            placeholder="e.g. Salesforce, Notion, Stripe"
            className="mt-1 w-full rounded-lg px-3 py-2.5 text-[13px] outline-none"
            style={{ border: `1px solid ${border}`, background: isDark ? '#0d0d0d' : '#fff', color: text }}
          />
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Market (optional)</label>
          <input
            value={market}
            onChange={e => setMarket(e.target.value)}
            placeholder="e.g. B2B CRM, headless CMS, fintech cards"
            className="mt-1 w-full rounded-lg px-3 py-2.5 text-[13px] outline-none"
            style={{ border: `1px solid ${border}`, background: isDark ? '#0d0d0d' : '#fff', color: text }}
          />
        </div>
        <div>
          <label className="text-[10px] font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Your new company or angle (optional)</label>
          <input
            value={newContext}
            onChange={e => setNewContext(e.target.value)}
            placeholder="e.g. 20-person PLG startup in Europe"
            className="mt-1 w-full rounded-lg px-3 py-2.5 text-[13px] outline-none"
            style={{ border: `1px solid ${border}`, background: isDark ? '#0d0d0d' : '#fff', color: text }}
          />
        </div>
        <button
          type="button"
          onClick={run}
          disabled={loading || !company.trim()}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-semibold transition-opacity disabled:opacity-40"
          style={{ background: '#0070f3', color: '#fff' }}
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          Generate
        </button>
      </div>

      {error && (
        <p className="text-[13px] text-red-500">{error}</p>
      )}

      {data && (
        <div className="space-y-5">
          <div className="rounded-xl p-4" style={{ border: `1px solid ${border}`, background: surface }}>
            <p className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: textSubtle }}>Summary</p>
            <p className="text-[14px] leading-relaxed" style={{ color: isDark ? '#d4d4d4' : '#333' }}>{data.summary}</p>
          </div>

          <div className="rounded-xl p-4" style={{ border: `1px solid ${border}`, background: surface }}>
            <p className="text-[10px] font-mono uppercase tracking-widest mb-3" style={{ color: textSubtle }}>Historical competitive moves</p>
            <ul className="space-y-3">
              {data.historicalCompetitiveMoves.map((h, i) => (
                <li key={i} className="text-[13px] leading-relaxed" style={{ color: isDark ? '#d4d4d4' : '#404040' }}>
                  <span className="font-semibold" style={{ color: text }}>{h.move}</span>
                  <span className="text-[12px] block opacity-80 mt-0.5">{h.context}</span>
                  <span className="text-[12px] block mt-1" style={{ color: textMuted }}>Effect on rivals: {h.effectOnRivals}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl p-4" style={{ border: `1px solid ${border}`, background: surface }}>
            <p className="text-[10px] font-mono uppercase tracking-widest mb-3" style={{ color: textSubtle }}>Modern entrant playbook</p>
            <ul className="space-y-4">
              {data.modernEntrantPlaybook.map((m, i) => (
                <li key={i} className="text-[13px] leading-relaxed" style={{ color: isDark ? '#d4d4d4' : '#404040' }}>
                  <span className="font-semibold" style={{ color: text }}>{m.analogy}</span>
                  <p className="mt-1">{m.applicationToday}</p>
                  {m.exampleTactics?.length > 0 && (
                    <ul className="list-disc pl-5 mt-2 text-[12px] space-y-0.5" style={{ color: textMuted }}>
                      {m.exampleTactics.map((t, j) => <li key={j}>{t}</li>)}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl p-4" style={{ border: '1px solid rgba(234,179,8,0.35)', background: isDark ? 'rgba(234,179,8,0.06)' : 'rgba(234,179,8,0.08)' }}>
            <p className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: textSubtle }}>Guardrails</p>
            <p className="text-[12px] leading-relaxed" style={{ color: textMuted }}>{data.guardrails}</p>
          </div>
        </div>
      )}
    </div>
  );
}
