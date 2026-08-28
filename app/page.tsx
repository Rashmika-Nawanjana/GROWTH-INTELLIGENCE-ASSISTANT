'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send, Plus, Search, ChevronRight, ChevronLeft, RefreshCw, ArrowUpRight,
  LogOut, User, Layers, X, History, GitBranch, PanelLeftClose, PanelLeft,
  TrendingUp, Swords, Trophy, DollarSign, Megaphone, Telescope,
  CheckCircle2, Check, Circle, AlertCircle, MessageSquarePlus, Paperclip, Trash2,
  Activity, Zap, Shield, Sun, Moon, Rocket, Fish, CheckCheck, Sparkles,
  ThumbsUp, ThumbsDown, BarChart3, Crosshair, Bookmark, Users,
} from 'lucide-react';
import { ApiUsagePanel } from '@/components/ApiUsagePanel';
import {
  StealStrategyPanel,
  initialStealPanelState,
  type StealPanelState,
} from '@/components/StealStrategyPanel';
import { WorkspacePanel } from '@/components/workspace/WorkspacePanel';
import { SharedWorkspacePanel } from '@/components/workspace/SharedWorkspacePanel';
import { AddToWorkspaceButton } from '@/components/workspace/AddToWorkspaceButton';
import { createClient } from '@/lib/supabase-browser';
import type { AgentRun, OrchestratorOutput, AgentOutput, ImageAttachment, MindMapOutput, ExecutionPlanOutput, ForecastOutput, RefinementDelta } from '@/lib/agents/types';
import { ArtifactRenderer } from '@/components/artifacts/ArtifactRenderer';
import { useTheme } from '@/lib/theme-provider';
import {
  createSession, listSessions, saveMessage, loadMessages, deleteSession, type ChatSession, type StoredMessage,
} from '@/lib/conversations';
import {
  getUserMemory, extractAndUpdateMemory, buildMemoryContext, type UserMemory,
} from '@/lib/memory';
import {
  rateRecommendation, recommendationKey, type RecommendationRating,
} from '@/lib/feedback';
import { filterDisplaySources } from '@/lib/tools/source-validator';

// Per-session pgvector recall (semantic search over earlier turns in this chat)
async function recallContextForSession(sessionId: string, query: string): Promise<string> {
  try {
    const res = await fetch('/api/recall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, query }),
    });
    if (!res.ok) return '';
    const data = await res.json();
    return (data?.context as string) ?? '';
  } catch { return ''; }
}

function indexMessageInBackground(sessionId: string, role: 'user' | 'assistant', content: string) {
  if (!content?.trim()) return;
  fetch('/api/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, role, content }),
  }).catch(() => {});
}

/* ─── Types ─────────────────────────────────────────────── */
type SourceLink   = { title: string; url: string; citationId?: number };
type AttachedImage = { dataUrl: string; data: string; mimeType: string; name: string };
type LiveRunMetrics = {
  elapsedMs: number;
  agentCount: number;
  completedAgentCount: number;
  failedAgentCount: number;
  runningAgentCount: number;
  estimatedCostUsd: number;
  geminiCallCount: number;
  toolCallCount: number;
};
type Message = {
  id: number;
  // Supabase row id of the persisted chat_messages row. Required for the
  // feedback/refine loop: /api/refine needs the authoritative messageId to
  // look up the prior orchestratorOutput and re-run full orchestration.
  persistedId?: string | null;
  role: 'user' | 'assistant';
  type?: 'text' | 'intelligence';
  content: string;
  images?: AttachedImage[];
  sources?: SourceLink[];
  suggestions?: string[];
  recommendations?: any[];
  agentRuns?: AgentRun[];
  orchestratorOutput?: OrchestratorOutput;
  liveMetrics?: LiveRunMetrics;
  /** Live backend status lines while the chat stream is open (not persisted). */
  orchestrationLog?: string[];
};
type FollowUp = {
  id: number;
  question: string;
  answer: string;
  sources?: SourceLink[];
  loading?: boolean;
};

type PipelineStageState = 'pending' | 'running' | 'completed' | 'failed';
type PipelineStage = {
  id: string;
  label: string;
  state: PipelineStageState;
};

/* ─── Constants ─────────────────────────────────────────── */
const DEMO_QUERIES = [
  'Is Lilian competitive in the AI SDR market right now?',
  'Is the digital workers category accelerating or consolidating?',
  'What should Vector Agents build to capture emerging demand?',
];

const ALL_DOMAINS = ['market-trends', 'competitive', 'win-loss', 'pricing', 'positioning', 'adjacent', 'execution-engine', 'mirofish', 'mirofish-live'] as const;
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
  'mirofish': {
    label: 'MiroFish (Forecast)',        short: 'MiroFish',
    icon: <Fish size={14} />,
    color: '#06b6d4', bg: 'rgba(6,182,212,0.08)', bgLight: 'rgba(6,182,212,0.06)', border: 'rgba(6,182,212,0.3)',
  },
  'mirofish-live': {
    label: 'MiroFish Live (Real VPS)',   short: 'MiroFish Live',
    icon: <Fish size={14} />,
    color: '#10b981', bg: 'rgba(16,185,129,0.08)', bgLight: 'rgba(16,185,129,0.06)', border: 'rgba(16,185,129,0.3)',
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
    persistedId: m.id,
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

function buildSourceMix(outputs: AgentOutput[] = []) {
  const counts = new Map<string, number>();
  for (const output of outputs) {
    for (const source of output.sources ?? []) {
      counts.set(source.tool, (counts.get(source.tool) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => ({ tool, count }));
}

/* ─── Sidebar agent row ──────────────────────────────────── */
function SidebarAgentRow({
  domain,
  run,
  selected,
  onToggle,
}: {
  domain: Domain;
  run?: AgentRun;
  selected: boolean;
  onToggle: () => void;
}) {
  const { isDark, textMuted, textSubtle } = useTheme();
  const meta   = DOMAIN_META[domain];
  const status = run?.status ?? 'idle';

  return (
    <div className="agent-row-enhanced flex items-center gap-2.5"
      style={{ background: selected ? (isDark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)') : 'transparent' }}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={`${selected ? 'Disable' : 'Enable'} ${meta.short}`}
        className="w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-all"
        style={{
          borderColor: selected ? meta.color : (isDark ? '#444' : '#cbd5e1'),
          background: selected ? meta.color : 'transparent',
          boxShadow: selected ? `0 0 6px ${meta.color}33` : 'none',
        }}
      >
        {selected && <Check size={10} color="#fff" strokeWidth={3} />}
      </button>
      <div className="w-4 shrink-0 flex justify-center">
        {status === 'running'   && <RefreshCw size={12} style={{ color: meta.color }} className="animate-spin" />}
        {status === 'completed' && <CheckCircle2 size={12} style={{ color: '#10b981' }} />}
        {status === 'failed'    && <AlertCircle size={12} style={{ color: '#ef4444' }} />}
        {(status === 'idle' || status === 'pending') && <Circle size={12} style={{ color: isDark ? '#444' : '#bbb' }} />}
      </div>
      <span className="text-[13px] flex-1 truncate" style={{
        textDecoration: selected ? 'none' : 'line-through',
        color: status === 'running'   ? meta.color :
               status === 'completed' ? undefined :
               status === 'failed'    ? '#ef4444' : textSubtle,
        fontWeight: status === 'running' ? 600 : selected ? 500 : 400,
        letterSpacing: '-0.01em',
      }}>
        {meta.short}
        {domain === 'mirofish-live' && status === 'idle' && (
          <span className="ml-1.5 text-[9px] font-mono uppercase tracking-wider px-1 py-0.5 rounded"
            style={{ color: '#10b981', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', verticalAlign: 'middle' }}>
            VPS
          </span>
        )}
      </span>
      {status === 'running' && (
        <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded"
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
          <p className="agent-snippet line-clamp-3">{snippet}</p>
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

/** YouTube-style gray shimmer blocks — layout shells only, no new structure. */
function Sk({ className = '', style, delay }: { className?: string; style?: React.CSSProperties; delay?: number }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ ...(style ?? {}), ...(delay != null ? { animationDelay: `${delay}s` } : {}) }}
    />
  );
}

function ResultCardsSkeleton({
  borderC,
  cardBg,
  cardBg2,
  textMuted,
}: {
  borderC: string;
  cardBg: string;
  cardBg2: string;
  textMuted: string;
}) {
  return (
    <>
      {/* Summary card shell */}
      <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${borderC}`, background: cardBg }}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${borderC}` }}>
          <div className="flex items-center gap-2">
            <Sk className="h-3.5 w-3.5 rounded" />
            <Sk className="h-3 w-36" />
          </div>
          <Sk className="h-5 w-40 rounded-full" />
        </div>
        <div className="p-6 lg:p-8 flex flex-col gap-4">
          <Sk className="h-3.5 w-full" />
          <Sk className="h-3.5 w-11/12" delay={0.1} />
          <Sk className="h-3.5 w-4/5" delay={0.2} />
          <Sk className="h-3.5 w-5/6" delay={0.3} />
          <div className="flex flex-wrap gap-2 mt-2">
            <Sk className="h-5 w-24 rounded-full" />
            <Sk className="h-5 w-28 rounded-full" delay={0.1} />
            <Sk className="h-5 w-20 rounded-full" delay={0.2} />
          </div>
          <div className="mt-4">
            <p className="text-[11px] font-mono font-bold uppercase tracking-widest mb-4" style={{ color: textMuted }}>
              Domain Highlights
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-xl p-4 flex flex-col gap-3"
                  style={{ background: cardBg2, border: `1px solid ${borderC}`, borderLeft: `3px solid ${borderC}` }}
                >
                  <div className="flex items-center justify-between">
                    <Sk className="h-3 w-24" delay={i * 0.05} />
                    <Sk className="h-4 w-12 rounded-full" delay={i * 0.05} />
                  </div>
                  <Sk className="h-3 w-full" delay={0.1 + i * 0.05} />
                  <Sk className="h-3 w-4/5" delay={0.15 + i * 0.05} />
                  <Sk className="h-3 w-2/3" delay={0.2 + i * 0.05} />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2">
            <p className="text-[11px] font-mono font-bold uppercase tracking-widest mb-4" style={{ color: textMuted }}>
              Strategic Recommendations
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-lg p-4 flex flex-col gap-2.5" style={{ background: cardBg2, border: `1px solid ${borderC}` }}>
                  <div className="flex gap-1.5">
                    <Sk className="h-4 w-16 rounded" />
                    <Sk className="h-4 w-12 rounded" delay={0.1} />
                  </div>
                  <Sk className="h-3.5 w-3/4" delay={0.1} />
                  <Sk className="h-3 w-full" delay={0.15} />
                  <Sk className="h-3 w-5/6" delay={0.2} />
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-4" style={{ borderTop: `1px solid ${borderC}` }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Sk key={i} className="h-6 w-28 rounded-md" delay={i * 0.05} />
            ))}
          </div>
        </div>
      </div>

      {/* Mind map shell */}
      <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${borderC}`, background: cardBg }}>
        <div className="flex items-center gap-2 px-5 py-3.5" style={{ borderBottom: `1px solid ${borderC}` }}>
          <Sk className="h-3.5 w-3.5 rounded" />
          <Sk className="h-3 w-24" />
        </div>
        <div className="p-4 flex flex-col gap-3">
          <Sk className="h-48 w-full rounded-lg" />
          <div className="flex gap-2 justify-center">
            <Sk className="h-4 w-16 rounded-full" />
            <Sk className="h-4 w-16 rounded-full" delay={0.1} />
            <Sk className="h-4 w-16 rounded-full" delay={0.2} />
          </div>
        </div>
      </div>
    </>
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
  // Track which recommendations the user has rated (key → rating)
  const [ratedRecs, setRatedRecs] = useState<Record<string, RecommendationRating>>({});
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [userMemory, setUserMemory] = useState<UserMemory | null>(null);
  const [mirofishRunning, setMirofishRunning] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<Record<Domain, boolean>>(() =>
    Object.fromEntries(ALL_DOMAINS.map(d => [d, d !== 'mirofish-live'])) as Record<Domain, boolean>
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  /** Top header tabs: main intelligence vs usage vs steal strategy vs workspace. */
  const [topTab, setTopTab] = useState<'intelligence' | 'usage' | 'steal' | 'workspace' | 'shared'>('intelligence');

  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'shared') setTopTab('shared');
  }, []);
  /** Keys of artifacts already pinned to workspace this session (optimistic UI). */
  const [workspaceSavedKeys, setWorkspaceSavedKeys] = useState<Set<string>>(() => new Set());
  /** Steal-strategy form + result, lifted so tab switches don't discard a run. */
  const [stealState, setStealState] = useState<StealPanelState>(initialStealPanelState);
  const patchStealState = useCallback((patch: Partial<StealPanelState>) => {
    setStealState(prev => ({ ...prev, ...patch }));
  }, []);
  /** Rolling totals for API Usage tab (reset on new query). */
  const [sessionUsage, setSessionUsage] = useState({
    queries: 0,
    totalCostUsd: 0,
    totalLatencyMs: 0,
    totalGeminiCalls: 0,
    totalToolCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalEmbeddingCalls: 0,
  });

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const followUpEndRef  = useRef<HTMLDivElement>(null);
  const textareaRef     = useRef<HTMLTextAreaElement>(null);

  const autoResizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
  }, []);

  // Keep the textarea height in sync when value is cleared programmatically
  // (e.g. after sending a long query).
  useEffect(() => {
    autoResizeTextarea();
  }, [inputValue, autoResizeTextarea]);

  const allSelected = ALL_DOMAINS.every(d => selectedAgents[d]);

  const currentResult  = [...messages].reverse().find(m => m.role === 'assistant');
  const recentQueries  = messages.filter(m => m.role === 'user').map(m => m.content);
  const hasResult      = !!(currentResult?.orchestratorOutput);
  const completedCount = currentResult?.agentRuns?.filter(r => r.status === 'completed').length ?? 0;
  const totalCount     = currentResult?.agentRuns?.length ?? 0;
  const selectedAgentIds = ALL_DOMAINS.filter(d => selectedAgents[d]);
  const orchLogLen     = currentResult?.orchestrationLog?.length ?? 0;
  const orchestrationLines = currentResult?.orchestrationLog ?? [];

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

  const refreshUserMemory = useCallback(async () => {
    try {
      const m = await getUserMemory();
      setUserMemory(m);
    } catch {
      // Non-fatal — chat still works without persistent memory
    }
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
    refreshSessions();
    refreshUserMemory();
  }, [refreshSessions, refreshUserMemory]);

  useEffect(() => {
    if (followUps.length > 0) followUpEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [followUps]);

  useEffect(() => {
    if (!currentResult?.orchestratorOutput) return;
    if (expandedDomain && getOutputForDomain(expandedDomain)) return;
    const firstAvailable = ALL_DOMAINS.find(d => !!getOutputForDomain(d));
    if (firstAvailable) setExpandedDomain(firstAvailable);
  }, [currentResult?.orchestratorOutput, expandedDomain]);

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

  // Swap a refined orchestration result back into the latest assistant message.
  // Used by ArtifactRenderer → ExecutionPlan's "Refine with feedback" flow.
  // We persist the updated orchestratorOutput so future page loads see
  // the latest cycle (including feedback-aware research updates).
  const handleExecutionPlanRefined = useCallback((result: {
    plan: ExecutionPlanOutput;
    orchestratorOutput?: OrchestratorOutput;
    changes?: RefinementDelta[];
  }) => {
    const { plan, orchestratorOutput, changes } = result;
    setMessages(prev => prev.map(m => {
      if (m.role !== 'assistant' || !m.orchestratorOutput) return m;
      // Only the most recent assistant message gets refined.
      const latestAssistant = [...prev].reverse().find(x => x.role === 'assistant');
      if (m.id !== latestAssistant?.id) return m;

      const updatedOutputs = m.orchestratorOutput.outputs
        .filter(o => o.artifactType !== 'execution-plan')
        .concat(plan);

      const updatedOutput: OrchestratorOutput = orchestratorOutput
        ? {
          ...orchestratorOutput,
          outputs: orchestratorOutput.outputs?.length ? orchestratorOutput.outputs : updatedOutputs,
        }
        : {
          ...m.orchestratorOutput,
          outputs: updatedOutputs,
        };

      const deltaLines = (changes ?? []).slice(0, 3).map(d => `- ${d.summary}`);
      const refinedContent = updatedOutput.synthesizedAnswer || (
        deltaLines.length
          ? `${m.content}\n\nFeedback-driven updates:\n${deltaLines.join('\n')}`
          : m.content
      );

      // Best-effort persistence so a later reload reflects the refinement.
      if (currentSessionId && m.persistedId) {
        // Re-save as a new message row rather than mutating the prior row
        // (we don't have an updateMessage helper and keeping history append-only
        // makes the feedback loop auditable).
        saveMessage(currentSessionId, 'assistant', refinedContent, {
          type: 'intelligence',
          orchestratorOutput: updatedOutput,
          recommendations: m.recommendations,
          sources: m.sources,
          suggestions: m.suggestions,
          agentRuns: m.agentRuns,
          refinedFrom: m.persistedId,
        }).then(newId => {
          if (!newId) return;
          setMessages(prev2 => prev2.map(mm =>
            mm.id === m.id ? { ...mm, persistedId: newId } : mm
          ));
        });
      }

      return { ...m, content: refinedContent, orchestratorOutput: updatedOutput };
    }));
  }, [currentSessionId]);

  const handleSend = async (text: string, imagesToSend?: AttachedImage[]) => {
    const images = imagesToSend ?? attachedImages;
    const effectiveText = text.trim() || (images.length > 0 ? 'Analyse the attached image(s).' : '');
    if (!effectiveText || isLoading) return;
    if (selectedAgentIds.length === 0) {
      setMessages(prev => [...prev, {
        id: Date.now(),
        role: 'assistant',
        type: 'text',
        content: 'Select at least one agent before running the query.',
      }]);
      return;
    }

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
    requestAnimationFrame(autoResizeTextarea);

    const assistantId = Date.now() + 1;
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', type: 'intelligence', content: '', agentRuns: [], orchestrationLog: [] }]);

    const imagePayloads: ImageAttachment[] = images.map(img => ({ data: img.data, mimeType: img.mimeType }));

    let finalOutput: OrchestratorOutput | null = null;

    const recalledContext = currentSessionId
      ? await recallContextForSession(currentSessionId, effectiveText)
      : '';
    const userMemoryContext = userMemory ? buildMemoryContext(userMemory) : '';
    const memoryContext = [userMemoryContext, recalledContext].filter(Boolean).join('\n\n');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: effectiveText,
          history,
          images: imagePayloads,
          memoryContext,
          sessionId: currentSessionId ?? undefined,
          includeMirofish: selectedAgents.mirofish,
          includeMirofishLive: selectedAgents['mirofish-live'],
          selectedAgents: selectedAgentIds,
        }),
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
                  liveMetrics: (chunk.metrics as LiveRunMetrics | undefined) ?? m.liveMetrics,
                } : m
              ));
            }

            if (chunk.type === 'orchestration_log' && typeof chunk.line === 'string') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? {
                  ...m,
                  orchestrationLog: [...(m.orchestrationLog ?? []), chunk.line].slice(-48),
                } : m
              ));
            }

            if (chunk.type === 'result') {
              const out: OrchestratorOutput = chunk.output;
              finalOutput = out;
              // If mirofish was requested, mark it as running so the sidebar shows it
              if (selectedAgents.mirofish) {
                setMirofishRunning(true);
                setMessages(prev => prev.map(m =>
                  m.id !== assistantId ? m : {
                    ...m,
                    agentRuns: [
                      ...(m.agentRuns ?? []).filter(r => r.agentId !== 'mirofish'),
                      { agentId: 'mirofish', name: 'MiroFish (Forecast)', status: 'running', startedAt: new Date().toISOString() } as AgentRun,
                    ],
                  }
                ));
              }
              // If mirofish-live was requested, mark it as running too
              if (selectedAgents['mirofish-live']) {
                setMessages(prev => prev.map(m =>
                  m.id !== assistantId ? m : {
                    ...m,
                    agentRuns: [
                      ...(m.agentRuns ?? []).filter(r => r.agentId !== 'mirofish-live'),
                      { agentId: 'mirofish-live', name: 'MiroFish Live (Real VPS)', status: 'running', startedAt: new Date().toISOString() } as AgentRun,
                    ],
                  }
                ));
              }
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
                  sources: filterDisplaySources(
                    out.outputs?.flatMap(o => o.sources?.map(s => ({ title: s.title, url: s.url, citationId: s.citationId })) ?? []) ?? [],
                    12,
                  ),
                  suggestions: out.suggestedFollowUps?.slice(0, 3),
                } : m
              ));
            }

            if (chunk.type === 'metrics_update' && chunk.metrics) {
              const m = chunk.metrics;
              setSessionUsage(prev => ({
                queries: prev.queries + 1,
                totalCostUsd: prev.totalCostUsd + (m.actualCostUsd ?? m.estimatedCostUsd),
                totalLatencyMs: prev.totalLatencyMs + m.totalLatencyMs,
                totalGeminiCalls: prev.totalGeminiCalls + m.geminiCallCount,
                totalToolCalls: prev.totalToolCalls + m.toolCallCount,
                totalInputTokens: prev.totalInputTokens + (m.inputTokens ?? 0),
                totalOutputTokens: prev.totalOutputTokens + (m.outputTokens ?? 0),
                totalEmbeddingCalls: prev.totalEmbeddingCalls + (m.usage?.embeddings.calls ?? 0),
              }));
              setMessages(prev => prev.map(msg =>
                msg.id === assistantId && msg.orchestratorOutput
                  ? {
                      ...msg,
                      orchestratorOutput: {
                        ...msg.orchestratorOutput,
                        metrics: m,
                      },
                    }
                  : msg,
              ));
            }

            if (chunk.type === 'mirofish_result') {
              const mirofishOut: AgentOutput = chunk.output;
              if (finalOutput) {
                finalOutput = {
                  ...finalOutput,
                  outputs: [
                    ...(finalOutput.outputs ?? []).filter(o => o.domain !== 'mirofish'),
                    mirofishOut,
                  ],
                  agentRuns: [
                    ...(finalOutput.agentRuns ?? []).filter(r => r.agentId !== 'mirofish'),
                    { agentId: 'mirofish', name: 'MiroFish (Forecast)', status: 'completed', confidence: mirofishOut.confidence } as AgentRun,
                  ],
                };
              }
              setMirofishRunning(false);
              setMessages(prev => prev.map(m => {
                if (m.id !== assistantId || !m.orchestratorOutput) return m;
                const updatedOutputs = [
                  ...(m.orchestratorOutput.outputs ?? []).filter(o => o.domain !== 'mirofish'),
                  mirofishOut,
                ];
                return {
                  ...m,
                  orchestratorOutput: { ...m.orchestratorOutput, outputs: updatedOutputs },
                  agentRuns: [
                    ...(m.agentRuns ?? []).filter(r => r.agentId !== 'mirofish'),
                    { agentId: 'mirofish', name: 'MiroFish (Forecast)', status: 'completed', confidence: mirofishOut.confidence } as AgentRun,
                  ],
                };
              }));
            }

            if (chunk.type === 'mirofish_live_result') {
              const liveOut: AgentOutput = chunk.output;
              const liveFailed =
                (Array.isArray(liveOut.interpretation) &&
                  liveOut.interpretation.some(line => /mirofish live unavailable|live swarm unavailable|live swarm interviews failed/i.test(line))) ||
                ((liveOut as any).swarmSize === 0) ||
                (/unavailable|failed/i.test((liveOut as any).rationale ?? ''));
              if (finalOutput) {
                finalOutput = {
                  ...finalOutput,
                  outputs: [
                    ...(finalOutput.outputs ?? []).filter(o => o.domain !== 'mirofish-live'),
                    liveOut,
                  ],
                  agentRuns: [
                    ...(finalOutput.agentRuns ?? []).filter(r => r.agentId !== 'mirofish-live'),
                    {
                      agentId: 'mirofish-live',
                      name: 'MiroFish Live (Real VPS)',
                      status: liveFailed ? 'failed' : 'completed',
                      confidence: liveOut.confidence,
                    } as AgentRun,
                  ],
                };
              }
              setMessages(prev => prev.map(m => {
                if (m.id !== assistantId || !m.orchestratorOutput) return m;
                const updatedOutputs = [
                  ...(m.orchestratorOutput.outputs ?? []).filter(o => o.domain !== 'mirofish-live'),
                  liveOut,
                ];
                return {
                  ...m,
                  orchestratorOutput: { ...m.orchestratorOutput, outputs: updatedOutputs },
                  agentRuns: [
                    ...(m.agentRuns ?? []).filter(r => r.agentId !== 'mirofish-live'),
                    {
                      agentId: 'mirofish-live',
                      name: 'MiroFish Live (Real VPS)',
                      status: liveFailed ? 'failed' : 'completed',
                      confidence: liveOut.confidence,
                    } as AgentRun,
                  ],
                };
              }));
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
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, orchestrationLog: undefined } : m
      ));
      setIsLoading(false);
      setMirofishRunning(false);
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
      indexMessageInBackground(sessionId, 'user', effectiveText);

      if (finalOutput) {
        const sources = filterDisplaySources(
          finalOutput.outputs?.flatMap(o => o.sources?.map(s => ({ title: s.title, url: s.url, citationId: s.citationId })) ?? []) ?? [],
          12,
        );

        const persistedAssistantId = await saveMessage(sessionId, 'assistant', finalOutput.synthesizedAnswer, {
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

        // Stamp the live in-memory message with the Supabase row id so the
        // "Refine with feedback" button can pass a real messageId to /api/refine.
        if (persistedAssistantId) {
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? { ...m, persistedId: persistedAssistantId } : m
          ));
        }

        indexMessageInBackground(sessionId, 'assistant', finalOutput.synthesizedAnswer);

        // Fire-and-forget durable memory extraction (role/company/products/competitors).
        // Never blocks the UI; refreshes local memory once it returns so the next
        // turn already carries the new facts in its memoryContext.
        if (userMemory) {
          extractAndUpdateMemory(sessionId, effectiveText, finalOutput.synthesizedAnswer, userMemory)
            .then(() => refreshUserMemory())
            .catch(() => {});
        }
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

    const recalledContext = currentSessionId
      ? await recallContextForSession(currentSessionId, text)
      : '';
    const userMemoryContext = userMemory ? buildMemoryContext(userMemory) : '';
    const memoryContext = [userMemoryContext, recalledContext].filter(Boolean).join('\n\n');
    const lowerFollowUp = text.toLowerCase();
    const followUpMode: 'full' | 'targeted' =
      (lowerFollowUp.includes('full rerun') || lowerFollowUp.includes('full refresh'))
        ? 'full'
        : 'targeted';

    try {
      const res = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: text,
          history,
          memoryContext,
          sessionId: currentSessionId ?? undefined,
          followUpMode,
          includeMirofish: selectedAgents.mirofish,
          selectedAgents: selectedAgentIds,
        }),
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
              const sources = filterDisplaySources(
                out.outputs?.flatMap(o => o.sources?.map(s => ({ title: s.title, url: s.url, citationId: s.citationId })) ?? []) ?? [],
                6,
              );
              setFollowUps(prev => prev.map(f =>
                f.id === fuId ? { ...f, answer: out.synthesizedAnswer, sources, loading: false } : f
              ));

              if (currentSessionId) {
                await saveMessage(currentSessionId, 'user', text, { isFollowUp: true });
                await saveMessage(currentSessionId, 'assistant', out.synthesizedAnswer, {
                  isFollowUp: true,
                  sources
                });
                indexMessageInBackground(currentSessionId, 'user', text);
                indexMessageInBackground(currentSessionId, 'assistant', out.synthesizedAnswer);

                if (userMemory) {
                  extractAndUpdateMemory(currentSessionId, text, out.synthesizedAnswer, userMemory)
                    .then(() => refreshUserMemory())
                    .catch(() => {});
                }
              }
            }

            if (chunk.type === 'metrics_update' && chunk.metrics) {
              const m = chunk.metrics;
              setSessionUsage(prev => ({
                queries: prev.queries + 1,
                totalCostUsd: prev.totalCostUsd + (m.actualCostUsd ?? m.estimatedCostUsd),
                totalLatencyMs: prev.totalLatencyMs + m.totalLatencyMs,
                totalGeminiCalls: prev.totalGeminiCalls + m.geminiCallCount,
                totalToolCalls: prev.totalToolCalls + m.toolCallCount,
                totalInputTokens: prev.totalInputTokens + (m.inputTokens ?? 0),
                totalOutputTokens: prev.totalOutputTokens + (m.outputTokens ?? 0),
                totalEmbeddingCalls: prev.totalEmbeddingCalls + (m.usage?.embeddings.calls ?? 0),
              }));
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
    setSessionUsage({
      queries: 0,
      totalCostUsd: 0,
      totalLatencyMs: 0,
      totalGeminiCalls: 0,
      totalToolCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalEmbeddingCalls: 0,
    });
  };
  const getRunForDomain = (d: Domain) => {
    const runs = currentResult?.agentRuns ?? [];
    const exact = runs.find(r => r.agentId === d);
    if (exact) return exact;

    // Avoid false matches between "mirofish" and "mirofish-live".
    if (d === 'mirofish-live') {
      return runs.find(r => /mirofish live/i.test(r.name ?? ''));
    }
    if (d === 'mirofish') {
      return runs.find(r => /mirofish/i.test(r.name ?? '') && !/mirofish live/i.test(r.name ?? ''));
    }

    return runs.find(r => r.name?.toLowerCase().includes(d.split('-')[0]));
  };
  const getOutputForDomain = (d: Domain) => currentResult?.orchestratorOutput?.outputs?.find(o => o.domain === d);
  const hasLine = (needle: string) => orchestrationLines.some(line => line.toLowerCase().includes(needle.toLowerCase()));
  const researchRuns = (currentResult?.agentRuns ?? []).filter(r =>
    ['market-trends', 'competitive', 'win-loss', 'pricing', 'positioning', 'adjacent'].includes(r.agentId),
  );
  const researchRunning = researchRuns.some(r => r.status === 'running');
  const researchTerminal = researchRuns.length > 0 && researchRuns.every(r => r.status === 'completed' || r.status === 'failed');
  const researchFailed = researchRuns.length > 0 && researchRuns.every(r => r.status === 'failed');
  const executionRun = (currentResult?.agentRuns ?? []).find(r => r.agentId === 'execution-engine');
  const executionSeen = !!executionRun || hasLine('execution intent detected');
  const executionEnabled = selectedAgents['execution-engine'];
  const executionSkipped = !executionSeen && !isLoading;
  const synthesisStarted = hasLine('synthesizing answer') || !!currentResult?.orchestratorOutput;
  const runDone = !!currentResult?.orchestratorOutput && !isLoading;

  const pipelineStages: PipelineStage[] = [
    {
      id: 'reasoning',
      label: 'Reasoning',
      state: runDone || hasLine('reasoning about your query') ? 'completed' : 'running',
    },
    {
      id: 'planning',
      label: 'Orchestrating',
      state: runDone || hasLine('dividing work across') || hasLine('orchestrating parallel research') || hasLine('discovering local players') || hasLine('planner locked') || hasLine('planner found no local') ? 'completed' : hasLine('starting orchestration') || hasLine('discovering local') ? 'running' : 'pending',
    },
    {
      id: 'research',
      label: 'Research Swarm',
      state: researchFailed ? 'failed' : researchTerminal || runDone ? 'completed' : researchRunning || hasLine('parallel research') ? 'running' : 'pending',
    },
    {
      id: 'execution',
      label: 'Execution Engine',
      state: executionRun?.status === 'failed'
        ? 'failed'
        : executionRun?.status === 'completed'
          ? 'completed'
          : executionRun?.status === 'running'
            ? 'running'
            : executionSkipped || !executionEnabled
              ? 'completed'
              : executionSeen
                ? 'running'
                : 'pending',
    },
    {
      id: 'synthesis',
      label: 'Synthesis',
      state: runDone ? 'completed' : synthesisStarted ? 'running' : 'pending',
    },
  ];

  const expandedOutput = expandedDomain ? getOutputForDomain(expandedDomain) : null;
  const visibleTabDomains = ALL_DOMAINS.filter(d => {
    const run = getRunForDomain(d);
    const output = getOutputForDomain(d);
    return !!run || !!output || d === 'mirofish';
  });

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
      <aside
        className="sidebar-transition flex-shrink-0 flex flex-col h-full relative"
        style={{
          width: sidebarCollapsed ? '0px' : '300px',
          minWidth: sidebarCollapsed ? '0px' : '300px',
          background: `linear-gradient(160deg, ${cardBg} 0%, ${cardBg2} 68%, ${cardBg} 100%)`,
          borderRight: sidebarCollapsed ? 'none' : `1px solid ${borderC}`,
          boxShadow: sidebarCollapsed ? 'none' : (isDark ? '0 16px 40px rgba(0,0,0,0.45)' : '0 16px 40px rgba(15,23,42,0.12)'),
          // Keep overflow visible so the collapse/expand button is still reachable
          // even when width is 0.
          overflow: 'visible',
        }}
      >

        {/* Collapse/Expand toggle */}
        <button
          onClick={() => setSidebarCollapsed(prev => !prev)}
          className="sidebar-collapse-btn"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            right: sidebarCollapsed ? '-36px' : '-14px',
          }}
        >
          {sidebarCollapsed ? <PanelLeft size={14} style={{ color: textMuted }} /> : <PanelLeftClose size={14} style={{ color: textMuted }} />}
        </button>

        <div
          className="flex flex-col h-full"
          style={{
            width: '300px',
            opacity: sidebarCollapsed ? 0 : 1,
            transition: 'opacity 0.2s ease',
            overflow: 'hidden',
          }}
        >

          {/* Logo */}
          <div className="px-5 pt-5 pb-4" style={{ borderBottom: `1px solid ${borderC}` }}>
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gradient-signature">
                <Sparkles size={14} color="#fff" />
              </div>
              <div>
                <span className="text-base font-bold tracking-tight" style={{ color: textMain }}>Veracity</span>
                <p className="text-[10px] font-mono leading-none" style={{ color: textSubtle }}>growth intelligence</p>
              </div>
            </div>
          </div>

          {/* New query */}
          <div className="px-3 pt-3 pb-2.5">
            <button
              onClick={() => { handleNewQuery(); }}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all focus-ring"
              style={{
                background: 'linear-gradient(135deg, rgba(0,112,243,0.1), rgba(77,124,255,0.05))',
                border: `1px solid rgba(0,112,243,0.2)`,
                color: '#0070f3',
              }}
              onMouseEnter={e => { const b = e.currentTarget; b.style.background = 'linear-gradient(135deg, rgba(0,112,243,0.15), rgba(77,124,255,0.08))'; b.style.borderColor = 'rgba(0,112,243,0.35)'; }}
              onMouseLeave={e => { const b = e.currentTarget; b.style.background = 'linear-gradient(135deg, rgba(0,112,243,0.1), rgba(77,124,255,0.05))'; b.style.borderColor = 'rgba(0,112,243,0.2)'; }}
            >
              <Plus size={14} /> New query
            </button>
          </div>

          {/* ─ Agents panel ─ */}
          <div className="px-3 pb-3">
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${borderC}`, background: isDark ? '#0d0d0d' : '#fafafa' }}>
              <div className="px-3 py-3 flex flex-col gap-2" style={{ borderBottom: `1px solid ${borderC}` }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Layers size={12} style={{ color: textSubtle }} />
                    <span className="text-[11px] font-mono font-bold uppercase tracking-widest" style={{ color: textSubtle }}>
                      Agents
                    </span>
                  </div>
                  {isLoading && totalCount > 0 && (
                    <span className="text-[10px] font-mono flex items-center gap-1" style={{ color: textMuted }}>
                      <RefreshCw size={9} className="animate-spin" /> {completedCount}/{totalCount}
                    </span>
                  )}
                  {hasResult && !isLoading && (
                    <span className="text-[10px] font-mono font-semibold" style={{ color: '#10b981' }}>{completedCount}/{totalCount}</span>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono" style={{ color: textSubtle }}>
                    {selectedAgentIds.length}/{ALL_DOMAINS.length} selected
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const newState = allSelected
                        ? Object.fromEntries(ALL_DOMAINS.map(d => [d, false])) as Record<Domain, boolean>
                        : Object.fromEntries(ALL_DOMAINS.map(d => [d, d !== 'mirofish-live'])) as Record<Domain, boolean>;
                      setSelectedAgents(newState);
                    }}
                    className={`select-all-btn font-mono flex items-center gap-1 ${allSelected ? 'all-selected' : ''}`}
                  >
                    <CheckCheck size={10} />
                    {allSelected ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              </div>
              <div className="py-1.5 px-1.5 flex flex-col gap-0.5">
                {ALL_DOMAINS.map(d => (
                  <SidebarAgentRow
                    key={d}
                    domain={d}
                    run={getRunForDomain(d)}
                    selected={selectedAgents[d]}
                    onToggle={() => setSelectedAgents(prev => ({ ...prev, [d]: !prev[d] }))}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Recent sessions */}
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${borderC}`, background: isDark ? '#0d0d0d' : '#fafafa' }}>
              <div className="px-3 py-2.5 flex items-center justify-between" style={{ borderBottom: `1px solid ${borderC}` }}>
                <div className="flex items-center gap-1.5">
                  <History size={12} style={{ color: textSubtle }} />
                  <span className="text-[11px] font-mono font-bold uppercase tracking-widest" style={{ color: textSubtle }}>Recent</span>
                </div>
                {sessions.length > 0 && (
                  <span className="text-[10px] font-mono" style={{ color: textSubtle }}>{sessions.length}</span>
                )}
              </div>
              <div className="py-1.5 px-1.5">
                {loadingSessions ? (
                  <div className="px-2 py-3 flex flex-col gap-2">
                    <div className="h-3 rounded skeleton w-4/5" />
                    <div className="h-3 rounded skeleton w-3/5" style={{ animationDelay: '0.2s' }} />
                    <div className="h-3 rounded skeleton w-2/3" style={{ animationDelay: '0.4s' }} />
                  </div>
                ) : sessions.length > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    {sessions.slice(0, 10).map((session) => (
                      <div
                        key={session.id}
                        className={`session-item group relative flex items-center cursor-pointer ${currentSessionId === session.id ? 'active' : ''}`}
                        onClick={() => { loadSession(session.id); }}
                      >
                        <div className="flex-1 min-w-0 pr-6">
                          <p className="text-[12px] font-medium truncate" style={{
                            color: currentSessionId === session.id ? textMain : textMuted,
                          }}>
                            {session.title}
                          </p>
                          {session.created_at && (
                            <p className="text-[9px] font-mono mt-0.5" style={{ color: textSubtle }}>
                              {new Date(session.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            await deleteSession(session.id);
                            if (currentSessionId === session.id) {
                              handleNewQuery();
                            }
                            await refreshSessions();
                          }}
                          className="absolute right-1.5 w-6 h-6 rounded-md flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10"
                          style={{ color: '#ef4444' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(239,68,68,0.1)'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                          title="Delete session"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-3 py-4 text-center">
                    <p className="text-[11px]" style={{ color: textSubtle }}>No sessions yet</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 flex items-center gap-2" style={{ borderTop: `1px solid ${borderC}` }}>
            <div className="live-dot" />
            <span className="text-[10px] font-mono" style={{ color: textSubtle }}>live · sourced · grounded</span>
          </div>
        </div>
      </aside>

      {/* ═══════════════════════════════════ MAIN ══ */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">

        {/* ── Header ── */}
        <header className="shrink-0 flex flex-col gap-0 z-20"
          style={{ background: headerBg, borderBottom: `1px solid ${borderC}`, backdropFilter: 'blur(12px)' }}>

          {/* Top bar with stats & user */}
          <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-2">
            {sidebarCollapsed && (
              <div className="flex items-center gap-2 mr-2">
                <div className="w-6 h-6 rounded-md flex items-center justify-center bg-gradient-signature">
                  <Sparkles size={11} color="#fff" />
                </div>
                <span className="text-sm font-bold tracking-tight" style={{ color: textMain }}>Veracity</span>
              </div>
            )}
            <div className="flex items-center gap-3 text-[11px] font-mono" style={{ color: textMuted }}>
              <span className="flex items-center gap-1.5"><Activity size={11} style={{ color: textSubtle }} /> &lt;5 min</span>
              <span className="hidden sm:flex items-center gap-1.5"><Shield size={11} style={{ color: textSubtle }} /> sourced</span>
              <span className="hidden sm:flex items-center gap-1.5"><Zap size={11} style={{ color: textSubtle }} /> 16+ signals</span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              {selectedAgents.mirofish && (
                <span className="shrink-0 hidden lg:flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded"
                  style={{ color: '#06b6d4', background: 'rgba(6,182,212,0.1)', border: '1px solid rgba(6,182,212,0.3)' }}>
                  {mirofishRunning ? <RefreshCw size={10} className="animate-spin" /> : <Fish size={10} />} forecast
                </span>
              )}
              {selectedAgents['mirofish-live'] && (
                <span className="shrink-0 hidden lg:flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded"
                  style={{ color: '#10b981', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}>
                  <Fish size={10} /> live VPS
                </span>
              )}
              <button
                onClick={toggleTheme}
                className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors shrink-0"
                style={{ border: `1px solid ${borderC}`, background: isDark ? '#1a1a1a' : '#f0f0f0', color: textMuted }}
                title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {isDark ? <Sun size={14} /> : <Moon size={14} />}
              </button>
              <div className="relative shrink-0">
                <button onClick={() => setShowUserMenu(v => !v)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold transition-opacity hover:opacity-80"
                  style={{ background: '#0070f3', color: '#fff' }}>
                  {userEmail ? userEmail[0].toUpperCase() : <User size={13} />}
                </button>
                {showUserMenu && (
                  <div className="absolute right-0 top-10 w-52 rounded-xl py-1 z-50"
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
            </div>
          </div>

          {/* Top-level view tabs (intelligence / usage / strategy) */}
          <div
            className="flex flex-wrap items-center gap-1.5 px-4 md:px-6 border-t"
            style={{ borderColor: borderC, paddingTop: 6, paddingBottom: 6 }}
          >
            {[
              { id: 'intelligence' as const, label: 'Intelligence', icon: <Sparkles size={12} /> },
              { id: 'usage' as const, label: 'API usage', icon: <BarChart3 size={12} /> },
              { id: 'steal' as const, label: 'Steal strategy', icon: <Crosshair size={12} /> },
              { id: 'workspace' as const, label: 'Workspace', icon: <Bookmark size={12} /> },
              { id: 'shared' as const, label: 'Shared', icon: <Users size={12} /> },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setTopTab(tab.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                style={{
                  color: topTab === tab.id ? textMain : textMuted,
                  background: topTab === tab.id ? (isDark ? 'rgba(0,112,243,0.12)' : 'rgba(0,112,243,0.08)') : 'transparent',
                  border: topTab === tab.id ? '1px solid rgba(0,112,243,0.25)' : '1px solid transparent',
                }}
              >
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* Search bar — only on Intelligence tab */}
          {topTab === 'intelligence' && (
          <div className="px-4 md:px-6 pb-4 pt-1">
            {attachedImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {attachedImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img src={img.dataUrl} alt={img.name} className="h-10 w-10 object-cover rounded-lg" style={{ border: `1px solid ${borderC}` }} />
                    <button onClick={() => setAttachedImages(prev => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ background: isDark ? '#333' : '#666', color: '#fff' }}>
                      <X size={9} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="query-bar-glow relative flex items-end rounded-xl transition-all"
              style={{
                border: `1.5px solid ${borderC}`,
                background: isDark ? 'rgba(22,22,22,0.9)' : 'rgba(255,255,255,0.95)',
                boxShadow: isDark ? '0 2px 12px rgba(0,0,0,0.3)' : '0 2px 12px rgba(0,0,0,0.06)',
              }}>
              <Search size={16} className="absolute left-4 top-3.5 pointer-events-none" style={{ color: textSubtle }} />
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={e => { setInputValue(e.target.value); autoResizeTextarea(); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(inputValue);
                  }
                }}
                placeholder="Ask a growth intelligence question…"
                className="query-textarea w-full pl-11 pr-[90px] py-3 bg-transparent outline-none font-sans"
                style={{ color: textMain }}
                disabled={isLoading}
                rows={1}
              />
              <div className="absolute right-3 bottom-2.5 flex items-center gap-1.5">
                <button onClick={() => fileInputRef.current?.click()}
                  className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                  style={{ color: textSubtle }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = textMain; (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = textSubtle; (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
                  <Paperclip size={15} />
                </button>
                <button
                  onClick={() => handleSend(inputValue)}
                  disabled={(!inputValue.trim() && attachedImages.length === 0) || isLoading}
                  className="flex items-center justify-center w-8 h-8 rounded-lg text-[13px] font-medium transition-all disabled:opacity-30"
                  style={{ background: '#0070f3', color: '#fff' }}
                  onMouseEnter={e => { if (!(e.currentTarget as HTMLButtonElement).disabled) (e.currentTarget as HTMLButtonElement).style.background = '#0060df'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = '#0070f3'; }}
                >
                  {isLoading
                    ? <RefreshCw size={14} className="animate-spin" />
                    : <Send size={14} />}
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
            </div>
          </div>
          )}
        </header>

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto grid-bg" style={{ padding: 'clamp(16px, 3vw, 32px)' }}>
          <div className="flex flex-col gap-7 max-w-[1400px] w-full mx-auto">

            {topTab === 'usage' && (
              <ApiUsagePanel
                lastMetrics={currentResult?.orchestratorOutput?.metrics}
                lastLive={currentResult?.liveMetrics}
                sessionTotals={sessionUsage}
              />
            )}

            {topTab === 'steal' && (
              <StealStrategyPanel
                state={stealState}
                onChange={patchStealState}
                savedKeys={workspaceSavedKeys}
                onSaved={key => setWorkspaceSavedKeys(prev => new Set(prev).add(key))}
              />
            )}

            {topTab === 'workspace' && <WorkspacePanel />}

            {topTab === 'shared' && <SharedWorkspacePanel />}

            {topTab === 'intelligence' && (
            <>

            {/* Empty state */}
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-6">
                <div>
                  <h2 className="empty-heading mb-2">
                    Growth Intelligence
                  </h2>
                  <p className="text-[13px]" style={{ color: textMuted }}>
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
                      <span className="flex-1 demo-query-text">{q}</span>
                      <ChevronRight size={12} style={{ color: textSubtle, flexShrink: 0 }} />
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-2 w-full max-w-lg pt-2">
                  <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Run another product</p>
                  <button
                    onClick={() => handleSend('What should Clay build or reposition over the next six months to capture emerging demand?')}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-lg text-[13px] text-left transition-all"
                    style={{ background: cardBg2, border: `1px solid ${borderC}`, color: textMuted }}
                    onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = isDark ? '#404040' : '#aaa'; b.style.color = textMain; }}
                    onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.borderColor = borderC; b.style.color = textMuted; }}
                  >
                    <Layers size={13} style={{ color: textSubtle, flexShrink: 0 }} />
                    <span className="flex-1 demo-query-text">What should Clay build or reposition over the next six months to capture emerging demand?</span>
                    <ChevronRight size={12} style={{ color: textSubtle, flexShrink: 0 }} />
                  </button>
                </div>
              </div>
            )}

            {/* ── Agent Tabs ── */}
            {(currentResult || isLoading) && (
              <div className="rounded-xl p-5" style={{ border: `1px solid ${borderC}`, background: cardBg }}>
                <div className="flex items-center justify-between mb-5 gap-3">
                  <div className="flex flex-col gap-2 min-w-0 flex-1">
                    <p className="text-[16px] font-bold tracking-tight" style={{ color: textMain }}>
                      {recentQueries[recentQueries.length - 1] ?? 'analysing…'}
                    </p>
                    {messages.filter(m => m.role === 'user').pop()?.images && (
                      <div className="flex flex-wrap gap-2">
                        {messages.filter(m => m.role === 'user').pop()?.images?.map((img, i) => (
                          <img key={i} src={img.dataUrl} alt={img.name} className="h-10 w-10 object-cover rounded-lg" style={{ border: `1px solid ${borderC}` }} />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1.5">
                      {ALL_DOMAINS.map(d => {
                        const s = getRunForDomain(d)?.status ?? 'idle';
                        const m = DOMAIN_META[d];
                        return (
                          <div key={d} className="w-2.5 h-2.5 rounded-full transition-all"
                            style={{
                              background: s === 'completed' ? m.color : s === 'running' ? m.color : (isDark ? '#2a2a2a' : '#ddd'),
                              opacity: s === 'running' ? 1 : s === 'completed' ? 1 : 0.4,
                              boxShadow: s === 'running' ? `0 0 6px ${m.color}55` : 'none',
                            }}
                          />
                        );
                      })}
                    </div>
                    {totalCount > 0 && (
                      <span className="text-[11px] font-mono font-semibold" style={{ color: textSubtle }}>
                        {completedCount}/{Math.max(totalCount, 6)}
                      </span>
                    )}
                  </div>
                </div>

                {isLoading && orchLogLen > 0 && (
                  <div className="mb-4 rounded-lg px-3 py-3" style={{ background: cardBg2, border: `1px solid ${borderC}` }}>
                    <div className="flex items-center gap-1.5 mb-2 text-[10px] font-mono uppercase tracking-widest" style={{ color: textSubtle }}>
                      <Activity size={11} className="shrink-0 animate-pulse" />
                      <span>Pipeline</span>
                    </div>
                    <div className="overflow-x-auto pb-1">
                      <div className="min-w-[620px] flex items-center gap-2.5">
                        {pipelineStages.map((stage, i) => {
                          const stateColor = stage.state === 'failed'
                            ? '#ef4444'
                            : stage.state === 'completed'
                              ? '#10b981'
                              : stage.state === 'running'
                                ? '#0070f3'
                                : textSubtle;
                          const fill = stage.state === 'completed' ? '100%' : stage.state === 'running' ? '62%' : '0%';
                          return (
                            <React.Fragment key={stage.id}>
                              <div className="flex flex-col items-center gap-1.5 min-w-[108px]">
                                <div
                                  className="relative w-8 h-8 rounded-full overflow-hidden"
                                  style={{
                                    border: `1.5px solid ${stage.state === 'pending' ? borderC : stateColor}`,
                                    background: stage.state === 'pending' ? 'transparent' : `${stateColor}22`,
                                    boxShadow: stage.state === 'running' ? `0 0 0 1px ${stateColor}33, 0 0 10px ${stateColor}44` : 'none',
                                  }}
                                >
                                  <div
                                    className={stage.state === 'running' ? 'animate-pulse' : ''}
                                    style={{
                                      position: 'absolute',
                                      left: 0,
                                      bottom: 0,
                                      width: '100%',
                                      height: fill,
                                      background: `linear-gradient(180deg, ${stateColor}88 0%, ${stateColor}cc 100%)`,
                                      transition: 'height 500ms ease',
                                    }}
                                  />
                                  <span className="absolute inset-0 flex items-center justify-center text-[11px] font-mono font-bold" style={{ color: stage.state === 'pending' ? textSubtle : '#fff' }}>
                                    {i + 1}
                                  </span>
                                </div>
                                <span className="text-[10px] font-mono uppercase tracking-wide text-center leading-tight" style={{ color: stage.state === 'pending' ? textSubtle : textMain }}>
                                  {stage.label}
                                </span>
                              </div>
                              {i < pipelineStages.length - 1 && (
                                <div className="relative h-2.5 w-12 rounded-full overflow-hidden" style={{ border: `1px solid ${borderC}`, background: isDark ? '#151515' : '#f4f4f5' }}>
                                  <div
                                    className={stage.state === 'running' ? 'animate-pulse' : ''}
                                    style={{
                                      height: '100%',
                                      width: stage.state === 'pending' ? '0%' : stage.state === 'running' ? '55%' : '100%',
                                      background: `linear-gradient(90deg, ${stateColor}99 0%, ${stateColor}dd 100%)`,
                                      transition: 'width 450ms ease',
                                    }}
                                  />
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2.5">
                  {visibleTabDomains.map(domain => {
                    const run = getRunForDomain(domain);
                    const output = getOutputForDomain(domain);
                    const isActive = expandedDomain === domain;
                    const status = run?.status ?? (output ? 'completed' : 'idle');
                    const meta = DOMAIN_META[domain];
                    return (
                      <button
                        key={domain}
                        onClick={() => setExpandedDomain(domain)}
                        className="px-3.5 py-2.5 rounded-lg text-left transition-all border min-w-[140px]"
                        style={{
                          borderColor: isActive ? meta.color : borderC,
                          background: isActive ? (isDark ? meta.bg : meta.bgLight) : cardBg2,
                          boxShadow: isActive ? `0 0 0 1px ${meta.color}33, 0 4px 12px ${meta.color}15` : 'none',
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <span style={{ color: isActive ? meta.color : textSubtle }}>{meta.icon}</span>
                            <span className="text-[11px] font-mono font-bold uppercase tracking-wide" style={{ color: isActive ? meta.color : textMuted }}>
                              {meta.short}
                            </span>
                          </div>
                          {status === 'running' && <RefreshCw size={11} className="animate-spin" style={{ color: meta.color }} />}
                          {status === 'completed' && <CheckCircle2 size={12} style={{ color: '#10b981' }} />}
                          {status === 'failed' && <AlertCircle size={11} style={{ color: '#ef4444' }} />}
                        </div>
                        <p className="text-[10px] font-mono mt-1.5 uppercase tracking-wider font-medium" style={{
                          color: status === 'completed' ? '#10b981' : status === 'running' ? meta.color : textSubtle,
                        }}>
                          {status}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Expanded domain ── */}
            {expandedDomain && (
              <div className="rounded-xl overflow-hidden" style={{
                border: `1.5px solid ${DOMAIN_META[expandedDomain].border}`,
                background: cardBg,
                boxShadow: `0 0 0 1px ${DOMAIN_META[expandedDomain].color}1a, 0 8px 24px ${DOMAIN_META[expandedDomain].color}08`,
              }}>
                <div className="flex items-center justify-between px-5 py-4"
                  style={{ borderBottom: `1px solid ${borderC}`, background: isDark ? DOMAIN_META[expandedDomain].bg : DOMAIN_META[expandedDomain].bgLight }}>
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                      style={{ background: DOMAIN_META[expandedDomain].bg, border: `1px solid ${DOMAIN_META[expandedDomain].border}` }}>
                      <span style={{ color: DOMAIN_META[expandedDomain].color }}>{DOMAIN_META[expandedDomain].icon}</span>
                    </div>
                    <span className="text-[15px] font-bold tracking-tight" style={{ color: textMain }}>
                      {DOMAIN_META[expandedDomain].label}
                    </span>
                    {expandedOutput && <ConfidenceBadge level={expandedOutput.confidence} />}
                    <span className="text-[9px] font-mono font-semibold uppercase tracking-widest px-2 py-0.5 rounded-full"
                      style={{ color: DOMAIN_META[expandedDomain].color, background: DOMAIN_META[expandedDomain].bg, border: `1px solid ${DOMAIN_META[expandedDomain].border}` }}>
                      live
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {expandedOutput && (
                      <AddToWorkspaceButton
                        output={expandedOutput}
                        product={currentResult?.orchestratorOutput?.product ?? ''}
                        competitor={currentResult?.orchestratorOutput?.competitor ?? null}
                        title={`${DOMAIN_META[expandedDomain].short}${currentResult?.orchestratorOutput?.product ? ` · ${currentResult.orchestratorOutput.product}` : ''}`}
                        sessionId={currentSessionId}
                        messageId={currentResult?.persistedId ?? null}
                        savedKeys={workspaceSavedKeys}
                        onSaved={key => setWorkspaceSavedKeys(prev => new Set(prev).add(key))}
                      />
                    )}
                    <button onClick={() => setExpandedDomain(null)}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: textMuted }}
                      onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = isDark ? '#1a1a1a' : '#f0f0f0'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}>
                      <X size={15} />
                    </button>
                  </div>
                </div>

                <div className="p-6 lg:p-8 flex flex-col gap-7">
                  {expandedOutput ? (
                    <ArtifactRenderer
                      output={expandedOutput}
                      product={currentResult?.orchestratorOutput?.product ?? ''}
                      sessionId={currentSessionId}
                      messageId={currentResult?.persistedId ?? null}
                      onRefined={handleExecutionPlanRefined}
                    />
                  ) : isLoading ? (
                    <div className="rounded-xl p-6 flex flex-col gap-3" style={{ border: `1px solid ${borderC}`, background: cardBg2 }}>
                      <Sk className="h-4 w-40" />
                      <Sk className="h-40 w-full rounded-lg" delay={0.1} />
                      <Sk className="h-3 w-full" delay={0.15} />
                      <Sk className="h-3 w-5/6" delay={0.2} />
                      <Sk className="h-3 w-2/3" delay={0.25} />
                      <div className="grid grid-cols-2 gap-3 mt-2">
                        <Sk className="h-16 w-full rounded-lg" delay={0.3} />
                        <Sk className="h-16 w-full rounded-lg" delay={0.35} />
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl p-6" style={{ border: `1px solid ${borderC}`, background: cardBg2 }}>
                      <p className="text-sm font-bold mb-2" style={{ color: textMain }}>
                        {DOMAIN_META[expandedDomain].short} details are loading
                      </p>
                      <p className="text-[13px] leading-relaxed" style={{ color: textMuted }}>
                        This agent is still running or returned no structured artifact yet. Try rerunning with MiroFish enabled and a forecast-style prompt.
                      </p>
                    </div>
                  )}

                  {expandedOutput && expandedOutput.facts.filter(f => !f.startsWith('[')).length > 0 && (
                    <div className="rounded-lg p-5" style={{ background: isDark ? 'rgba(16,185,129,0.04)' : 'rgba(16,185,129,0.03)', border: `1px solid rgba(16,185,129,0.15)` }}>
                      <p className="text-[11px] font-mono font-bold uppercase tracking-widest mb-4 flex items-center gap-2" style={{ color: '#10b981' }}>
                        <CheckCircle2 size={13} /> Key Facts
                      </p>
                      <ul className="flex flex-col gap-3">
                        {expandedOutput.facts.filter(f => !f.startsWith('[')).map((f, i) => (
                          <li key={i} className="flex items-start gap-3 text-[13.5px] leading-relaxed" style={{ color: isDark ? '#d4d4d4' : '#404040' }}>
                            <span className="font-mono mt-0.5 shrink-0 font-bold" style={{ color: '#10b981' }}>✓</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {expandedOutput && expandedOutput.interpretation.length > 0 && (
                    <div className="rounded-lg p-5" style={{ background: isDark ? 'rgba(0,112,243,0.04)' : 'rgba(0,112,243,0.03)', border: `1px solid rgba(0,112,243,0.12)` }}>
                      <p className="text-[11px] font-mono font-bold uppercase tracking-widest mb-4 flex items-center gap-2" style={{ color: '#0070f3' }}>
                        <Activity size={13} /> Analysis
                      </p>
                      <ul className="flex flex-col gap-3">
                        {expandedOutput.interpretation.map((interp, i) => (
                          <li key={i} className="flex items-start gap-3 text-[13.5px] leading-relaxed" style={{ color: isDark ? '#d4d4d4' : '#404040' }}>
                            <span className="font-mono mt-0.5 shrink-0 font-bold" style={{ color: '#0070f3' }}>›</span>
                            <span>{interp}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Result skeletons (YouTube-style) while pipeline runs ── */}
            {isLoading && !currentResult?.content && (
              <ResultCardsSkeleton
                borderC={borderC}
                cardBg={cardBg}
                cardBg2={cardBg2}
                textMuted={textMuted}
              />
            )}

            {/* ── Summary card ── */}
            {currentResult?.content && (
              <div className="rounded-lg overflow-hidden result-reveal" style={{ border: `1px solid ${borderC}`, background: cardBg, animationDelay: '0ms' }}>
                <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${borderC}` }}>
                  <div className="flex items-center gap-2">
                    <Layers size={14} style={{ color: '#0070f3' }} />
                    <span className="text-[12px] font-mono font-semibold uppercase tracking-widest" style={{ color: textMuted }}>
                      Intelligence Summary
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Cost + latency + agent count metrics.
                        Prefers the authoritative RunMetrics on the final result;
                        falls back to live streamed metrics while agents are still
                        running so the demo judge always sees numbers moving. */}
                    {(() => {
                      const final = currentResult.orchestratorOutput?.metrics;
                      const live = currentResult.liveMetrics;
                      if (!final && !live) return null;
                      const latencyMs = final?.totalLatencyMs ?? live?.elapsedMs ?? 0;
                      const cost = final?.estimatedCostUsd ?? live?.estimatedCostUsd ?? 0;
                      const agentTotal = final?.agentCount ?? live?.agentCount ?? 0;
                      const agentDone = final?.completedAgentCount ?? live?.completedAgentCount ?? 0;
                      const geminiCalls = final?.geminiCallCount ?? live?.geminiCallCount ?? 0;
                      const toolCalls = final?.toolCallCount ?? live?.toolCallCount ?? 0;
                      const searchCalls = final?.searchCallCount;
                      const scrapeCalls = final?.scrapeCallCount;
                      const localEntities = final?.localEntityCount;
                      const isLive = !final && !!live;
                      return (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded flex items-center gap-2"
                          style={{ color: textSubtle, background: cardBg2, border: `1px solid ${borderC}` }}>
                          {isLive && <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: '#f59e0b' }} />}
                          <span title="Wall-clock latency">{(latencyMs / 1000).toFixed(1)}s</span>
                          <span style={{ opacity: 0.3 }}>|</span>
                          <span title="Estimated cost">${cost.toFixed(4)}</span>
                          <span style={{ opacity: 0.3 }}>|</span>
                          <span title="Agents completed / dispatched">{agentDone}/{agentTotal} agents</span>
                          <span style={{ opacity: 0.3 }}>|</span>
                          <span title="Model calls">{isLive ? `~${geminiCalls}` : geminiCalls} calls</span>
                          <span style={{ opacity: 0.3 }}>|</span>
                          <span title="External tool invocations">{isLive ? `~${toolCalls}` : toolCalls} tools</span>
                          {typeof searchCalls === 'number' && typeof scrapeCalls === 'number' && (
                            <>
                              <span style={{ opacity: 0.3 }}>|</span>
                              <span title="Search vs scrape ratio">{searchCalls} search / {scrapeCalls} scrape</span>
                            </>
                          )}
                          {typeof localEntities === 'number' && (
                            <>
                              <span style={{ opacity: 0.3 }}>|</span>
                              <span title="Local entities from research planner">{localEntities} local</span>
                            </>
                          )}
                        </span>
                      );
                    })()}
                    {currentResult.orchestratorOutput?.product && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded"
                        style={{ color: '#0070f3', background: 'rgba(0,112,243,0.1)', border: '1px solid rgba(0,112,243,0.2)' }}>
                        {currentResult.orchestratorOutput.product}
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-6 lg:p-8 flex flex-col gap-8">
                  <p className="prose-answer result-reveal" style={{ animationDelay: '40ms' }}>{currentResult.content}</p>

                  {(() => {
                    const refinement = currentResult.orchestratorOutput?.refinement;
                    const sourceMix = buildSourceMix(currentResult.orchestratorOutput?.outputs ?? []);
                    const researchRuns = (currentResult.agentRuns ?? []).filter(r => ['market-trends', 'competitive', 'win-loss', 'pricing', 'positioning', 'adjacent'].includes(r.agentId));
                    const executionRun = (currentResult.agentRuns ?? []).find(r => r.agentId === 'execution-engine');
                    const researchDone = researchRuns.filter(r => r.status === 'completed').length;
                    const researchFailed = researchRuns.filter(r => r.status === 'failed').length;
                    return (
                      <div className="flex flex-col gap-3 rounded-lg p-4" style={{ background: cardBg2, border: `1px solid ${borderC}` }}>
                        <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wider" style={{ color: textSubtle }}>
                          <span>Phases</span>
                          <span className="px-2 py-0.5 rounded-full" style={{ color: researchDone + researchFailed >= 6 ? '#10b981' : '#0070f3', background: researchDone + researchFailed >= 6 ? 'rgba(16,185,129,0.08)' : 'rgba(0,112,243,0.08)', border: `1px solid ${researchDone + researchFailed >= 6 ? 'rgba(16,185,129,0.2)' : 'rgba(0,112,243,0.2)'}` }}>
                            research {researchDone}/{Math.max(researchRuns.length, 6)}{researchFailed > 0 ? ` · ${researchFailed} failed` : ''}
                          </span>
                          <span className="px-2 py-0.5 rounded-full" style={{ color: executionRun?.status === 'completed' ? '#10b981' : executionRun?.status === 'running' ? '#0070f3' : textSubtle, background: executionRun?.status === 'completed' ? 'rgba(16,185,129,0.08)' : executionRun?.status === 'running' ? 'rgba(0,112,243,0.08)' : 'transparent', border: `1px solid ${executionRun?.status === 'completed' ? 'rgba(16,185,129,0.2)' : executionRun?.status === 'running' ? 'rgba(0,112,243,0.2)' : borderC}` }}>
                            execution {executionRun?.status ?? 'idle'}
                          </span>
                          <span className="px-2 py-0.5 rounded-full" style={{ color: refinement ? '#10b981' : textSubtle, background: refinement ? 'rgba(16,185,129,0.08)' : 'transparent', border: `1px solid ${refinement ? 'rgba(16,185,129,0.2)' : borderC}` }}>
                            refinement {refinement ? 'applied' : 'idle'}
                          </span>
                        </div>

                        {sourceMix.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono" style={{ color: textSubtle }}>
                            <span className="uppercase tracking-wider">Source mix</span>
                            {sourceMix.map(({ tool, count }) => (
                              <span key={tool} className="px-2 py-0.5 rounded-full" style={{ color: '#0070f3', background: 'rgba(0,112,243,0.08)', border: '1px solid rgba(0,112,243,0.2)' }}>
                                {tool} × {count}
                              </span>
                            ))}
                          </div>
                        )}

                        {refinement && refinement.deltas.length > 0 && (
                          <div className="rounded-md p-3" style={{ background: cardBg, border: `1px solid ${borderC}` }}>
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                              <div>
                                <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: textSubtle }}>Before / after refinement</p>
                                <p className="text-[11px] mt-1" style={{ color: textMuted }}>{refinement.feedbackApplied.variantResults} variant results, {refinement.feedbackApplied.recommendationFeedback} ratings, {refinement.feedbackApplied.recommendationActions} actions</p>
                              </div>
                              {refinement.focus && <span className="text-[10px] font-mono px-2 py-0.5 rounded-full" style={{ color: '#0070f3', background: 'rgba(0,112,243,0.08)', border: '1px solid rgba(0,112,243,0.2)' }}>{refinement.focus}</span>}
                            </div>
                            <div className="flex flex-col gap-2">
                              {refinement.deltas.slice(0, 3).map(delta => (
                                <div key={`${delta.domain}-${delta.summary}`} className="rounded-md p-2.5" style={{ background: cardBg2, border: `1px solid ${borderC}` }}>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: '#0070f3' }}>{delta.domain}</span>
                                    {delta.beforeConfidence && <ConfidenceBadge level={delta.beforeConfidence} />}
                                    <ArrowUpRight size={10} style={{ color: textSubtle, transform: 'rotate(45deg)' }} />
                                    {delta.afterConfidence && <ConfidenceBadge level={delta.afterConfidence} />}
                                  </div>
                                  <p className="text-[11px] mt-1" style={{ color: textMuted }}>{delta.summary}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {currentResult.orchestratorOutput?.outputs?.length ? (
                    <div className="result-reveal" style={{ animationDelay: '100ms' }}>
                      <p className="text-[11px] font-mono font-bold uppercase tracking-widest mb-4 flex items-center gap-2" style={{ color: textSubtle }}>
                        <Layers size={13} /> Domain Highlights
                      </p>
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {currentResult.orchestratorOutput.outputs
                          .filter(o => o.artifactType !== 'mind-map')
                          .slice(0, 6)
                          .map((o, i) => {
                            const domainMeta = DOMAIN_META[o.domain as Domain];
                            return (
                              <div key={`${o.domain}-${i}`} className="rounded-xl p-4 transition-all result-reveal"
                                style={{
                                  background: cardBg2,
                                  border: `1px solid ${borderC}`,
                                  borderLeft: `3px solid ${domainMeta?.color ?? borderC}`,
                                  animationDelay: `${120 + i * 70}ms`,
                                }}>
                                <div className="flex items-center justify-between mb-2.5">
                                  <div className="flex items-center gap-1.5">
                                    {domainMeta && <span style={{ color: domainMeta.color }}>{domainMeta.icon}</span>}
                                    <span className="text-[12px] font-mono font-bold uppercase tracking-wide" style={{ color: domainMeta?.color ?? textSubtle }}>
                                      {domainMeta?.short ?? o.domain}
                                    </span>
                                  </div>
                                  <ConfidenceBadge level={o.confidence} />
                                </div>
                                <p className="text-[13px] leading-relaxed font-medium" style={{ color: isDark ? '#d4d4d4' : '#333' }}>
                                  {o.interpretation?.[0] || o.facts?.[0] || 'No highlight available.'}
                                </p>
                                {o.sources?.length ? (
                                  <div className="flex flex-wrap gap-1.5 mt-3 pt-2.5" style={{ borderTop: `1px solid ${borderC}` }}>
                                    {o.sources.slice(0, 2).map(source => (
                                      <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer"
                                        className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-md transition-colors"
                                        style={{ color: textMuted, background: cardBg, border: `1px solid ${borderC}` }}>
                                        {source.title} <ArrowUpRight size={8} />
                                      </a>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  ) : null}

                  {/* Recommendations */}
                  {currentResult.recommendations && currentResult.recommendations.length > 0 && (
                    <div className="result-reveal" style={{ animationDelay: '280ms' }}>
                      <p className="text-[11px] font-mono font-bold uppercase tracking-widest mb-4 flex items-center gap-2" style={{ color: textSubtle }}>
                        <Rocket size={13} /> Strategic Recommendations
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {currentResult.recommendations.map((rec: any, i: number) => (
                          <div key={i} className="rounded-lg p-4 flex flex-col gap-2.5 result-reveal"
                            style={{ background: cardBg2, border: `1px solid ${borderC}`, animationDelay: `${300 + i * 70}ms` }}>
                            <div className="flex flex-wrap gap-1.5">
                              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded uppercase" style={{
                                color:   rec.priority === 'immediate' ? '#ef4444' : rec.priority === 'short-term' ? '#f59e0b' : '#3b82f6',
                                background: rec.priority === 'immediate' ? 'rgba(239,68,68,0.1)' : rec.priority === 'short-term' ? 'rgba(245,158,11,0.1)' : 'rgba(59,130,246,0.1)',
                                border: `1px solid ${rec.priority === 'immediate' ? 'rgba(239,68,68,0.25)' : rec.priority === 'short-term' ? 'rgba(245,158,11,0.25)' : 'rgba(59,130,246,0.25)'}`,
                              }}>{rec.priority ?? 'strategic'}</span>
                              <ConfidenceBadge level={rec.confidence ?? (rec.score >= 80 ? 'high' : rec.score >= 55 ? 'medium' : 'low')} />
                            </div>
                            <h4 className="rec-title">{rec.title}</h4>
                            <p className="rec-body">{rec.rationale}</p>
                            {rec.evidence?.length > 0 && (
                              <ul className="flex flex-col gap-1 mt-1">
                                {rec.evidence.map((e: string, ei: number) => (
                                  <li key={ei} className="text-[11px] flex items-start gap-1.5" style={{ color: textSubtle }}>
                                    <span className="font-mono mt-0.5 shrink-0" style={{ color: isDark ? '#333' : '#ccc' }}>›</span>{e}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {/* Feedback thumbs — fire-and-forget to /api/feedback */}
                            {currentSessionId && (() => {
                              const rk = recommendationKey(rec.title ?? '', rec.rationale ?? '');
                              const current = ratedRecs[rk];
                              const rate = (rating: RecommendationRating) => {
                                setRatedRecs(prev => ({ ...prev, [rk]: rating }));
                                rateRecommendation({
                                  sessionId: currentSessionId,
                                  title: rec.title,
                                  rationale: rec.rationale,
                                  rating,
                                });
                              };
                              return (
                                <div className="flex items-center gap-1.5 mt-1 pt-2" style={{ borderTop: `1px solid ${borderC}` }}>
                                  <button type="button" onClick={() => rate('up')} title="Useful"
                                    className="p-1 rounded transition-colors" style={{
                                      color: current === 'up' ? '#10b981' : textSubtle,
                                      background: current === 'up' ? 'rgba(16,185,129,0.12)' : 'transparent',
                                    }}>
                                    <ThumbsUp size={12} />
                                  </button>
                                  <button type="button" onClick={() => rate('down')} title="Not useful"
                                    className="p-1 rounded transition-colors" style={{
                                      color: current === 'down' ? '#ef4444' : textSubtle,
                                      background: current === 'down' ? 'rgba(239,68,68,0.12)' : 'transparent',
                                    }}>
                                    <ThumbsDown size={12} />
                                  </button>
                                  {current && (
                                    <span className="text-[9px] font-mono ml-1" style={{ color: current === 'up' ? '#10b981' : '#ef4444' }}>
                                      {current === 'up' ? 'Validated' : 'Rejected'}
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recalled evidence (RAG) */}
                  {currentResult.orchestratorOutput?.retrievedEvidence &&
                    currentResult.orchestratorOutput.retrievedEvidence.length > 0 && (
                    <div className="flex items-start gap-3 pt-4" style={{ borderTop: `1px solid ${borderC}` }}>
                      <span className="text-[10px] font-mono font-semibold uppercase tracking-widest shrink-0 mt-1" style={{ color: textSubtle }}>
                        recalled evidence
                      </span>
                      <div className="flex flex-col gap-2 w-full">
                        <span className="text-[10px] font-mono px-2 py-1 rounded w-fit"
                          style={{ color: '#6366f1', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)' }}>
                          {currentResult.orchestratorOutput.retrievedEvidence.length} prior chunk(s) — context only
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {currentResult.orchestratorOutput.retrievedEvidence.slice(0, 6).map(hit => (
                            <a
                              key={hit.id}
                              href={hit.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={hit.content.slice(0, 200)}
                              className="flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded-md transition-colors max-w-full truncate"
                              style={{ background: cardBg2, border: `1px solid ${borderC}`, color: textMuted }}
                            >
                              {hit.title || hit.url}
                              <span className="opacity-60">· {hit.ageDays}d</span>
                              <ArrowUpRight size={9} />
                            </a>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Sources */}
                  {currentResult.sources && currentResult.sources.length > 0 && (
                    <div className="flex items-start gap-3 pt-4" style={{ borderTop: `1px solid ${borderC}` }}>
                      <span className="text-[10px] font-mono font-semibold uppercase tracking-widest shrink-0 mt-1" style={{ color: textSubtle }}>sources</span>
                      <div className="flex flex-wrap gap-1.5">
                        {(currentResult.orchestratorOutput?.citations?.length
                          ? currentResult.orchestratorOutput.citations.map(c => ({
                              title: c.title,
                              url: c.url,
                              citationId: c.id,
                            }))
                          : currentResult.sources
                        ).map(source => (
                          <a key={`${source.citationId ?? ''}-${source.url}`} href={source.url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[11px] font-mono px-2.5 py-1 rounded-md transition-colors"
                            style={{ background: cardBg2, border: `1px solid ${borderC}`, color: textMuted }}
                            onMouseEnter={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color = '#0070f3'; a.style.borderColor = 'rgba(0,112,243,0.3)'; }}
                            onMouseLeave={e => { const a = e.currentTarget as HTMLAnchorElement; a.style.color = textMuted; a.style.borderColor = borderC; }}>
                            {typeof source.citationId === 'number' ? `[${source.citationId}] ` : ''}{source.title} <ArrowUpRight size={9} />
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
                        <button
                          key={sug}
                          type="button"
                          disabled={isFollowingUp || isLoading}
                          onClick={() => {
                            followUpEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            // Let the scroll start before kicking off the streamed request so the composer stays in view.
                            requestAnimationFrame(() => {
                              void handleFollowUp(sug);
                            });
                          }}
                          className="text-[12px] font-medium flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all disabled:opacity-45 disabled:pointer-events-none"
                          style={{ background: cardBg2, border: `1px solid ${borderC}`, color: textMuted }}
                          onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; if (b.disabled) return; b.style.color = '#0070f3'; b.style.borderColor = 'rgba(0,112,243,0.4)'; b.style.background = 'rgba(0,112,243,0.06)'; }}
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
                <div className="rounded-lg overflow-hidden result-reveal" style={{ border: `1px solid ${borderC}`, background: cardBg, animationDelay: '420ms' }}>
                  <div className="flex items-center justify-between gap-2 px-5 py-3.5" style={{ borderBottom: `1px solid ${borderC}` }}>
                    <div className="flex items-center gap-2">
                      <GitBranch size={14} style={{ color: '#0070f3' }} />
                      <span className="text-[12px] font-mono font-semibold uppercase tracking-widest" style={{ color: textMuted }}>
                        Mind Map
                      </span>
                    </div>
                    <AddToWorkspaceButton
                      output={mindMapOutput}
                      product={currentResult?.orchestratorOutput?.product ?? ''}
                      competitor={currentResult?.orchestratorOutput?.competitor ?? null}
                      title={`Mind Map${currentResult?.orchestratorOutput?.product ? ` · ${currentResult.orchestratorOutput.product}` : ''}`}
                      sessionId={currentSessionId}
                      messageId={currentResult?.persistedId ?? null}
                      savedKeys={workspaceSavedKeys}
                      onSaved={key => setWorkspaceSavedKeys(prev => new Set(prev).add(key))}
                    />
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
                  <p className="text-[13px] font-mono" style={{ color: textMain }}>{fu.question}</p>
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
                      <p className="followup-answer whitespace-pre-line">{fu.answer}</p>
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
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 rounded-lg px-4 py-3"
                style={{ border: `1px solid ${borderC}`, background: cardBg }}
                ref={followUpEndRef}>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <MessageSquarePlus size={14} style={{ color: textSubtle, flexShrink: 0 }} />
                  <input
                    type="text"
                    value={followUpInput}
                    onChange={e => setFollowUpInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleFollowUp(followUpInput)}
                    placeholder="Ask a follow-up…"
                    className="flex-1 text-[13px] bg-transparent outline-none min-w-0"
                    style={{ color: textMain }}
                    disabled={isFollowingUp || isLoading}
                  />
                </div>
                <button
                  onClick={() => handleFollowUp(followUpInput)}
                  disabled={!followUpInput.trim() || isFollowingUp || isLoading}
                  className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all disabled:opacity-40 shrink-0"
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
            </>
            )}

          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
