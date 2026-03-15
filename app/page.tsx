'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Plus, MessageSquare, Search, ChevronRight, Check, RefreshCw, ArrowUpRight, Clock, ShieldCheck, Database, LogOut, User, Paperclip, X, ImageIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import type { AgentRun, OrchestratorOutput, ImageAttachment } from '@/lib/agents/types';
import { ArtifactRenderer } from '@/components/artifacts/ArtifactRenderer';

type SourceLink = { title: string; url: string };

type AttachedImage = {
  dataUrl: string;   // full data: URL for display
  data: string;      // base64 only (no prefix) for API
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

const DEMO_QUERIES = [
  'Is Lilian competitive in the AI SDR market right now? Where does Vector stand?',
  'Is the digital workers category accelerating or consolidating?',
  'What should Vector Agents build to capture emerging demand?',
];

// Helper: read a File as a base64 data URL
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function VeracityChat() {
  const router = useRouter();
  const supabase = createClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
    });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/auth');
    router.refresh();
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const newImages: AttachedImage[] = await Promise.all(
      files.map(async (file) => {
        const dataUrl = await readFileAsBase64(file);
        const [prefix, data] = dataUrl.split(',');
        const mimeType = prefix.split(':')[1].split(';')[0];
        return { dataUrl, data, mimeType, name: file.name };
      })
    );
    setAttachedImages(prev => [...prev, ...newImages]);
    // Reset so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSend = async (text: string, imagesToSend?: AttachedImage[]) => {
    const images = imagesToSend ?? attachedImages;
    // Allow sending if there's text, or images are attached (use a default prompt for image-only)
    const effectiveText = text.trim() || (images.length > 0 ? 'Analyse the attached image(s).' : '');
    if (!effectiveText || isLoading) return;

    const userMsg: Message = { id: Date.now(), role: 'user', content: effectiveText, images: images.length > 0 ? images : undefined };

    // Build history for API from current messages (exclude mock initial data)
    const history = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    setMessages(prev => [...prev, userMsg]);
    setInputValue('');
    setAttachedImages([]);
    setIsLoading(true);

    // Placeholder assistant message — updated live as SSE events arrive
    const assistantId = Date.now() + 1;
    const placeholder: Message = {
      id: assistantId,
      role: 'assistant',
      type: 'intelligence',
      content: '',
      agentRuns: [],
    };
    setMessages(prev => [...prev, placeholder]);

    // Build image payloads for the API (just data + mimeType, no full dataUrl needed)
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
                m.id === assistantId
                  ? {
                      ...m,
                      agentRuns: [
                        ...(m.agentRuns ?? []).filter(r => r.agentId !== chunk.run.agentId),
                        chunk.run,
                      ],
                    }
                  : m
              ));
            }

            if (chunk.type === 'result') {
              const out: OrchestratorOutput = chunk.output;
              setMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? {
                      ...m,
                      content: out.synthesizedAnswer,
                      type: 'intelligence',
                      orchestratorOutput: out,
                      recommendations: out.topRecommendations?.map(r => ({
                        title: r.title,
                        rationale: r.rationale,
                        score: r.confidence === 'high' ? 90 : r.confidence === 'medium' ? 65 : 40,
                        evidence: r.evidence,
                        priority: r.priority,
                      })),
                      sources: out.outputs
                        ?.flatMap(o => o.sources?.map(s => ({ title: s.title, url: s.url })) ?? [])
                        .filter((s, i, a) => s.url && a.findIndex(x => x.url === s.url) === i)
                        .slice(0, 10),
                      suggestions: out.suggestedFollowUps?.slice(0, 3),
                    }
                  : m
              ));
            }

            if (chunk.type === 'error') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId
                  ? { ...m, content: `Analysis failed: ${chunk.message}`, type: 'text' }
                  : m
              ));
            }
          } catch { /* malformed chunk, skip */ }
        }
      }
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: 'Failed to connect to intelligence engine. Please try again.', type: 'text' }
          : m
      ));
    } finally {
      setIsLoading(false);
    }
  };

  const handleNewQuery = () => {
    setMessages([]);
    setExpandedDomain(null);
  };

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans">
      
      {/* Left Sidebar */}
      <div className="w-[260px] flex-shrink-0 bg-muted border-r border-border flex flex-col h-full">
        <div className="p-6">
          <h1 className="font-serif text-3xl font-bold text-gradient-signature tracking-tight mb-6">
            Veracity
          </h1>
          <button 
            onClick={handleNewQuery}
            className="w-full bg-gradient-signature text-white rounded-xl py-3 px-4 font-medium flex items-center justify-center gap-2 transition-transform hover:-translate-y-[1px] hover:shadow-md"
          >
            <Plus size={18} />
            New Query
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2">
          <div className="text-xs font-mono text-muted-foreground mb-3 px-2 uppercase tracking-wider">Intelligence Domains</div>
          <div className="space-y-1 px-2">
            {[
              { label: 'Market & Trend Sensing', icon: '📈' },
              { label: 'Competitive Landscape', icon: '⚔️' },
              { label: 'Win / Loss Intelligence', icon: '🏆' },
              { label: 'Pricing & Packaging', icon: '💰' },
              { label: 'Positioning & Messaging', icon: '📣' },
              { label: 'Adjacent Market Collision', icon: '🔭' },
            ].map(d => (
              <div key={d.label} className="flex items-center gap-2 px-1 py-1.5 text-xs text-muted-foreground">
                <span>{d.icon}</span>
                <span className="truncate">{d.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-1.5 px-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot" />
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Live · Sourced · Grounded</span>
          </div>
        </div>
      </div>

      {/* Right Main Panel */}
      <div className="flex-1 flex flex-col h-full relative">
        
        {/* Top Header */}
        <div className="h-14 border-b border-border bg-white/80 backdrop-blur-md flex items-center justify-between px-6 z-10 shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-medium text-sm text-foreground">
              {messages.length > 0 ? 'Lilian vs Vector Competitive Analysis' : 'New Intelligence Query'}
            </span>
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200 text-xs font-mono flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot"></div>
              High Confidence
            </span>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4 text-xs font-mono text-muted-foreground bg-foreground text-white px-4 py-1.5 rounded-full shadow-sm">
              <span className="flex items-center gap-1.5"><Clock size={12} className="text-accent-secondary" /> &lt;5 min</span>
              <span className="w-px h-3 bg-white/20"></span>
              <span className="flex items-center gap-1.5"><ShieldCheck size={12} className="text-accent-secondary" /> 95% grounded</span>
              <span className="w-px h-3 bg-white/20"></span>
              <span className="flex items-center gap-1.5"><Database size={12} className="text-accent-secondary" /> 16+ sources</span>
            </div>

            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(v => !v)}
                className="w-8 h-8 rounded-full bg-gradient-signature text-white flex items-center justify-center text-xs font-medium hover:opacity-90 transition-opacity"
              >
                {userEmail ? userEmail[0].toUpperCase() : <User size={14} />}
              </button>
              {showUserMenu && (
                <div className="absolute right-0 top-10 w-52 veracity-card py-2 z-50">
                  {userEmail && (
                    <p className="px-4 py-2 text-xs text-muted-foreground truncate border-b border-border mb-1">
                      {userEmail}
                    </p>
                  )}
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors"
                  >
                    <LogOut size={14} className="text-muted-foreground" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Conversation Thread */}
        <div className="flex-1 overflow-y-auto p-6 pb-32">
          <div className="max-w-3xl mx-auto w-full flex flex-col gap-8">
            
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[60vh] text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="font-serif text-4xl text-foreground mb-3">What do you want to know?</h2>
                <p className="text-muted-foreground text-sm mb-8">Live signals from 16+ sources · 6 intelligence domains · Sourced & confidence-scored</p>
                <div className="flex flex-col gap-3 w-full max-w-xl">
                  {DEMO_QUERIES.map(q => (
                    <button
                      key={q}
                      onClick={() => handleSend(q)}
                      className="veracity-card veracity-card-hover px-5 py-3.5 text-sm text-foreground flex items-center gap-3 text-left"
                    >
                      <Search size={15} className="text-accent shrink-0" />
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg, idx) => (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`} style={{ animationFillMode: 'both', animationDelay: `${idx * 50}ms` }}>

                  {msg.role === 'user' ? (
                    <div className="bg-foreground text-white px-5 py-3.5 rounded-2xl rounded-tr-sm max-w-[85%] text-[15px] leading-relaxed shadow-sm flex flex-col gap-3">
                      {/* Image thumbnails in user bubble */}
                      {msg.images && msg.images.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {msg.images.map((img, i) => (
                            <div key={i} className="relative group">
                              <img
                                src={img.dataUrl}
                                alt={img.name}
                                className="h-24 w-24 object-cover rounded-lg border border-white/20"
                              />
                              <div className="absolute inset-0 rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1">
                                <span className="text-white text-[9px] font-mono truncate w-full">{img.name}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {msg.content}
                    </div>
                  ) : (
                    <div className="max-w-[95%] w-full flex flex-col gap-4">

                      {/* Agent status pills */}
                      {msg.agentRuns && msg.agentRuns.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {msg.agentRuns.map(run => (
                            run.status === 'running' ? (
                              <span key={run.agentId} className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                                {run.name} <RefreshCw size={10} className="animate-spin" />
                              </span>
                            ) : run.status === 'completed' ? (
                              <span key={run.agentId} className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-muted text-muted-foreground border border-border flex items-center gap-1">
                                {run.name} <Check size={10} className="text-emerald-500" />
                              </span>
                            ) : run.status === 'failed' ? (
                              <span key={run.agentId} className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-red-50 text-red-600 border border-red-200 flex items-center gap-1">
                                {run.name} ✕
                              </span>
                            ) : null
                          ))}
                        </div>
                      )}

                      {/* Main answer card */}
                      <div className="veracity-card p-6 flex flex-col gap-5">

                        {/* Synthesized answer */}
                        {msg.content && (
                          <div className="text-[15px] leading-relaxed text-foreground whitespace-pre-line">
                            {msg.content}
                          </div>
                        )}

                        {/* Recommendations */}
                        {msg.recommendations && msg.recommendations.length > 0 && (
                          <div className="flex flex-col gap-3">
                            <h3 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Strategic Recommendations</h3>
                            {msg.recommendations.map((rec: any, i: number) => (
                              <div key={i} className="p-4 rounded-xl border border-border bg-muted/30 flex flex-col gap-2">
                                <div className="flex justify-between items-start gap-4">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                        rec.priority === 'immediate' ? 'bg-red-50 text-red-600 border border-red-200' :
                                        rec.priority === 'short-term' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                        'bg-blue-50 text-blue-600 border border-blue-200'
                                      }`}>{rec.priority ?? 'strategic'}</span>
                                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                        rec.confidence === 'high' || rec.score >= 80 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                        rec.confidence === 'medium' || rec.score >= 55 ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                                        'bg-muted text-muted-foreground border border-border'
                                      }`}>{rec.confidence ?? (rec.score >= 80 ? 'high' : rec.score >= 55 ? 'medium' : 'low')} confidence</span>
                                    </div>
                                    <h4 className="font-medium text-foreground mb-1">{rec.title}</h4>
                                    <p className="text-sm text-muted-foreground leading-relaxed">{rec.rationale}</p>
                                    {rec.evidence && rec.evidence.length > 0 && (
                                      <ul className="mt-2 flex flex-col gap-0.5">
                                        {rec.evidence.map((e: string, ei: number) => (
                                          <li key={ei} className="text-xs text-muted-foreground flex items-start gap-1.5">
                                            <span className="text-accent mt-0.5">›</span>{e}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Inline Artifacts — one card per agent with domain-specific visualization */}
                        {msg.orchestratorOutput?.outputs && msg.orchestratorOutput.outputs.length > 0 && (
                          <div className="flex flex-col gap-3 pt-2 border-t border-border/50">
                            {msg.orchestratorOutput.outputs.map((output) => {
                              const domainLabel = output.domain.replace(/-/g, ' ');
                              const isExpanded = expandedDomain === `${msg.id}-${output.domain}`;
                              return (
                                <div key={output.domain} className="rounded-xl border border-border overflow-hidden">
                                  {/* Domain header — always visible, click to expand/collapse */}
                                  <button
                                    onClick={() => setExpandedDomain(isExpanded ? null : `${msg.id}-${output.domain}`)}
                                    className="w-full flex items-center justify-between px-4 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-mono font-medium text-foreground capitalize">{domainLabel}</span>
                                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                        output.confidence === 'high' ? 'bg-emerald-50 text-emerald-700' :
                                        output.confidence === 'medium' ? 'bg-amber-50 text-amber-700' :
                                        'bg-muted text-muted-foreground'
                                      }`}>{output.confidence}</span>
                                    </div>
                                    <ChevronRight size={14} className={`text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                                  </button>

                                  {/* Expanded: artifact + facts/interpretation */}
                                  {isExpanded && (
                                    <div className="px-4 py-4 flex flex-col gap-4 bg-white">
                                      {/* Domain-specific artifact visualization */}
                                      <ArtifactRenderer
                                        output={output}
                                        product={msg.orchestratorOutput!.product}
                                      />

                                      {/* Facts */}
                                      {output.facts.filter(f => !f.startsWith('[')).length > 0 && (
                                        <div>
                                          <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1.5 tracking-wider">Key Facts</p>
                                          <ul className="flex flex-col gap-1">
                                            {output.facts.filter(f => !f.startsWith('[')).map((f, i) => (
                                              <li key={i} className="text-sm text-foreground flex items-start gap-1.5">
                                                <span className="text-emerald-500 mt-0.5 shrink-0">✓</span>{f}
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}

                                      {/* Interpretation */}
                                      {output.interpretation.length > 0 && (
                                        <div>
                                          <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1.5 tracking-wider">Analysis</p>
                                          <ul className="flex flex-col gap-1">
                                            {output.interpretation.map((interp, i) => (
                                              <li key={i} className="text-sm text-muted-foreground flex items-start gap-1.5">
                                                <span className="text-accent mt-0.5 shrink-0">›</span>{interp}
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Sources — clickable links */}
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="flex items-start gap-2 pt-2 border-t border-border/50">
                            <span className="text-xs font-mono text-muted-foreground uppercase shrink-0 mt-0.5">Sources</span>
                            <div className="flex flex-wrap gap-2">
                              {msg.sources.map((source) => (
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
                      </div>

                      {/* Follow-up suggestions */}
                      {msg.suggestions && msg.suggestions.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {msg.suggestions.map((sug: string) => (
                            <button
                              key={sug}
                              onClick={() => handleSend(sug)}
                              className="text-xs text-accent border border-accent/20 bg-accent/5 hover:bg-accent/10 hover:border-accent/30 px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5"
                            >
                              {sug} <ChevronRight size={12} />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Loading Skeleton — only shown before any agent updates arrive */}
            {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
              <div className="flex justify-start animate-in fade-in duration-300">
                <div className="max-w-[95%] w-full flex flex-col gap-4">
                  <div className="flex gap-2 mb-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                      Dispatching agents <RefreshCw size={10} className="animate-spin" />
                    </span>
                  </div>
                  <div className="veracity-card p-6 flex flex-col gap-4 w-full max-w-2xl">
                    <div className="h-4 bg-muted rounded w-3/4 animate-pulse-line"></div>
                    <div className="h-4 bg-muted rounded w-full animate-pulse-line"></div>
                    <div className="h-4 bg-muted rounded w-5/6 animate-pulse-line"></div>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Bottom Input Area */}
        <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-background via-background to-transparent pt-12">
          <div className="max-w-3xl mx-auto w-full flex flex-col items-center gap-3">

            {/* Image preview strip */}
            {attachedImages.length > 0 && (
              <div className="w-full flex flex-wrap gap-2 px-1">
                {attachedImages.map((img, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={img.dataUrl}
                      alt={img.name}
                      className="h-16 w-16 object-cover rounded-xl border border-border shadow-sm"
                    />
                    <button
                      onClick={() => setAttachedImages(prev => prev.filter((_, idx) => idx !== i))}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-foreground text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
                    >
                      <X size={10} />
                    </button>
                    <div className="absolute inset-0 rounded-xl bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                ))}
              </div>
            )}

            {/* Input box */}
            <div className="relative w-full veracity-card rounded-2xl overflow-hidden focus-within:ring-2 focus-within:ring-accent/20 focus-within:border-accent/50 transition-all">
              {/* Hidden file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              <input 
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend(inputValue)}
                placeholder="Ask a growth intelligence question..."
                className="w-full h-14 pl-5 pr-24 bg-transparent outline-none text-[15px] placeholder:text-muted-foreground"
              />
              {/* Paperclip button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
                title="Attach image"
                className="absolute right-14 top-2 bottom-2 w-10 text-muted-foreground hover:text-accent rounded-xl flex items-center justify-center transition-colors disabled:opacity-40"
              >
                {attachedImages.length > 0 ? (
                  <span className="relative">
                    <ImageIcon size={16} className="text-accent" />
                    <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-accent text-white text-[8px] flex items-center justify-center font-mono">{attachedImages.length}</span>
                  </span>
                ) : (
                  <Paperclip size={16} />
                )}
              </button>
              {/* Send button */}
              <button 
                onClick={() => handleSend(inputValue)}
                disabled={(!inputValue.trim() && attachedImages.length === 0) || isLoading}
                className="absolute right-2 top-2 bottom-2 w-10 bg-gradient-signature text-white rounded-xl flex items-center justify-center transition-transform hover:-translate-y-[1px] hover:shadow-md disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
              >
                <Send size={16} className={inputValue.trim() ? "translate-x-[-1px] translate-y-[1px]" : ""} />
              </button>
            </div>
            
            <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground uppercase tracking-widest">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse-dot"></div>
              Live Data · Sourced · &lt;5 Min
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
