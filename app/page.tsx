'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Send, Plus, Search, ChevronRight, RefreshCw, ArrowUpRight,
  Clock, ShieldCheck, Database, LogOut, User, Layers, X,
  History, GitBranch, TrendingUp, Swords, Trophy, DollarSign, Megaphone, Telescope,
  CheckCircle2, Circle, AlertCircle, MessageSquarePlus, Paperclip, ImageIcon,
} from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import type { AgentRun, OrchestratorOutput, AgentOutput, ImageAttachment } from '@/lib/agents/types';
import { ArtifactRenderer } from '@/components/artifacts/ArtifactRenderer';

type SourceLink = { title: string; url: string };

type AttachedImage = {
  dataUrl: string;
  data: string;
  mimeType: string;
  name: string;
};

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

const DEMO_QUERIES = [
  'Is Lilian competitive in the AI SDR market right now? Where does Vector stand?',
  'Is the digital workers category accelerating or consolidating?',
  'What should Vector Agents build to capture emerging demand?',
];

const ALL_DOMAINS = ['market-trends', 'competitive', 'win-loss', 'pricing', 'positioning', 'adjacent'] as const;
type Domain = typeof ALL_DOMAINS[number];

const DOMAIN_META: Record<Domain, { label: string; shortLabel: string; icon: React.ReactNode; color: string; border: string; bg: string }> = {
  'market-trends': {
    label: 'Market & Trend Sensing',
    shortLabel: 'Market Trends',
    icon: <TrendingUp size={16} />,
    color: 'text-blue-600',
    border: 'border-blue-200',
    bg: 'bg-blue-50',
  },
  'competitive': {
    label: 'Competitive Landscape',
    shortLabel: 'Competitive',
    icon: <Swords size={16} />,
    color: 'text-violet-600',
    border: 'border-violet-200',
    bg: 'bg-violet-50',
  },
  'win-loss': {
    label: 'Win / Loss Intelligence',
    shortLabel: 'Win / Loss',
    icon: <Trophy size={16} />,
    color: 'text-emerald-600',
    border: 'border-emerald-200',
    bg: 'bg-emerald-50',
  },
  'pricing': {
    label: 'Pricing & Packaging',
    shortLabel: 'Pricing',
    icon: <DollarSign size={16} />,
    color: 'text-amber-600',
    border: 'border-amber-200',
    bg: 'bg-amber-50',
  },
  'positioning': {
    label: 'Positioning & Messaging',
    shortLabel: 'Positioning',
    icon: <Megaphone size={16} />,
    color: 'text-rose-600',
    border: 'border-rose-200',
    bg: 'bg-rose-50',
  },
  'adjacent': {
    label: 'Adjacent Market Collision',
    shortLabel: 'Adjacent',
    icon: <Telescope size={16} />,
    color: 'text-indigo-600',
    border: 'border-indigo-200',
    bg: 'bg-indigo-50',
  },
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Sidebar agent status row ──────────────────────────────────────────────────
function SidebarAgentRow({ domain, run }: { domain: Domain; run?: AgentRun }) {
  const meta = DOMAIN_META[domain];
  const status = run?.status ?? 'idle';

  return (
    <div className="flex items-center gap-2 px-1 py-1.5 rounded-lg">
      {status === 'running' && <RefreshCw size={11} className="text-amber-500 animate-spin shrink-0" />}
      {status === 'completed' && <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />}
      {status === 'failed' && <AlertCircle size={11} className="text-red-400 shrink-0" />}
      {(status === 'idle' || status === 'pending') && <Circle size={11} className="text-muted-foreground/30 shrink-0" />}

      <span className={`text-xs truncate ${
        status === 'running'   ? 'text-amber-700 font-medium' :
        status === 'completed' ? 'text-foreground' :
        status === 'failed'    ? 'text-red-500' :
        'text-muted-foreground/60'
      }`}>{meta.shortLabel}</span>

      {status === 'running' && (
        <span className="ml-auto text-[9px] font-mono text-amber-600 shrink-0">live</span>
      )}
      {status === 'completed' && (run as any)?.confidence && (
        <span className={`ml-auto text-[9px] font-mono shrink-0 ${
          (run as any).confidence === 'high'   ? 'text-emerald-600' :
          (run as any).confidence === 'medium' ? 'text-amber-600' :
          'text-muted-foreground'
        }`}>{(run as any).confidence}</span>
      )}
    </div>
  );
}

// ── Agent card in the 3×2 grid ────────────────────────────────────────────────
function AgentCard({
  domain,
  run,
  output,
  isExpanded,
  onClick,
}: {
  domain: Domain;
  run?: AgentRun;
  output?: AgentOutput;
  isExpanded: boolean;
  onClick: () => void;
}) {
  const meta = DOMAIN_META[domain];
  const status = run?.status ?? 'idle';
  const confidence = output?.confidence;
  const snippet = output?.facts?.[0] ?? output?.interpretation?.[0];
  const isClickable = !!output;

  return (
    <button
      onClick={onClick}
      disabled={!isClickable && status !== 'running'}
      className={`veracity-card p-4 flex flex-col gap-3 text-left transition-all border-t-2 ${meta.border} ${
        isExpanded ? 'ring-2 ring-offset-1 ring-accent/40' : ''
      } ${isClickable ? 'veracity-card-hover cursor-pointer' : 'cursor-default opacity-75'}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className={`flex items-center gap-1.5 min-w-0 ${meta.color}`}>
          {meta.icon}
          <span className="text-[11px] font-mono font-medium uppercase tracking-wider truncate">{meta.shortLabel}</span>
        </div>

        {status === 'running' && (
          <span className="shrink-0 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
            Live <RefreshCw size={8} className="animate-spin" />
          </span>
        )}
        {status === 'pending' && (
          <span className="shrink-0 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-amber-50/50 text-amber-600 border border-amber-200/50 flex items-center gap-1">
            Queued <RefreshCw size={8} className="animate-spin opacity-50" />
          </span>
        )}
        {status === 'completed' && confidence && (
          <span className={`shrink-0 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${
            confidence === 'high'   ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
            confidence === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' :
            'bg-muted text-muted-foreground border-border'
          }`}>{confidence}</span>
        )}
        {status === 'failed' && (
          <span className="shrink-0 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-red-50 text-red-500 border border-red-200">
            Failed
          </span>
        )}
        {status === 'idle' && (
          <span className="shrink-0 text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground/40 border border-border">
            Idle
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-[44px]">
        {status === 'running' && (
          <div className="flex flex-col gap-2">
            <div className="h-2.5 bg-muted rounded w-full animate-pulse-line" />
            <div className="h-2.5 bg-muted rounded w-4/5 animate-pulse-line" />
            <div className="h-2.5 bg-muted rounded w-2/3 animate-pulse-line" />
          </div>
        )}
        {status === 'pending' && (
          <div className="flex flex-col gap-2 opacity-40">
            <div className="h-2.5 bg-muted rounded w-3/4" />
            <div className="h-2.5 bg-muted rounded w-1/2" />
          </div>
        )}
        {status === 'idle' && (
          <p className="text-xs text-muted-foreground/40">Awaiting query…</p>
        )}
        {status === 'completed' && snippet && (
          <p className="text-sm text-foreground leading-snug line-clamp-3">{snippet}</p>
        )}
        {status === 'failed' && (
          <p className="text-xs text-red-400">Agent failed — partial data only.</p>
        )}
      </div>

      {/* Footer */}
      {output?.sources && output.sources.length > 0 && (
        <div className="flex items-center gap-1 pt-1 border-t border-border/40">
          <Database size={9} className="text-muted-foreground" />
          <span className="text-[10px] font-mono text-muted-foreground">{output.sources.length} sources</span>
          <ChevronRight size={10} className={`ml-auto ${meta.color} transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        </div>
      )}
    </button>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
export default function VeracityDashboard() {
  const router = useRouter();
  const supabase = createClient();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [expandedDomain, setExpandedDomain] = useState<Domain | null>(null);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  // Follow-up state — persists alongside the current agent grid
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [followUpInput, setFollowUpInput] = useState('');
  const [isFollowingUp, setIsFollowingUp] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const followUpEndRef = useRef<HTMLDivElement>(null);

  const currentResult = [...messages].reverse().find(m => m.role === 'assistant');
  const recentQueries = messages.filter(m => m.role === 'user').map(m => m.content);
  const hasResult = !!(currentResult?.orchestratorOutput);

  const completedCount = currentResult?.agentRuns?.filter(r => r.status === 'completed').length ?? 0;
  const totalCount = currentResult?.agentRuns?.length ?? 0;
  const allAgentsComplete = totalCount > 0 && currentResult?.agentRuns?.every(r => r.status === 'completed' || r.status === 'failed');

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
  }, []);

  useEffect(() => {
    if (followUps.length > 0) followUpEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [followUps]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/auth');
    router.refresh();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const newImages: AttachedImage[] = await Promise.all(
      files.map(async file => {
        const dataUrl = await readFileAsBase64(file);
        const [prefix, data] = dataUrl.split(',');
        const mimeType = prefix.split(':')[1].split(';')[0];
        return { dataUrl, data, mimeType, name: file.name };
      })
    );
    setAttachedImages(prev => [...prev, ...newImages]);
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

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: effectiveText, history, images: imagePayloads }),
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
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? {
                  ...m,
                  content: out.synthesizedAnswer,
                  type: 'intelligence',
                  orchestratorOutput: out,
                  recommendations: out.topRecommendations?.map(r => ({
                    title: r.title,
                    rationale: r.rationale,
                    score: r.confidence === 'high' ? 90 : r.confidence === 'medium' ? 65 : 40,
                    confidence: r.confidence,
                    evidence: r.evidence,
                    priority: r.priority,
                  })),
                  sources: out.outputs
                    ?.flatMap(o => o.sources?.map(s => ({ title: s.title, url: s.url })) ?? [])
                    .filter((s, i, a) => s.url && a.findIndex(x => x.url === s.url) === i)
                    .slice(0, 10),
                  suggestions: out.suggestedFollowUps?.slice(0, 3),
                } : m
              ));
            }

            if (chunk.type === 'error') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: `Analysis failed: ${chunk.message}`, type: 'text' } : m
              ));
            }
          } catch { /* malformed chunk */ }
        }
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? { ...m, content: 'Failed to connect to intelligence engine. Please try again.' } : m
      ));
    } finally {
      setIsLoading(false);
    }
  };

  // Follow-up: uses full conversation context but appends answer as a mini card, preserving the agent grid
  const handleFollowUp = async (text: string) => {
    if (!text.trim() || isFollowingUp || isLoading) return;

    const fuId = Date.now();
    setFollowUps(prev => [...prev, { id: fuId, question: text, answer: '', loading: true }]);
    setFollowUpInput('');
    setIsFollowingUp(true);

    const history = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text, history }),
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
            if (chunk.type === 'result') {
              const out: OrchestratorOutput = chunk.output;
              const sources = out.outputs
                ?.flatMap(o => o.sources?.map(s => ({ title: s.title, url: s.url })) ?? [])
                .filter((s, i, a) => s.url && a.findIndex(x => x.url === s.url) === i)
                .slice(0, 6);
              setFollowUps(prev => prev.map(f =>
                f.id === fuId ? { ...f, answer: out.synthesizedAnswer, sources, loading: false } : f
              ));
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

  const handleNewQuery = () => {
    setMessages([]);
    setFollowUps([]);
    setExpandedDomain(null);
    setAttachedImages([]);
  };

  const getRunForDomain = (domain: Domain): AgentRun | undefined =>
    currentResult?.agentRuns?.find(r =>
      r.agentId === domain || r.name?.toLowerCase().includes(domain.split('-')[0])
    );

  const getOutputForDomain = (domain: Domain): AgentOutput | undefined =>
    currentResult?.orchestratorOutput?.outputs?.find(o => o.domain === domain);

  const expandedOutput = expandedDomain ? getOutputForDomain(expandedDomain) : null;
  const expandedMeta = expandedDomain ? DOMAIN_META[expandedDomain] : null;

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans">

      {/* ── Left Sidebar ── */}
      <div className="w-[220px] flex-shrink-0 bg-muted border-r border-border flex flex-col h-full">
        {/* Logo */}
        <div className="px-5 pt-5 pb-4 border-b border-border">
          <h1 className="font-serif text-2xl font-bold text-gradient-signature tracking-tight">Veracity</h1>
          <p className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest mt-0.5">Growth Intelligence</p>
        </div>

        {/* New Query */}
        <div className="px-4 pt-4 pb-3">
          <button
            onClick={handleNewQuery}
            className="w-full bg-gradient-signature text-white rounded-xl py-2.5 px-4 text-sm font-medium flex items-center justify-center gap-2 transition-transform hover:-translate-y-[1px] hover:shadow-md"
          >
            <Plus size={14} /> New Query
          </button>
        </div>

        {/* ── Agent Status Panel — always visible, always showing all 6 ── */}
        <div className="px-4 pb-3">
          <div className="veracity-card p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Agents</span>
              {isLoading && totalCount > 0 && (
                <span className="text-[9px] font-mono text-amber-600 flex items-center gap-1">
                  <RefreshCw size={8} className="animate-spin" /> {completedCount}/{totalCount}
                </span>
              )}
              {hasResult && allAgentsComplete && (
                <span className="text-[9px] font-mono text-emerald-600">{completedCount}/{totalCount} done</span>
              )}
            </div>
            <div className="flex flex-col gap-0">
              {ALL_DOMAINS.map(domain => (
                <SidebarAgentRow key={domain} domain={domain} run={getRunForDomain(domain)} />
              ))}
            </div>
          </div>
        </div>

        {/* Recent searches */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {recentQueries.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 mb-2">
                <History size={11} className="text-muted-foreground" />
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Recent</span>
              </div>
              <div className="flex flex-col gap-0.5">
                {recentQueries.slice().reverse().slice(0, 5).map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(q)}
                    className="text-left text-xs text-foreground/60 hover:text-foreground px-2 py-1.5 rounded-lg hover:bg-background transition-colors truncate"
                    title={q}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Mind Map placeholder */}
          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <GitBranch size={11} className="text-muted-foreground" />
              <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Mind Map</span>
            </div>
            <div className="rounded-xl border border-dashed border-border bg-background/50 p-3 flex flex-col items-center gap-1.5">
              <GitBranch size={16} className="text-muted-foreground/30" />
              <p className="text-[10px] text-muted-foreground text-center leading-snug">Query graph appears after first analysis</p>
            </div>
          </div>
        </div>

        {/* Live indicator */}
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Live · Sourced · Grounded</span>
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">

        {/* ── Top Bar with Search ── */}
        <div className="shrink-0 border-b border-border bg-white/90 backdrop-blur-md px-6 py-3 z-10">
          <div className="flex items-center gap-4">
            {/* Search / query bar */}
            <div className="flex-1 flex flex-col gap-2">
              {/* Attached image previews */}
              {attachedImages.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachedImages.map((img, i) => (
                    <div key={i} className="relative group">
                      <img src={img.dataUrl} alt={img.name} className="h-10 w-10 object-cover rounded-lg border border-border" />
                      <button
                        onClick={() => setAttachedImages(prev => prev.filter((_, j) => j !== i))}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-foreground text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={9} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="relative veracity-card rounded-xl overflow-hidden focus-within:ring-2 focus-within:ring-accent/20 focus-within:border-accent/50 transition-all">
                <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  value={inputValue}
                  onChange={e => setInputValue(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSend(inputValue)}
                  placeholder="Ask a growth intelligence question…"
                  className="w-full h-11 pl-10 pr-20 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                  disabled={isLoading}
                />
                <div className="absolute right-2 top-1.5 bottom-1.5 flex items-center gap-1">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-8 h-8 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-lg hover:bg-muted"
                    title="Attach image"
                  >
                    <Paperclip size={14} />
                  </button>
                  <button
                    onClick={() => handleSend(inputValue)}
                    disabled={(!inputValue.trim() && attachedImages.length === 0) || isLoading}
                    className="px-3 h-8 bg-gradient-signature text-white rounded-lg flex items-center justify-center transition-transform hover:-translate-y-[1px] hover:shadow-sm disabled:opacity-40 disabled:hover:translate-y-0"
                  >
                    {isLoading ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
              </div>
            </div>

            {/* Stats strip */}
            <div className="hidden lg:flex items-center gap-3 text-[11px] font-mono bg-foreground text-white px-4 py-2 rounded-full shrink-0">
              <span className="flex items-center gap-1.5"><Clock size={11} className="text-accent-secondary" /> &lt;5 min</span>
              <span className="w-px h-3 bg-white/20" />
              <span className="flex items-center gap-1.5"><ShieldCheck size={11} className="text-accent-secondary" /> Sourced</span>
              <span className="w-px h-3 bg-white/20" />
              <span className="flex items-center gap-1.5"><Database size={11} className="text-accent-secondary" /> 16+ signals</span>
            </div>

            {/* User menu */}
            <div className="relative shrink-0">
              <button
                onClick={() => setShowUserMenu(v => !v)}
                className="w-8 h-8 rounded-full bg-gradient-signature text-white flex items-center justify-center text-xs font-medium hover:opacity-90 transition-opacity"
              >
                {userEmail ? userEmail[0].toUpperCase() : <User size={14} />}
              </button>
              {showUserMenu && (
                <div className="absolute right-0 top-10 w-52 veracity-card py-2 z-50">
                  {userEmail && (
                    <p className="px-4 py-2 text-xs text-muted-foreground truncate border-b border-border mb-1">{userEmail}</p>
                  )}
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                  >
                    <LogOut size={14} className="text-muted-foreground" /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Demo chips — only on empty state */}
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {DEMO_QUERIES.map(q => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="text-xs text-accent border border-accent/20 bg-accent/5 hover:bg-accent/10 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 max-w-xs truncate"
                >
                  {q} <ChevronRight size={11} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Dashboard Body ── */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5">

          {/* Empty state */}
          {messages.length === 0 && !isLoading && (
            <div className="flex flex-col items-center justify-center flex-1 text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="font-serif text-4xl text-foreground mb-3">What do you want to know?</h2>
              <p className="text-muted-foreground text-sm">Live signals · 6 intelligence domains · Confidence-scored</p>
              <div className="flex items-center gap-1.5 mt-4 text-xs text-muted-foreground/60">
                <ImageIcon size={12} /> <span>You can also attach images for visual context</span>
              </div>
            </div>
          )}

          {/* ── 3×2 Agent Card Grid — always rendered once a query starts ── */}
          {(currentResult || isLoading) && (
            <div>
              {/* Query label + progress dots */}
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-mono text-muted-foreground uppercase tracking-wider truncate max-w-[70%]">
                  {recentQueries[recentQueries.length - 1] ?? 'Analysing…'}
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    {ALL_DOMAINS.map(d => {
                      const s = getRunForDomain(d)?.status ?? 'idle';
                      return (
                        <div key={d} className={`w-1.5 h-1.5 rounded-full transition-colors ${
                          s === 'completed' ? 'bg-emerald-400' :
                          s === 'running'   ? 'bg-amber-400 animate-pulse' :
                          s === 'failed'    ? 'bg-red-400' :
                          s === 'pending'   ? 'bg-amber-200 animate-pulse' :
                          'bg-muted-foreground/20'
                        }`} />
                      );
                    })}
                  </div>
                  {totalCount > 0 && (
                    <span className="text-[10px] font-mono text-muted-foreground">{completedCount}/{Math.max(totalCount, 6)}</span>
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
                    onClick={() => {
                      if (getOutputForDomain(domain)) {
                        setExpandedDomain(prev => prev === domain ? null : domain);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Expanded Domain Detail ── */}
          {expandedDomain && expandedOutput && expandedMeta && (
            <div className="veracity-card animate-in fade-in slide-in-from-top-2 duration-300">
              <div className={`flex items-center justify-between px-5 py-3 border-b border-border rounded-t-[16px] ${expandedMeta.bg}`}>
                <div className={`flex items-center gap-2 ${expandedMeta.color}`}>
                  {expandedMeta.icon}
                  <span className="text-sm font-medium">{expandedMeta.label}</span>
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                    expandedOutput.confidence === 'high'   ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    expandedOutput.confidence === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    'bg-muted text-muted-foreground border-border'
                  }`}>{expandedOutput.confidence} confidence</span>
                </div>
                <button onClick={() => setExpandedDomain(null)} className="p-1.5 rounded-lg hover:bg-black/10 transition-colors">
                  <X size={14} />
                </button>
              </div>

              <div className="p-5 flex flex-col gap-5">
                <ArtifactRenderer output={expandedOutput} product={currentResult?.orchestratorOutput?.product ?? ''} />

                {expandedOutput.facts.filter(f => !f.startsWith('[')).length > 0 && (
                  <div>
                    <p className="text-[10px] font-mono uppercase text-muted-foreground mb-2 tracking-wider">Key Facts</p>
                    <ul className="flex flex-col gap-1.5">
                      {expandedOutput.facts.filter(f => !f.startsWith('[')).map((f, i) => (
                        <li key={i} className="text-sm text-foreground flex items-start gap-2">
                          <span className="text-emerald-500 mt-0.5 shrink-0">✓</span>{f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {expandedOutput.interpretation.length > 0 && (
                  <div>
                    <p className="text-[10px] font-mono uppercase text-muted-foreground mb-2 tracking-wider">Analysis</p>
                    <ul className="flex flex-col gap-1.5">
                      {expandedOutput.interpretation.map((interp, i) => (
                        <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                          <span className="text-accent mt-0.5 shrink-0">›</span>{interp}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Overall Intelligence Summary ── */}
          {currentResult?.content && (
            <div className="veracity-card p-6 flex flex-col gap-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Layers size={14} className="text-accent" />
                  <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Intelligence Summary</span>
                </div>
                {currentResult.orchestratorOutput?.product && (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-accent/5 text-accent border border-accent/20 uppercase tracking-wider">
                    {currentResult.orchestratorOutput.product}
                  </span>
                )}
              </div>

              <p className="text-[15px] leading-relaxed text-foreground whitespace-pre-line">{currentResult.content}</p>

              {/* Recommendations */}
              {currentResult.recommendations && currentResult.recommendations.length > 0 && (
                <div className="flex flex-col gap-3">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Strategic Recommendations</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {currentResult.recommendations.map((rec: any, i: number) => (
                      <div key={i} className="p-4 rounded-xl border border-border bg-muted/30 flex flex-col gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider border ${
                            rec.priority === 'immediate'  ? 'bg-red-50 text-red-600 border-red-200' :
                            rec.priority === 'short-term' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            'bg-blue-50 text-blue-600 border-blue-200'
                          }`}>{rec.priority ?? 'strategic'}</span>
                          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider border ${
                            rec.confidence === 'high' || rec.score >= 80 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            rec.confidence === 'medium' || rec.score >= 55 ? 'bg-amber-50 text-amber-700 border-amber-200' :
                            'bg-muted text-muted-foreground border-border'
                          }`}>{rec.confidence ?? (rec.score >= 80 ? 'high' : rec.score >= 55 ? 'medium' : 'low')} conf</span>
                        </div>
                        <h4 className="font-medium text-sm text-foreground">{rec.title}</h4>
                        <p className="text-xs text-muted-foreground leading-relaxed">{rec.rationale}</p>
                        {rec.evidence && rec.evidence.length > 0 && (
                          <ul className="flex flex-col gap-0.5 mt-1">
                            {rec.evidence.map((e: string, ei: number) => (
                              <li key={ei} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                <span className="text-accent mt-0.5 shrink-0">›</span>{e}
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
                <div className="flex items-start gap-3 pt-3 border-t border-border/50">
                  <span className="text-xs font-mono text-muted-foreground uppercase shrink-0 mt-0.5">Sources</span>
                  <div className="flex flex-wrap gap-2">
                    {currentResult.sources.map(source => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md flex items-center gap-1 hover:text-accent hover:bg-accent/5 transition-colors"
                      >
                        {source.title} <ArrowUpRight size={10} />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestion chips */}
              {currentResult.suggestions && currentResult.suggestions.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
                  <span className="text-xs font-mono text-muted-foreground uppercase self-center mr-1">Dig deeper</span>
                  {currentResult.suggestions.map(sug => (
                    <button
                      key={sug}
                      onClick={() => setFollowUpInput(sug)}
                      className="text-xs text-accent border border-accent/20 bg-accent/5 hover:bg-accent/10 hover:border-accent/30 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5"
                    >
                      {sug} <ChevronRight size={11} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Follow-up answers — stacked, preserved alongside grid ── */}
          {followUps.map(fu => (
            <div key={fu.id} className="veracity-card p-5 flex flex-col gap-3 border-l-2 border-accent/30 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex items-start gap-2">
                <MessageSquarePlus size={13} className="text-accent mt-0.5 shrink-0" />
                <p className="text-xs font-mono text-muted-foreground leading-snug">{fu.question}</p>
              </div>
              {fu.loading ? (
                <div className="flex flex-col gap-2">
                  <div className="h-3 bg-muted rounded w-3/4 animate-pulse-line" />
                  <div className="h-3 bg-muted rounded w-full animate-pulse-line" />
                  <div className="h-3 bg-muted rounded w-5/6 animate-pulse-line" />
                </div>
              ) : (
                <>
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">{fu.answer}</p>
                  {fu.sources && fu.sources.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-border/40">
                      {fu.sources.map(s => (
                        <a
                          key={s.url}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded flex items-center gap-1 hover:text-accent hover:bg-accent/5 transition-colors"
                        >
                          {s.title} <ArrowUpRight size={9} />
                        </a>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}

          {/* ── Follow-up input bar — appears once a result is ready ── */}
          {hasResult && (
            <div className="veracity-card p-3 flex items-center gap-3" ref={followUpEndRef}>
              <MessageSquarePlus size={14} className="text-accent shrink-0" />
              <input
                type="text"
                value={followUpInput}
                onChange={e => setFollowUpInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleFollowUp(followUpInput)}
                placeholder="Ask a follow-up — keeps the analysis above intact…"
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
                disabled={isFollowingUp || isLoading}
              />
              <button
                onClick={() => handleFollowUp(followUpInput)}
                disabled={!followUpInput.trim() || isFollowingUp || isLoading}
                className="px-3 py-1.5 bg-gradient-signature text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-transform hover:-translate-y-[1px] hover:shadow-sm disabled:opacity-40 disabled:hover:translate-y-0 shrink-0"
              >
                {isFollowingUp ? <RefreshCw size={12} className="animate-spin" /> : <Send size={12} />}
                {isFollowingUp ? 'Thinking…' : 'Follow up'}
              </button>
            </div>
          )}

          <div className="h-4" />
        </div>
      </div>
    </div>
  );
}
