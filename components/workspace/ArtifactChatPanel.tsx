'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, MessageSquare, Send, Sparkles } from 'lucide-react';
import { useTheme } from '@/lib/theme-provider';
import {
  listItemMessages,
  type WorkspaceItemMessage,
} from '@/lib/workspace';
import type { ChartType } from '@/lib/workspace/chart-adapters';

const PRESETS = [
  'Explain this to me',
  'What should I do about this?',
  "What's the biggest risk here?",
];

interface Props {
  itemId: string;
  chartType: ChartType;
  readOnly?: boolean;
}

export function ArtifactChatPanel({ itemId, chartType, readOnly = false }: Props) {
  const { isDark, surface, surface2, border, text, textMuted, textSubtle } = useTheme();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<WorkspaceItemMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrievedCount, setRetrievedCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoadingHistory(true);
    listItemMessages(itemId).then(msgs => {
      if (!cancelled) {
        setMessages(msgs);
        setLoadingHistory(false);
      }
    });
    return () => { cancelled = true; };
  }, [open, itemId]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setInput('');

    const optimistic: WorkspaceItemMessage = {
      id: `temp-${Date.now()}`,
      item_id: itemId,
      role: 'user',
      content: q,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const res = await fetch('/api/workspace/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, question: q, chartType }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error ?? 'Failed to get explanation');
      }
      const assistant: WorkspaceItemMessage = {
        id: data.messageId ?? `asst-${Date.now()}`,
        item_id: itemId,
        role: 'assistant',
        content: data.answer as string,
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistant]);
      const sectionCount = Number(data.retrievedSectionCount ?? 0);
      if (sectionCount > 0) setRetrievedCount(sectionCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2" style={{ borderTop: `1px solid ${border}`, paddingTop: 12 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider self-start"
        style={{ color: textMuted }}
      >
        <MessageSquare size={12} />
        {open ? 'Hide AI' : readOnly ? 'View thread' : 'Ask AI'}
      </button>

      {open && (
        <div className="flex flex-col gap-3 rounded-lg p-3" style={{ background: surface2, border: `1px solid ${border}` }}>
          {!readOnly ? (
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(p => (
              <button
                key={p}
                type="button"
                disabled={loading}
                onClick={() => ask(p)}
                className="text-[10px] font-mono px-2.5 py-1 rounded-full transition-colors flex items-center gap-1"
                style={{
                  color: '#0052FF',
                  background: isDark ? 'rgba(0,82,255,0.1)' : 'rgba(0,82,255,0.06)',
                  border: '1px solid rgba(0,82,255,0.2)',
                }}
              >
                <Sparkles size={10} /> {p}
              </button>
            ))}
          </div>
          ) : null}

          {retrievedCount > 0 && (
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-accent/5 text-accent border border-accent/20 self-start">
              Retrieved {retrievedCount} section{retrievedCount === 1 ? '' : 's'}
            </span>
          )}

          <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
            {loadingHistory && (
              <p className="text-[11px] font-mono" style={{ color: textSubtle }}>Loading thread…</p>
            )}
            {!loadingHistory && messages.length === 0 && (
              <p className="text-[11px] font-mono" style={{ color: textSubtle }}>
                Ask anything about this artifact. Answers stay grounded in its sources.
              </p>
            )}
            {messages.map(m => (
              <div
                key={m.id}
                className="rounded-lg px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap"
                style={{
                  background: m.role === 'user'
                    ? (isDark ? 'rgba(0,82,255,0.12)' : 'rgba(0,82,255,0.08)')
                    : surface,
                  border: `1px solid ${border}`,
                  color: text,
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '95%',
                }}
              >
                {m.content}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: textMuted }}>
                <Loader2 size={12} className="animate-spin" /> Thinking…
              </div>
            )}
          </div>

          {error && (
            <p className="text-[11px] font-mono" style={{ color: '#ef4444' }}>{error}</p>
          )}

          {!readOnly ? (
          <form
            className="flex items-center gap-2"
            onSubmit={e => {
              e.preventDefault();
              ask(input);
            }}
          >
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Ask about this artifact…"
              disabled={loading}
              className="flex-1 text-[12.5px] px-3 py-2 rounded-lg outline-none"
              style={{
                background: surface,
                border: `1px solid ${border}`,
                color: text,
              }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="p-2 rounded-lg text-white bg-gradient-signature disabled:opacity-50"
            >
              <Send size={13} />
            </button>
          </form>
          ) : null}
        </div>
      )}
    </div>
  );
}
