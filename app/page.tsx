'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send, Plus, Search, ChevronRight, RefreshCw, ArrowUpRight,
  LogOut, User, Layers, X, History, GitBranch,
  TrendingUp, Swords, Trophy, DollarSign, Megaphone, Telescope,
  CheckCircle2, Circle, AlertCircle, MessageSquarePlus, Paperclip, Trash2,
  Activity, Zap, Shield, Sun, Moon, Rocket,
} from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import type { AgentRun, OrchestratorOutput, AgentOutput, ImageAttachment, MindMapOutput } from '@/lib/agents/types';
import { ArtifactRenderer } from '@/components/artifacts/ArtifactRenderer';
import { useTheme } from '@/lib/theme';
import {
  createSession, listSessions, saveMessage, loadMessages, deleteSession, type ChatSession, type StoredMessage,
} from '@/lib/conversations';
import {
  getUserMemory, extractAndUpdateMemory, buildMemoryContext,
} from '@/lib/memory';

/* ─── Types ─────────────────────────────────────────────── */
type SourceLink   = { title: string; url: string };
type AttachedImage = { dataUrl: string; data: string; mimeType: string; name: string };
type Message = {
  id: number;
  role: 'user' | 'assistant';
  type?: 'text' | 'intelligence';
  content: string;
  images?: AttachedImage[];
  sources?: SourceLink[];
  suggestions?: string[];
  recommendations?: any[];
  agentRuns?: AgentRun[];
  orchestratorOutput?: OrchestratorOutput;
};
type FollowUp = {
  id: number;
  question: string;
  answer: string;
  sources?: SourceLink[];
  loading?: boolean;
};

/* ─── Constants ─────────────────────────────────────────── */
const DEMO_QUERIES = [
  'Is Lilian competitive in the AI SDR market right now?',
  'Is the digital workers category accelerating or consolidating?',
  'What should Vector Agents build to capture emerging demand?',
];

const ALL_DOMAINS = ['market-trends', 'competitive', 'win-loss', 'pricing', 'positioning', 'adjacent', 'execution-engine'] as const;
type Domain = typeof ALL_DOMAINS[number];

const DOMAIN_META: Record<Domain, {
  label: string; short: string;
  icon: React.ReactNode;
  color: string;       // text color
  bg: string;          // subtle tint bg (dark)
  bgLight: string;     // subtle tint bg (light)
  border: string;      // accent border
}> = {
  'market-trends': {
    label: 'Market & Trend Sensing',   short: 'Market Trends',
    icon: <TrendingUp size={14} />,
    color: '#3b82f6', bg: 'rgba(59,130,246,0.08)', bgLight: 'rgba(59,130,246,0.06)', border: 'rgba(59,130,246,0.3)',
  },
  'competitive': {
    label: 'Competitive Landscape',    short: 'Competitive',
    icon: <Swords size={14} />,
    color: '#a855f7', bg: 'rgba(168,85,247,0.08)', bgLight: 'rgba(168,85,247,0.06)', border: 'rgba(168,85,247,0.3)',
  },
  'win-loss': {
    label: 'Win / Loss Intelligence',  short: 'Win / Loss',
    icon: <Trophy size={14} />,
    color: '#10b981', bg: 'rgba(16,185,129,0.08)', bgLight: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.3)',
  },
  'pricing': {
    label: 'Pricing & Packaging',      short: 'Pricing',
    icon: <DollarSign size={14} />,
    color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', bgLight: 'rgba(245,158,11,0.06)', border: 'rgba(245,158,11,0.3)',
  },
  'positioning': {
    label: 'Positioning & Messaging',  short: 'Positioning',
    icon: <Megaphone size={14} />,
    color: '#ef4444', bg: 'rgba(239,68,68,0.08)', bgLight: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.3)',
  },
  'adjacent': {
    label: 'Adjacent Market Collision', short: 'Adjacent',
    icon: <Telescope size={14} />,
    color: '#6366f1', bg: 'rgba(99,102,241,0.08)', bgLight: 'rgba(99,102,241,0.06)', border: 'rgba(99,102,241,0.3)',
  },
  'execution-engine': {
    label: 'Execution Engine',          short: 'Execution',
    icon: <Rocket size={14} />,
    color: '#0070f3', bg: 'rgba(0,112,243,0.08)', bgLight: 'rgba(0,112,243,0.06)', border: 'rgba(0,112,243,0.3)',
  },
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function hydrateMessage(m: StoredMessage, idx: number): Message {
  const meta = m.metadata ?? {};
  return {
    id: idx,
    role: m.role,
    type: (meta.type as Message['type']) ?? (m.role === 'assistant' ? 'intelligence' : undefined),
    content: m.content,
    images: meta.images as AttachedImage[] | undefined,
    sources: meta.sources as SourceLink[] | undefined,
    suggestions: meta.suggestions as string[] | undefined,
    recommendations: meta.recommendations as any[] | undefined,
    agentRuns: meta.agentRuns as AgentRun[] | undefined,
    orchestratorOutput: meta.orchestratorOutput as OrchestratorOutput | undefined,
  };
}

/* ─── Confidence badge ───────────────────────────────────── */
function ConfidenceBadge({ level }: { level?: string }) {
  if (!level) return null;
  const styles: Record<string, { color: string; bg: string; border: string }> = {
    high:   { color: '#10b981', bg: 'rgba(16,185,129,0.12)',  border: 'rgba(16,185,129,0.3)'  },
    medium: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)'  },
    low:    { color: '#6b7280', bg: 'rgba(107,114,128,0.12)', border: 'rgba(107,114,128,0.25)' },
  };
  const s = styles[level] ?? styles.low;
  return (
    <span className="text-[10px] font-mono font-medium uppercase tracking-wide px-2 py-0.5 rounded"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.border}` }}>
      {level}
    </span>
  );
}

/* ─── Sidebar agent row ──────────────────────────────────── */
function SidebarAgentRow({ domain, run }: { domain: Domain; run?: AgentRun }) {
  const { isDark, textMuted, textSubtle } = useTheme();
  const meta   = DOMAIN_META[domain];
  const status = run?.status ?? 'idle';

  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-md">
      <div className="w-3.5 shrink-0 flex justify-center">
        {status === 'running'   && <RefreshCw size={11} style={{ color: meta.color }} className="animate-spin" />}
        {status === 'completed' && <CheckCircle2 size={11} style={{ color: '#10b981' }} />}
        {status === 'failed'    && <AlertCircle size={11} style={{ color: '#ef4444' }} />}
        {(status === 'idle' || status === 'pending') && <Circle size={11} style={{ color: isDark ? '#333' : '#ccc' }} />}
      </div>
      <span className="text-[12px] flex-1 truncate" style={{
        color: status === 'running'   ? meta.color :
               status === 'completed' ? undefined :
               status === 'failed'    ? '#ef4444' : textSubtle,
        fontWeight: status === 'running' ? 500 : 400,
      }}>
        {meta.short}
      </span>
      {status === 'running' && (
        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
          style={{ color: meta.color, background: meta.bg, border: `1px solid ${meta.border}` }}>
          live
        </span>
      )}
      {status === 'completed' && (run as any)?.confidence && (
        <ConfidenceBadge level={(run as any).confidence} />
      )}
    </div>
  );
}

/* ─── Agent card ─────────────────────────────────────────── */
function AgentCard({
  domain, run, output, isExpanded, onClick,
}: {
  domain: Domain; run?: AgentRun; output?: AgentOutput;
  isExpanded: boolean; onClick: () => void;
}) {
  const { isDark, surface, border, textMuted, textSubtle } = useTheme();
  const meta      = DOMAIN_META[domain];
  const status    = run?.status ?? 'idle';
  const snippet   = output?.facts?.[0] ?? output?.interpretation?.[0];
  const clickable = !!output;

  const borderColor = isExpanded
    ? meta.color
    : status === 'running'
    ? meta.border
    : border;

  const bgTint = (status === 'running' || status === 'completed')
    ? (isDark ? meta.bg : meta.bgLight)
    : 'transparent';

  return (
    <button
      onClick={onClick}
      disabled={!clickable && status !== 'running'}
      className="relative flex flex-col gap-3 p-4 rounded-lg text-left transition-all duration-200"
      style={{
        background: `color-mix(in srgb, var(--card), transparent 0%)`,
        border: `1px solid ${borderColor}`,
        boxShadow: isExpanded ? `0 0 0 1px ${meta.color}33, 0 4px 16px ${meta.color}15` : 'var(--shadow-sm)',
        cursor: clickable ? 'pointer' : 'default',
        opacity: status === 'idle' ? 0.6 : 1,
      }}
      onMouseEnter={e => { if (clickable) (e.currentTarget as HTMLButtonElement).style.borderColor = meta.color; }}
      onMouseLeave={e => { if (!isExpanded) (e.currentTarget as HTMLButtonElement).style.borderColor = status === 'running' ? meta.border : 'var(--border)'; }}
    >
      {/* Colour wash */}
      {(status === 'running' || (status === 'completed' && isExpanded)) && (
        <div className="absolute inset-0 rounded-lg pointer-events-none" style={{ background: bgTint }} />
      )}

      {/* Header */}
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ color: status === 'idle' ? 'var(--foreground-subtle)' : meta.color }}>{meta.icon}</span>
          <span className="text-[11px] font-mono font-semibold uppercase tracking-widest truncate"
            style={{ color: status === 'idle' ? 'var(--foreground-subtle)' : meta.color }}>
            {meta.short}
          </span>
        </div>

        {status === 'idle' && (
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
            style={{ color: 'var(--foreground-subtle)', border: '1px solid var(--border)' }}>idle</span>
        )}
        {status === 'pending' && (
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1"
            style={{ color: 'var(--muted-foreground)', border: '1px solid var(--border)' }}>
            queued <RefreshCw size={7} className="animate-spin" />
          </span>
        )}
        {status === 'running' && (
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1 font-medium"
            style={{ color: meta.color, background: meta.bg, border: `1px solid ${meta.border}` }}>
            live <RefreshCw size={7} className="animate-spin" />
          </span>
        )}
        {status === 'completed' && output?.confidence && (
          <ConfidenceBadge level={output.confidence} />
        )}
        {status === 'failed' && (
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded"
            style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>failed</span>
        )}
      </div>

      {/* Body */}
      <div className="relative flex-1 min-h-[52px]">
        {status === 'idle' && (
          <p className="text-xs font-mono" style={{ color: 'var(--foreground-subtle)' }}>awaiting query…</p>
        )}
        {status === 'pending' && (
          <div className="flex flex-col gap-2 opacity-50">
            <div className="h-2.5 rounded skeleton w-4/5" />
            <div className="h-2.5 rounded skeleton w-3/5" />
          </div>
        )}
        {status === 'running' && (
          <div className="flex flex-col gap-2">
            <div className="h-2.5 rounded skeleton w-full" />
            <div className="h-2.5 rounded skeleton w-4/5" style={{ animationDelay: '0.2s' }} />
            <div className="h-2.5 rounded skeleton w-3/5" style={{ animationDelay: '0.4s' }} />
          </div>
        )}
        {status === 'completed' && snippet && (
          <p className="text-[13px] leading-snug line-clamp-3" style={{ color: 'var(--foreground-muted)' }}>{snippet}</p>
        )}
        {status === 'failed' && (
          <p className="text-xs" style={{ color: '#ef4444' }}>Agent failed — partial data only.</p>
        )}
      </div>

      {/* Footer */}
      {output?.sources && output.sources.length > 0 && (
        <div className="relative flex items-center gap-1.5 pt-2.5"
          style={{ borderTop: '1px solid var(--border)' }}>
          <span className="text-[10px] font-mono" style={{ color: 'var(--foreground-subtle)' }}>
            {output.sources.length} sources
          </span>
          <ChevronRight size={10} className="ml-auto transition-transform duration-150"
            style={{ color: meta.color, transform: isExpanded ? 'rotate(90deg)' : 'none' }} />
        </div>
      )}
    </button>
  );
}

/* ─── Main dashboard ─────────────────────────────────────── */
export default function VeracityDashboard() {
  const router   = useRouter();
  const supabase = createClient();
  const { isDark, toggle: toggleTheme, surface, surface2, border, borderStrong, text, textMuted, textSubtle } = useTheme();
  const [messages, setMessages]           = useState<Message[]>([]);
  const [inputValue, setInputValue]       = useState('');
  const [isLoading, setIsLoading]         = useState(false);
  const [userEmail, setUserEmail]         = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu]   = useState(false);
  const [expandedDomain, setExpandedDomain] = useState<Domain | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [followUps, setFollowUps]         = useState<FollowUp[]>([]);
  const [followUpInput, setFollowUpInput] = useState('');
  const [isFollowingUp, setIsFollowingUp] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [memoryContext, setMemoryContext] = useState('');

  const fileInputRef   = useRef<HTMLInputElement>(null);
  const followUpEndRef = useRef<HTMLDivElement>(null);

  const currentResult  = [...messages].reverse().find(m => m.role === 'assistant');
  const recentQueries  = messages.filter(m => m.role === 'user').map(m => m.content);
  const hasResult      = !!(currentResult?.orchestratorOutput);
  const completedCount = currentResult?.agentRuns?.filter(r => r.status === 'completed').length ?? 0;
  const totalCount     = currentResult?.agentRuns?.length ?? 0;

  const refreshSessions = useCallback(async () => {
    setLoadingSessions(true);
    const s = await listSessions();
    setSessions(s);
    setLoadingSessions(false);
    return s;
  }, []);

  const loadSession = useCallback(async (sessionId: string) => {
    setCurrentSessionId(sessionId);
    setExpandedDomain(null);
    setFollowUps([]);
    const stored = await loadMessages(sessionId);
    
    // Separate main messages from follow-ups based on metadata
    const mainMessages: Message[] = [];
    const loadedFollowUps: FollowUp[] = [];
    
    stored.forEach((m, i) => {
      const msg = hydrateMessage(m, i);
      if (m.metadata?.isFollowUp) {
        if (m.role === 'user') {
          loadedFollowUps.push({
            id: i,
            question: m.content,
            answer: '',
            loading: false,
          });
        } else if (m.role === 'assistant' && loadedFollowUps.length > 0) {
          const lastIndex = loadedFollowUps.length - 1;
          loadedFollowUps[lastIndex].answer = m.content;
          loadedFollowUps[lastIndex].sources = msg.sources;
        }
      } else {
        mainMessages.push(msg);
      }
    });
    
    setMessages(mainMessages);
    setFollowUps(loadedFollowUps);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
    refreshSessions();
    getUserMemory().then(mem => setMemoryContext(buildMemoryContext(mem)));
  }, [refreshSessions]);

  useEffect(() => {
    if (followUps.length > 0) followUpEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [followUps]);

  const handleSignOut = async () => { await supabase.auth.signOut(); router.push('/auth'); router.refresh(); };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const imgs: AttachedImage[] = await Promise.all(files.map(async file => {
      const dataUrl = await readFileAsBase64(file);
      const [prefix, data] = dataUrl.split(',');
      const mimeType = prefix.split(':')[1].split(';')[0];
      return { dataUrl, data, mimeType, name: file.name };
    }));
    setAttachedImages(prev => [...prev, ...imgs]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async (text: string, imagesToSend?: AttachedImage[]) => {
    const images = imagesToSend ?? attachedImages;
    const effectiveText = text.trim() || (images.length > 0 ? 'Analyse the attached image(s).' : '');
    if (!effectiveText || isLoading) return;

    setExpandedDomain(null);
    setFollowUps([]);

    const userMsg: Message = { id: Date.now(), role: 'user', content: effectiveText, images: images.length > 0 ? images : undefined };
    const history = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setAttachedImages([]);
    setIsLoading(true);

    const assistantId = Date.now() + 1;
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', type: 'intelligence', content: '', agentRuns: [] }]);

    const imagePayloads: ImageAttachment[] = images.map(img => ({ data: img.data, mimeType: img.mimeType }));

    let finalOutput: OrchestratorOutput | null = null;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: effectiveText, history, images: imagePayloads, memoryContext }),
      });
      if (!res.ok || !res.body) throw new Error(`API error ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(line.slice(6));

            if (chunk.type === 'agent_update') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? {
                  ...m,
                  agentRuns: [
                    ...(m.agentRuns ?? []).filter(r => r.agentId !== chunk.run.agentId),
                    chunk.run,
                  ],
                } : m
              ));
            }

            if (chunk.type === 'result') {
              const out: OrchestratorOutput = chunk.output;
              finalOutput = out;
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? {
                  ...m,
                  content: out.synthesizedAnswer,
                  type: 'intelligence',
                  orchestratorOutput: out,
                  recommendations: out.topRecommendations?.map(r => ({
                    title: r.title, rationale: r.rationale,
                    score: r.confidence === 'high' ? 90 : r.confidence === 'medium' ? 65 : 40,
                    confidence: r.confidence, evidence: r.evidence, priority: r.priority,
                  })),
                  sources: out.outputs
                    ?.flatMap(o => o.sources?.map(s => ({ title: s.title, url: s.url })) ?? [])
                    .filter((s, i, a) => s.url && a.findIndex(x => x.url === s.url) === i)
                    .slice(0, 12),
                  suggestions: out.suggestedFollowUps?.slice(0, 3),
                } : m
              ));
            }

            if (chunk.type === 'error') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: `Analysis failed: ${chunk.message}`, type: 'text' } : m
              ));
            }
          } catch { /* skip malformed */ }
        }
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: 'Failed to connect. Please try again.' } : m
      ));
    } finally {
      setIsLoading(false);
    }

    let sessionId = currentSessionId;

    if (!sessionId) {
      const title = effectiveText.slice(0, 60) + (effectiveText.length > 60 ? '...' : '');
      const session = await createSession(title);
      if (session) {
        sessionId = session.id;
        setCurrentSessionId(session.id);
        await refreshSessions();
      }
    }

    if (sessionId) {
      await saveMessage(sessionId, 'user', effectiveText, {
        images: images.length > 0 ? images : undefined,
      });

      if (finalOutput) {
        const sources = finalOutput.outputs
          ?.flatMap(o => o.sources?.map(s => ({ title: s.title, url: s.url })) ?? [])
          .filter((s, i, a) => s.url && a.findIndex(x => x.url === s.url) === i)
          .slice(0, 12);

        await saveMessage(sessionId, 'assistant', finalOutput.synthesizedAnswer, {
          type: 'intelligence',
          orchestratorOutput: finalOutput,
          recommendations: finalOutput.topRecommendations?.map(r => ({
            title: r.title,
            rationale: r.rationale,
            score: r.confidence === 'high' ? 90 : r.confidence === 'medium' ? 65 : 40,
            confidence: r.confidence,
            evidence: r.evidence,
            priority: r.priority,
          })),
          sources,
          suggestions: finalOutput.suggestedFollowUps?.slice(0, 3),
          agentRuns: finalOutput.agentRuns,
        });

        extractAndUpdateMemory(
          sessionId,
          effectiveText,
          finalOutput.synthesizedAnswer,
          await getUserMemory(),
        ).then(async () => {
          const updated = await getUserMemory();
          setMemoryContext(buildMemoryContext(updated));
        });
      }
    }
  };

  const handleFollowUp = async (text: string) => {
    if (!text.trim() || isFollowingUp || isLoading) return;
    const fuId = Date.now();
    setFollowUps(prev => [...prev, { id: fuId, question: text, answer: '', loading: true }]);
    setFollowUpInput('');
    setIsFollowingUp(true);

    const history = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Append previous follow-ups so the new follow-up has the full context
    for (const fu of followUps) {
      if (fu.question) history.push({ role: 'user', content: fu.question });
      if (fu.answer && !fu.loading) history.push({ role: 'assistant', content: fu.answer });
    }

    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, history, memoryContext }),
      });
      if (!res.ok || !res.body) throw new Error();

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(line.slice(6));
            if (chunk.type === 'result') {
              const out: OrchestratorOutput = chunk.output;
              const sources = out.outputs
                ?.flatMap(o => o.sources?.map(s => ({ title: s.title, url: s.url })) ?? [])
                .filter((s, i, a) => s.url && a.findIndex(x => x.url === s.url) === i)
                .slice(0, 6);
              setFollowUps(prev => prev.map(f =>
                f.id === fuId ? { ...f, answer: out.synthesizedAnswer, sources, loading: false } : f
              ));
              
              if (currentSessionId) {
                // Save the follow-up question and answer to the session
                await saveMessage(currentSessionId, 'user', text, { isFollowUp: true });
                await saveMessage(currentSessionId, 'assistant', out.synthesizedAnswer, { 
                  isFollowUp: true, 
                  sources 
                });
              }
            }
          } catch { /* skip */ }
        }
      }
    } catch {
      setFollowUps(prev => prev.map(f =>
        f.id === fuId ? { ...f, answer: 'Follow-up failed. Please try again.', loading: false } : f
      ));
    } finally {
      setIsFollowingUp(false);
    }
  };

  const handleNewQuery  = () => {
    setCurrentSessionId(null);
    setMessages([]);
    setFollowUps([]);
    setExpandedDomain(null);
    setAttachedImages([]);
  };
  const getRunForDomain = (d: Domain) => currentResult?.agentRuns?.find(r => r.agentId === d || r.name?.toLowerCase().includes(d.split('-')[0]));
  const getOutputForDomain = (d: Domain) => currentResult?.orchestratorOutput?.outputs?.find(o => o.domain === d);

  const expandedOutput = expandedDomain ? getOutputForDomain(expandedDomain) : null;

  /* ─ Inline style helpers (from ThemeContext) ─ */
  const sidebarBg  = surface;
  const headerBg   = isDark ? 'rgba(17,17,17,0.92)' : 'rgba(255,255,255,0.92)';
  const borderC    = border;
  const textMain   = text;
  const cardBg     = surface;
  const cardBg2    = surface2;
  const inputBg    = surface2;

  return (
    <div className={isDark ? '' : 'light'} style={{ display: 'contents' }}>
    <div className="flex h-screen w-full overflow-hidden" style={{ background: isDark ? '#0a0a0a' : '#f9f9f9', color: textMain, fontFamily: 'inherit' }}>

      {/* ══════════════════════════════════ SIDEBAR ══ */}
      <aside className="w-[228px] flex-shrink-0 flex flex-col h-full" style={{ background: sidebarBg, borderRight: `1px solid ${borderC}` }}>

        {/* Logo */}
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: `1px solid ${borderC}` }}>
          <div className="flex items-center gap-2">
            <span className="text-base font-bold tracking-tight" style={{ color: textMain }}>Veracity</span>
          </div>
          <p className="text-[10px] font-mono mt-0.5" style={{ color: textSubtle }}>growth intelligence</p>
        </div>

        {/* New query */}
        <div className="px-3 pt-3 pb-2.5">
          <button
            onClick={handleNewQuery}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-[13px] font-medium transition-colors focus-ring"
            style={{ background: isDark ? '#1a1a1a' : '#f0f0f0', border: `1px solid ${borderC}`, color: textMain }}
          >
            <Plus size={14} style={{ color: textMuted }} /> New query
          </button>
        </div>

        {/* ─ Agents panel ─ */}
        <div className="px-3 pb-3">
          <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${borderC}`, background: isDark ? '#0a0a0a' : '#f9f9f9' }}>
            <div className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: `1px solid ${borderC}` }}>
              <span className="text-[10px] font-mono font-semibold uppercase tracking-widest" style={{ color: textSubtle }}>
                Agents
              </span>
              {isLoading && totalCount > 0 && (
                <span className="text-[10px] font-mono flex items-center gap-1" style={{ color: textMuted }}>
                  <RefreshCw size={9} className="animate-spin" /> {completedCount}/{totalCount}
                </span>
              )}
              {hasResult && !isLoading && (
                <span className="text-[10px] font-mono" style={{ color: '#10b981' }}>{completedCount}/{totalCount}</span>
              )}
            </div>
            <div className="py-1 px-1">
              {ALL_DOMAINS.map(d => (
                <SidebarAgentRow key={d} domain={d} run={getRunForDomain(d)} />
              ))}
            </div>
          </div>
        </div>

        {/* Recent */}
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {loadingSessions ? (
            <div className="mb-3 px-2">
              <p className="text-[11px] font-mono" style={{ color: textSubtle }}>loading sessions...</p>
            </div>
          ) : sessions.length > 0 ? (
            <div className="mb-3">
              <div className="flex items-center gap-1.5 px-2 mb-1.5">
                <History size={10} style={{ color: textSubtle }} />
                <span className="text-[10px] font-mono font-semibold uppercase tracking-widest" style={{ color: textSubtle }}>Recent</span>
              </div>
              {sessions.slice(0, 8).map((session) => (
                <div key={session.id} className="relative group flex items-center mb-0.5">
                  <button onClick={() => loadSession(session.id)} title={session.title}
                    className="flex-1 text-left text-[12px] px-2 py-1.5 rounded-md truncate transition-colors"
                    style={{ color: currentSessionId === session.id ? textMain : textMuted, paddingRight: '28px' }}
                    onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = textMain; b.style.background = isDark ? '#1a1a1a' : '#f0f0f0'; }}
                    onMouseLeave={e => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.color = currentSessionId === session.id ? textMain : textMuted;
                      b.style.background = 'transparent';
                    }}
                  >
                    {session.title}
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      await deleteSession(session.id);
                      if (currentSessionId === session.id) {
                        handleNewQuery();
                      }
                      await refreshSessions();
                    }}
                    className="absolute right-1 w-6 h-6 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10"
                    style={{ color: '#ef4444' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.1)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                    title="Delete session"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {/* Mind map */}
          <div>
            <div className="flex items-center gap-1.5 px-2 mb-1.5">
              <GitBranch size={10} style={{ color: textSubtle }} />
              <span className="text-[10px] font-mono font-semibold uppercase tracking-widest" style={{ color: textSubtle }}>Mind Map</span>
            </div>
            {(() => {
              const mindMapOutput = currentResult?.orchestratorOutput?.outputs?.find(o => o.artifactType === 'mind-map') as MindMapOutput | undefined;
              if (mindMapOutput?.branches?.length) {
                return (
                  <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${borderC}`, background: cardBg }}>
                    <ArtifactRenderer output={mindMapOutput} product={currentResult?.orchestratorOutput?.product ?? ''} />
                  </div>
                );
              }
              return (
                <div className="rounded-lg p-3.5 flex flex-col items-center gap-1.5"
                  style={{ border: `1px dashed ${borderC}`, background: 'transparent' }}>
                  <GitBranch size={16} style={{ color: isDark ? '#2a2a2a' : '#ddd' }} />
                  <p className="text-[11px] font-mono text-center leading-snug" style={{ color: textSubtle }}>
                    query graph appears after first analysis
                  </p>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: `1px solid ${borderC}` }}>
          <div className="live-dot" />
          <span className="text-[10px] font-mono" style={{ color: textSubtle }}>live · sourced · grounded</span>
        </div>
      </aside>

      {/* ═══════════════════════════════════ MAIN ══ */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">

        {/* ── Header ── */}
        <header className="shrink-0 flex items-center gap-3 px-5 py-3 z-20"
          style={{ background: headerBg, borderBottom: `1px solid ${borderC}`, backdropFilter: 'blur(12px)' }}>

          {/* Search */}
          <div className="flex-1 flex flex-col gap-2">
            {attachedImages.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {attachedImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img src={img.dataUrl} alt={img.name} className="h-8 w-8 object-cover rounded-md" style={{ border: `1px solid ${borderC}` }} />
                    <button onClick={() => setAttachedImages(prev => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: '#333', color: '#fff' }}>
                      <X size={8} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative flex items-center rounded-lg transition-all"
              style={{ border: `1px solid ${borderC}`, background: inputBg }}
              onFocus={() => {}} >
              <Search size={13} className="absolute left-3.5 pointer-events-none" style={{ color: textSubtle }} />
              <input
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend(inputValue)}
                placeholder="Ask a growth intelligence question…"
                className="w-full h-10 pl-9 pr-[88px] text-[13px] bg-transparent outline-none"
                style={{ color: textMain }}
                disabled={isLoading}
              />
              <div className="absolute right-2 flex items-center gap-1">
                <button onClick={() => fileInputRef.current?.click()}
                  className="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
                  style={{ color: textSubtle }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = textMain; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = textSubtle; }}>
                  <Paperclip size={13} />
                </button>
                <button
                  onClick={() => handleSend(inputValue)}
                  disabled={(!inputValue.trim() && attachedImages.length === 0) || isLoading}
                  className="flex items-center justify-center w-7 h-7 rounded-md text-[13px] font-medium transition-all disabled:opacity-40"
                  style={{ background: '#0070f3', color: '#fff' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#0060df'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#0070f3'; }}
                >
                  {isLoading
                    ? <RefreshCw size={13} className="animate-spin" />
                    : <Send size={13} />}
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
            </div>
          </div>

          {/* Stats */}
          <div className="hidden xl:flex items-center gap-4 text-[11px] font-mono" style={{ color: textMuted }}>
            <span className="flex items-center gap-1.5"><Activity size={11} style={{ color: textSubtle }} /> &lt;5 min</span>
            <span className="flex items-center gap-1.5"><Shield size={11} style={{ color: textSubtle }} /> sourced</span>
            <span className="flex items-center gap-1.5"><Zap size={11} style={{ color: textSubtle }} /> 16+ signals</span>
          </div>

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-md flex items-center justify-center transition-colors shrink-0"
            style={{ border: `1px solid ${borderC}`, background: isDark ? '#1a1a1a' : '#f0f0f0', color: textMuted }}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          {/* User */}
          <div className="relative shrink-0">
            <button onClick={() => setShowUserMenu(v => !v)}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold transition-opacity hover:opacity-80"
              style={{ background: '#0070f3', color: '#fff' }}>
              {userEmail ? userEmail[0].toUpperCase() : <User size={13} />}
            </button>
            {showUserMenu && (
              <div className="absolute right-0 top-10 w-52 rounded-lg py-1 z-50"
                style={{ background: isDark ? '#111' : '#fff', border: `1px solid ${borderC}`, boxShadow: isDark ? '0 8px 24px rgba(0,0,0,0.5)' : '0 8px 24px rgba(0,0,0,0.12)' }}>
                {userEmail && (
                  <p className="px-3 py-2 text-[12px] font-mono truncate" style={{ color: textMuted, borderBottom: `1px solid ${borderC}` }}>{userEmail}</p>
                )}
                <button onClick={handleSignOut}
                  className="w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors"
                  style={{ color: textMuted }}
                  onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = textMain; b.style.background = isDark ? '#1a1a1a' : '#f4f4f4'; }}
                  onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = textMuted; b.style.background = 'transparent'; }}>
                  <LogOut size={13} style={{ color: textSubtle }} /> Sign out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto grid-bg" style={{ padding: '24px' }}>
          <div className="flex flex-col gap-5 max-w-[1200px] w-full mx-auto">

            {/* Empty state */}
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-6">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight mb-2" style={{ color: textMain }}>
                    Growth Intelligence
                  </h2>
                  <p className="text-[13px] font-mono" style={{ color: textMuted }}>
                    live signals · 6 specialist agents · confidence-scored
                  </p>
                </div>
                <div className="flex flex-col gap-2 w-full max-w-lg">
                  {DEMO_QUERIES.map(q => (
                    <button key={q} onClick={() => handleSend(q)}
                      className="flex items-center gap-3 px-4 py-3.5 rounded-lg text-[13px] text-left transition-all"
                      style={{ background: cardBg, border: `1px solid ${borderC}`, color: textMuted }}
                      onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = isDark ? '#404040' : '#aaa'; b.style.color = textMain; }}
                      onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = borderC; b.style.color = textMuted; }}
                    >
                      <Search size={13} style={{ color: textSubtle, flexShrink: 0 }} />
                      <span className="flex-1">{q}</span>
                      <ChevronRight size={12} style={{ color: textSubtle, flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ── Agent Grid ── */}
            {(currentResult || isLoading) && (
              <div>
                {/* Row header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex flex-col gap-2 max-w-[65%]">
                    <p className="text-[12px] font-mono truncate" style={{ color: textMuted }}>
                      {recentQueries[recentQueries.length - 1] ?? 'analysing…'}
                    </p>
                    {messages.filter(m => m.role === 'user').pop()?.images && (
                      <div className="flex flex-wrap gap-2">
                        {messages.filter(m => m.role === 'user').pop()?.images?.map((img, i) => (
                          <img key={i} src={img.dataUrl} alt={img.name} className="h-10 w-10 object-cover rounded-md" style={{ border: `1px solid ${borderC}` }} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="flex gap-1">
                      {ALL_DOMAINS.map(d => {
                        const s = getRunForDomain(d)?.status ?? 'idle';
                        const m = DOMAIN_META[d];
                        return (
                          <div key={d} className="w-2 h-2 rounded-full transition-all"
                            style={{
                              background: s === 'completed' ? m.color : s === 'running' ? m.color : (isDark ? '#2a2a2a' : '#ddd'),
                              opacity: s === 'running' ? 1 : s === 'completed' ? 1 : 0.5,
                            }}
                          />
                        );
                      })}
                    </div>
                    {totalCount > 0 && (
                      <span className="text-[11px] font-mono" style={{ color: textSubtle }}>
                        {completedCount}/{Math.max(totalCount, 6)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  {ALL_DOMAINS.map(domain => (
                    <AgentCard
                      key={domain}
                      domain={domain}
                      run={getRunForDomain(domain)}
                      output={getOutputForDomain(domain)}
                      isExpanded={expandedDomain === domain}
                      onClick={() => { if (getOutputForDomain(domain)) setExpandedDomain(p => p === domain ? null : domain); }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ── Expanded domain ── */}
            {expandedDomain && expandedOutput && (
              <div className="rounded-lg overflow-hidden" style={{
                border: `1px solid ${DOMAIN_META[expandedDomain].border}`,
                background: cardBg,
                boxShadow: `0 0 0 1px ${DOMAIN_META[expandedDomain].color}1a`,
              }}>
                <div className="flex items-center justify-between px-5 py-3.5"
                  style={{ borderBottom: `1px solid ${borderC}`, background: isDark ? DOMAIN_META[expandedDomain].bg : DOMAIN_META[expandedDomain].bgLight }}>
                  <div className="flex items-center gap-2.5">
                    <span style={{ color: DOMAIN_META[expandedDomain].color }}>{DOMAIN_META[expandedDomain].icon}</span>
                    <span className="text-[14px] font-semibold" style={{ color: textMain }}>
                      {DOMAIN_META[expandedDomain].label}
                    </span>
                    <ConfidenceBadge level={expandedOutput.confidence} />
                  </div>
                  <button onClick={() => setExpandedDomain(null)}
                    className="p-1.5 rounded-md transition-colors"
                    style={{ color: textMuted }}
                    onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = isDark ? '#1a1a1a' : '#f0f0f0'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
                    <X size={14} />
                  </button>
                </div>

                <div className="p-5 flex flex-col gap-5">
                  <ArtifactRenderer output={expandedOutput} product={currentResult?.orchestratorOutput?.product ?? ''} />

                  {expandedOutput.facts.filter(f => !f.startsWith('[')).length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-3" style={{ color: textSubtle }}>Key Facts</p>
                      <ul className="flex flex-col gap-2.5">
                        {expandedOutput.facts.filter(f => !f.startsWith('[')).map((f, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-[13px]" style={{ color: textMuted }}>
                            <span className="font-mono mt-0.5 shrink-0" style={{ color: '#10b981' }}>✓</span>{f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {expandedOutput.interpretation.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-3" style={{ color: textSubtle }}>Analysis</p>
                      <ul className="flex flex-col gap-2.5">
                        {expandedOutput.interpretation.map((interp, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-[13px]" style={{ color: textMuted }}>
                            <span className="font-mono mt-0.5 shrink-0" style={{ color: textSubtle }}>›</span>{interp}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Summary card ── */}
            {currentResult?.content && (
              <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${borderC}`, background: cardBg }}>
                <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${borderC}` }}>
                  <div className="flex items-center gap-2">
                    <Layers size={14} style={{ color: '#0070f3' }} />
                    <span className="text-[12px] font-mono font-semibold uppercase tracking-widest" style={{ color: textMuted }}>
                      Intelligence Summary
                    </span>
                  </div>
                  {currentResult.orchestratorOutput?.product && (
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded"
                      style={{ color: '#0070f3', background: 'rgba(0,112,243,0.1)', border: '1px solid rgba(0,112,243,0.2)' }}>
                      {currentResult.orchestratorOutput.product}
                    </span>
                  )}
                </div>

                <div className="p-5 flex flex-col gap-6">
                  <p className="text-[14px] leading-[1.7]" style={{ color: textMuted }}>{currentResult.content}</p>

                  {/* Recommendations */}
                  {currentResult.recommendations && currentResult.recommendations.length > 0 && (
                    <div>
                      <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-3" style={{ color: textSubtle }}>
                        Strategic Recommendations
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {currentResult.recommendations.map((rec: any, i: number) => (
                          <div key={i} className="rounded-lg p-4 flex flex-col gap-2.5"
                            style={{ background: cardBg2, border: `1px solid ${borderC}` }}>
                            <div className="flex flex-wrap gap-1.5">
                              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded uppercase" style={{
                                color:   rec.priority === 'immediate' ? '#ef4444' : rec.priority === 'short-term' ? '#f59e0b' : '#3b82f6',
                                background: rec.priority === 'immediate' ? 'rgba(239,68,68,0.1)' : rec.priority === 'short-term' ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.1)',
                                border: `1px solid ${rec.priority === 'immediate' ? 'rgba(239,68,68,0.25)' : rec.priority === 'short-term' ? 'rgba(245,158,11,0.25)' : 'rgba(59,130,246,0.25)'}`,
                              }}>{rec.priority ?? 'strategic'}</span>
                              <ConfidenceBadge level={rec.confidence ?? (rec.score >= 80 ? 'high' : rec.score >= 55 ? 'medium' : 'low')} />
                            </div>
                            <h4 className="text-[13px] font-semibold leading-snug" style={{ color: textMain }}>{rec.title}</h4>
                            <p className="text-[12px] leading-relaxed" style={{ color: textMuted }}>{rec.rationale}</p>
                            {rec.evidence?.length > 0 && (
                              <ul className="flex flex-col gap-1 mt-1">
                                {rec.evidence.map((e: string, ei: number) => (
                                  <li key={ei} className="text-[11px] flex items-start gap-1.5" style={{ color: textSubtle }}>
                                    <span className="font-mono mt-0.5 shrink-0" style={{ color: isDark ? '#333' : '#ccc' }}>›</span>{e}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sources */}
                  {currentResult.sources && currentResult.sources.length > 0 && (
                    <div className="flex items-start gap-3 pt-4" style={{ borderTop: `1px solid ${borderC}` }}>
                      <span className="text-[10px] font-mono font-semibold uppercase tracking-widest shrink-0 mt-1" style={{ color: textSubtle }}>sources</span>
                      <div className="flex flex-wrap gap-1.5">
                        {currentResult.sources.map(source => (
                          <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded-md transition-colors"
                            style={{ background: cardBg2, border: `1px solid ${borderC}`, color: textMuted }}
                            onMouseEnter={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color = '#0070f3'; a.style.borderColor = 'rgba(0,112,243,0.3)'; }}
                            onMouseLeave={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color = textMuted; a.style.borderColor = borderC; }}>
                            {source.title} <ArrowUpRight size={9} />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Suggestions */}
                  {currentResult.suggestions && currentResult.suggestions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pt-3" style={{ borderTop: `1px solid ${borderC}` }}>
                      <span className="text-[10px] font-mono font-semibold uppercase tracking-widest" style={{ color: textSubtle }}>dig deeper</span>
                      {currentResult.suggestions.map(sug => (
                        <button key={sug} onClick={() => setFollowUpInput(sug)}
                          className="text-[12px] font-medium flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all"
                          style={{ background: cardBg2, border: `1px solid ${borderC}`, color: textMuted }}
                          onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = '#0070f3'; b.style.borderColor = 'rgba(0,112,243,0.4)'; b.style.background = 'rgba(0,112,243,0.06)'; }}
                          onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.color = textMuted; b.style.borderColor = borderC; b.style.background = cardBg2; }}>
                          {sug} <ChevronRight size={11} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Inline Mind Map ── */}
            {(() => {
              const mindMapOutput = currentResult?.orchestratorOutput?.outputs?.find(o => o.artifactType === 'mind-map') as MindMapOutput | undefined;
              if (!mindMapOutput?.branches?.length) return null;
              return (
                <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${borderC}`, background: cardBg }}>
                  <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: `1px solid ${borderC}` }}>
                    <GitBranch size={14} style={{ color: '#0070f3' }} />
                    <span className="text-[12px] font-mono font-semibold uppercase tracking-widest" style={{ color: textMuted }}>
                      Mind Map
                    </span>
                  </div>
                  <div className="p-4">
                    <ArtifactRenderer output={mindMapOutput} product={currentResult?.orchestratorOutput?.product ?? ''} />
                  </div>
                </div>
              );
            })()}

            {/* ── Follow-up answers ── */}
            {followUps.map(fu => (
              <div key={fu.id} className="rounded-lg overflow-hidden"
                style={{ border: `1px solid ${borderC}`, borderLeft: '2px solid #0070f3', background: cardBg }}>
                <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: `1px solid ${borderC}` }}>
                  <MessageSquarePlus size={13} style={{ color: '#0070f3' }} />
                  <p className="text-[12px] font-mono" style={{ color: textMuted }}>{fu.question}</p>
                </div>
                <div className="p-4">
                  {fu.loading ? (
                    <div className="flex flex-col gap-2">
                      <div className="h-3 rounded skeleton w-3/4" />
                      <div className="h-3 rounded skeleton w-full" style={{ animationDelay: '0.2s' }} />
                      <div className="h-3 rounded skeleton w-5/6" style={{ animationDelay: '0.4s' }} />
                    </div>
                  ) : (
                    <>
                      <p className="text-[13px] leading-[1.7] whitespace-pre-line" style={{ color: textMuted }}>{fu.answer}</p>
                      {fu.sources && fu.sources.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3 pt-3" style={{ borderTop: `1px solid ${borderC}` }}>
                          {fu.sources.map(s => (
                            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded transition-colors"
                              style={{ background: cardBg2, border: `1px solid ${borderC}`, color: textMuted }}>
                              {s.title} <ArrowUpRight size={8} />
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}

            {/* ── Follow-up input ── */}
            {hasResult && (
              <div className="flex items-center gap-3 rounded-lg px-4 py-3"
                style={{ border: `1px solid ${borderC}`, background: cardBg }}
                ref={followUpEndRef}>
                <MessageSquarePlus size={14} style={{ color: textSubtle, flexShrink: 0 }} />
                <input
                  type="text"
                  value={followUpInput}
                  onChange={e => setFollowUpInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleFollowUp(followUpInput)}
                  placeholder="Ask a follow-up — analysis above stays intact…"
                  className="flex-1 text-[13px] bg-transparent outline-none"
                  style={{ color: textMain }}
                  disabled={isFollowingUp || isLoading}
                />
                <button
                  onClick={() => handleFollowUp(followUpInput)}
                  disabled={!followUpInput.trim() || isFollowingUp || isLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all disabled:opacity-40"
                  style={{ background: '#0070f3', color: '#fff' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = '#0060df'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#0070f3'; }}>
                  {isFollowingUp
                    ? <><RefreshCw size={11} className="animate-spin" /> thinking…</>
                    : <><Send size={11} /> Follow up</>}
                </button>
              </div>
            )}

            <div className="h-4" />
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
