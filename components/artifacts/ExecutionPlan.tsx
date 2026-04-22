'use client';

import { useState, useCallback } from 'react';
import { Mail, Linkedin, Target, BookOpen, Calendar, CheckCircle2, Circle, ArrowRight, Copy, Check, RefreshCw, BarChart3, ChevronDown } from 'lucide-react';
import { useTheme } from '@/lib/theme-provider';
import type { AgentSource, ExecutionPlanOutput, CampaignVariant, OrchestratorOutput, RefinementDelta, DeploymentStep } from '../../lib/agents/types';
import { recordVariantResult, refineExecutionPlan } from '@/lib/feedback';

interface Props {
  output: ExecutionPlanOutput;
  product: string;
  sessionId?: string | null;
  messageId?: string | null;
  onRefined?: (result: { plan: ExecutionPlanOutput; orchestratorOutput?: OrchestratorOutput; changes?: RefinementDelta[] }) => void;
}

type Tab = 'variants' | 'brief' | 'deployment';

const ANGLE_COLORS = ['#3b82f6', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#6366f1'];

const CHANNEL_COLORS: Record<string, string> = {
  email: '#3b82f6',
  linkedin: '#0077b5',
  ads: '#f59e0b',
};

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email: <Mail size={13} />,
  linkedin: <Linkedin size={13} />,
  ads: <Target size={13} />,
};

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(value.trim());
  }
  return out;
}

function formatMiniPreview(text: string, maxLength = 72): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}

// ── Hover-aware card wrapper ────────────────────────────────────────────────
function HoverCard({ children, style, className = '' }: { children: React.ReactNode; style?: React.CSSProperties; className?: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={`rounded-lg transition-all duration-200 ${className}`}
      style={{
        ...style,
        transform: hovered ? 'translateY(-2px)' : 'none',
        boxShadow: hovered
          ? '0 8px 25px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,112,243,0.15)'
          : (style?.boxShadow ?? '0 1px 3px rgba(0,0,0,0.06)'),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
    </div>
  );
}

// ── Copy button ─────────────────────────────────────────────────────────────
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { textSubtle, border: borderC } = useTheme();
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className="text-[11px] font-mono px-2.5 py-1 rounded-md flex items-center gap-1.5 transition-all hover:opacity-80"
      style={{ color: copied ? '#10b981' : textSubtle, border: `1px solid ${copied ? 'rgba(16,185,129,0.35)' : borderC}`, background: copied ? 'rgba(16,185,129,0.06)' : 'transparent' }}
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

// ── Channel coverage bar graph — shows which channels each variant covers ──
function ChannelCoverageChart({ variants }: { variants: CampaignVariant[] }) {
  const { border: borderC, surface2: cardBg2, textSubtle } = useTheme();
  const channels = ['email', 'linkedin'] as const;

  return (
    <HoverCard style={{ border: `1px solid ${borderC}`, background: cardBg2, overflow: 'hidden' }}>
      <div className="p-4">
        <p className="text-[11px] font-mono font-semibold uppercase tracking-wider mb-3" style={{ color: textSubtle }}>Channel Coverage</p>
        <div className="flex flex-col gap-2.5">
          {variants.map((v, i) => {
            const color = ANGLE_COLORS[i % ANGLE_COLORS.length];
            const hasEmail = !!v.channels?.email;
            const hasLinkedin = !!v.channels?.linkedin;
            return (
              <div key={v.id} className="flex items-center gap-3">
                <span className="text-[12px] font-mono font-semibold w-16 shrink-0" style={{ color }}>{v.id}</span>
                <div className="flex-1 flex gap-1.5">
                  {channels.map(ch => (
                    <div key={ch} className="flex-1 rounded-md h-7 flex items-center justify-center gap-1.5 text-[11px] font-mono transition-all"
                      style={{
                        background: (ch === 'email' ? hasEmail : hasLinkedin) ? `${CHANNEL_COLORS[ch]}18` : `${borderC}40`,
                        border: `1px solid ${(ch === 'email' ? hasEmail : hasLinkedin) ? `${CHANNEL_COLORS[ch]}40` : borderC}`,
                        color: (ch === 'email' ? hasEmail : hasLinkedin) ? CHANNEL_COLORS[ch] : textSubtle,
                        opacity: (ch === 'email' ? hasEmail : hasLinkedin) ? 1 : 0.4,
                      }}
                    >
                      {CHANNEL_ICONS[ch]}
                      <span className="hidden sm:inline">{ch}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </HoverCard>
  );
}

// ── Deployment timeline bar chart ───────────────────────────────────────────
function DeploymentTimeline({ steps }: { steps: DeploymentStep[] }) {
  const { border: borderC, surface2: cardBg2, text: textMain, textSubtle } = useTheme();
  if (!steps.length) return null;

  const sorted = [...steps].sort((a, b) => a.day - b.day);
  const maxDay = Math.max(...sorted.map(s => s.day), 1);
  const channelCounts: Record<string, number> = {};
  for (const s of sorted) {
    channelCounts[s.channel] = (channelCounts[s.channel] ?? 0) + 1;
  }

  return (
    <HoverCard style={{ border: `1px solid ${borderC}`, background: cardBg2, overflow: 'hidden' }}>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-mono font-semibold uppercase tracking-wider" style={{ color: textSubtle }}>Deployment Timeline</p>
          <div className="flex gap-3">
            {Object.entries(channelCounts).map(([ch, count]) => (
              <span key={ch} className="flex items-center gap-1 text-[11px] font-mono" style={{ color: CHANNEL_COLORS[ch] ?? textSubtle }}>
                {CHANNEL_ICONS[ch]} {count}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-end gap-1" style={{ height: 64 }}>
          {sorted.map((step, i) => {
            const height = Math.max(16, (step.day / maxDay) * 56);
            const color = CHANNEL_COLORS[step.channel] ?? '#6366f1';
            return (
              <div key={`tl-${i}`} className="flex-1 flex flex-col items-center gap-1 group" title={`Day ${step.day}: ${step.action}`}>
                <div
                  className="w-full rounded-t-md transition-all duration-200 group-hover:opacity-100 group-hover:scale-y-105"
                  style={{ height, background: color, opacity: 0.7, transformOrigin: 'bottom' }}
                />
                <span className="text-[9px] font-mono" style={{ color: textSubtle }}>D{step.day}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between mt-2 text-[10px] font-mono" style={{ color: textSubtle }}>
          <span>Day 1</span>
          <span>Day {maxDay}</span>
        </div>
      </div>
    </HoverCard>
  );
}

// ── Record result form ──────────────────────────────────────────────────────
function RecordResultForm({
  variant, accentColor, sessionId, messageId, onSaved,
}: {
  variant: CampaignVariant; accentColor: string; sessionId: string;
  messageId?: string | null; onSaved?: (variantId: string) => void;
}) {
  const { border: borderC, surface: cardBg, text: textMain, textSubtle } = useTheme();
  const [open, setOpen] = useState(false);
  const [sentCount, setSentCount] = useState('');
  const [openRate, setOpenRate] = useState('');
  const [replyRate, setReplyRate] = useState('');
  const [clickRate, setClickRate] = useState('');
  const [meetingsBooked, setMeetingsBooked] = useState('');
  const [hypothesisConfirmed, setHypothesisConfirmed] = useState<'yes' | 'no' | 'unclear' | ''>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const numOrUndef = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) ? n : undefined; };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await recordVariantResult({
      sessionId, messageId, variantId: variant.id, variantAngle: variant.angle,
      hypothesis: variant.hypothesis, successMetric: variant.successMetric,
      sentCount: numOrUndef(sentCount), openRate: numOrUndef(openRate),
      replyRate: numOrUndef(replyRate), clickRate: numOrUndef(clickRate),
      meetingsBooked: numOrUndef(meetingsBooked),
      hypothesisConfirmed: hypothesisConfirmed || undefined, notes: notes || undefined,
    });
    setSaving(false);
    if (ok) { setSaved(true); onSaved?.(variant.id); setTimeout(() => { setSaved(false); setOpen(false); }, 1800); }
  };

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px dashed ${borderC}` }}>
      <button type="button" onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-[11px] font-mono uppercase tracking-wider transition-all hover:opacity-80"
        style={{ color: accentColor, background: `${accentColor}08` }}
      >
        <span className="flex items-center gap-1.5"><BarChart3 size={12} /> Record campaign result</span>
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </button>
      {open && (
        <div className="p-4 flex flex-col gap-3" style={{ background: cardBg }}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Field label="Sent" value={sentCount} onChange={setSentCount} placeholder="250" />
            <Field label="Open %" value={openRate} onChange={setOpenRate} placeholder="42" />
            <Field label="Reply %" value={replyRate} onChange={setReplyRate} placeholder="4.2" />
            <Field label="Click %" value={clickRate} onChange={setClickRate} placeholder="2.1" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="Meetings" value={meetingsBooked} onChange={setMeetingsBooked} placeholder="3" />
            <Field label="What resonated" value={notes} onChange={setNotes} placeholder="Proof point, pain, or CTA that got traction" />
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: textSubtle }}>Hypothesis confirmed?</p>
            <div className="flex gap-1.5">
              {(['yes', 'no', 'unclear'] as const).map(v => {
                const active = hypothesisConfirmed === v;
                return (
                  <button key={v} type="button" onClick={() => setHypothesisConfirmed(v)}
                    className="text-[11px] font-mono px-3 py-1 rounded-md transition-all hover:opacity-80"
                    style={{ color: active ? accentColor : textSubtle, background: active ? `${accentColor}15` : 'transparent', border: `1px solid ${active ? accentColor : borderC}` }}
                  >{v}</button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center justify-end">
            <button type="button" onClick={submit} disabled={saving || saved}
              className="text-[11px] font-mono px-4 py-1.5 rounded-md transition-all hover:opacity-90 disabled:opacity-60"
              style={{ color: '#fff', background: saved ? '#10b981' : accentColor }}
            >{saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save result'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { border: borderC, text: textMain, textSubtle } = useTheme();
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: textSubtle }}>{label}</span>
      <input type="text" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="text-[12px] rounded-md px-2.5 py-1.5 font-mono focus:outline-none transition-all focus:ring-1 focus:ring-blue-500/30"
        style={{ background: 'transparent', border: `1px solid ${borderC}`, color: textMain }} />
    </label>
  );
}

// ── Variant detail — email + LinkedIn first, ads/grounded signals at bottom ─
function VariantDetail({
  variant, accentColor, sessionId, messageId, onResultSaved,
}: {
  variant: CampaignVariant; accentColor: string;
  sessionId?: string | null; messageId?: string | null;
  onResultSaved?: (variantId: string) => void;
}) {
  const { border: borderC, surface2: cardBg, text: textMain, textMuted, textSubtle } = useTheme();
  const email = variant.channels?.email;
  const linkedin = variant.channels?.linkedin;
  const followUps = uniqueStrings(email?.followUps ?? []);
  const groundedSignals = uniqueStrings(variant.groundedSignals ?? []);

  return (
    <HoverCard style={{ border: `1px solid ${accentColor}`, background: cardBg, boxShadow: `0 0 0 1px ${accentColor}22` }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderBottom: `1px solid ${borderC}`, background: `${accentColor}10` }}>
        <span className="text-[12px] font-mono font-bold px-2.5 py-1 rounded-md shrink-0"
          style={{ color: accentColor, background: `${accentColor}15`, border: `1px solid ${accentColor}30` }}>
          {variant.id}
        </span>
        <span className="text-[15px] font-semibold truncate flex-1" style={{ color: textMain }}>{variant.angle}</span>
      </div>

      {/* Hypothesis + metric */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px" style={{ background: borderC, borderBottom: `1px solid ${borderC}` }}>
        <div className="p-4" style={{ background: `${accentColor}08` }}>
          <p className="text-[10px] font-mono font-semibold uppercase tracking-wider mb-1.5" style={{ color: accentColor }}>Hypothesis</p>
          <p className="text-[14px] leading-relaxed italic" style={{ color: textMuted }}>{variant.hypothesis}</p>
        </div>
        <div className="p-4" style={{ background: cardBg }}>
          <p className="text-[10px] font-mono font-semibold uppercase tracking-wider mb-1.5" style={{ color: textSubtle }}>Success Metric</p>
          <p className="text-[14px] font-mono font-semibold" style={{ color: textMain }}>{variant.successMetric}</p>
          <p className="text-[11px] font-mono mt-1.5" style={{ color: textSubtle }}>Variable: {variant.variable}</p>
        </div>
      </div>

      <div className="px-5 py-5 flex flex-col gap-5">
        {/* Email — primary content */}
        {email && (
          <HoverCard style={{ background: cardBg, border: `1px solid ${borderC}` }}>
            <div className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mail size={14} style={{ color: '#3b82f6' }} />
                  <span className="text-[11px] font-mono font-semibold uppercase tracking-wider" style={{ color: '#3b82f6' }}>Email Sequence</span>
                </div>
                <CopyButton text={`Subject: ${email.subject}\n\n${email.body}`} label="Copy email" />
              </div>
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: textSubtle }}>Subject</p>
                <p className="text-[14px] font-semibold" style={{ color: textMain }}>{email.subject}</p>
              </div>
              <div style={{ borderTop: `1px solid ${borderC}`, paddingTop: '10px' }}>
                <p className="text-[10px] font-mono uppercase tracking-wider mb-1.5" style={{ color: textSubtle }}>Body</p>
                <p className="text-[13px] leading-relaxed whitespace-pre-line" style={{ color: textMuted }}>{email.body}</p>
              </div>
              {followUps.length > 0 && (
                <div style={{ borderTop: `1px solid ${borderC}`, paddingTop: '10px' }}>
                  <p className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: textSubtle }}>Follow-ups</p>
                  <div className="flex flex-col gap-2">
                    {followUps.map((fu, i) => (
                      <div key={`fu-${i}`} className="flex items-start gap-2">
                        <span className="text-[10px] font-mono mt-0.5 shrink-0" style={{ color: textSubtle }}>↳ {i + 1}</span>
                        <p className="text-[13px] leading-relaxed" style={{ color: textMuted }}>{fu}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </HoverCard>
        )}

        {/* LinkedIn */}
        {linkedin && (
          <HoverCard style={{ background: cardBg, border: `1px solid ${borderC}` }}>
            <div className="p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Linkedin size={14} style={{ color: '#0077b5' }} />
                  <span className="text-[11px] font-mono font-semibold uppercase tracking-wider" style={{ color: '#0077b5' }}>LinkedIn</span>
                </div>
                <CopyButton text={`${linkedin.hook}\n\n${linkedin.post}`} label="Copy post" />
              </div>
              <div>
                <p className="text-[10px] font-mono uppercase tracking-wider mb-1" style={{ color: textSubtle }}>Hook</p>
                <p className="text-[14px] font-semibold" style={{ color: textMain }}>{linkedin.hook}</p>
              </div>
              <div style={{ borderTop: `1px solid ${borderC}`, paddingTop: '10px' }}>
                <p className="text-[10px] font-mono uppercase tracking-wider mb-1.5" style={{ color: textSubtle }}>Post</p>
                <p className="text-[13px] leading-relaxed" style={{ color: textMuted }}>{linkedin.post}</p>
              </div>
            </div>
          </HoverCard>
        )}

        {/* Grounded signals — moved to bottom */}
        {groundedSignals.length > 0 && (
          <div className="rounded-lg p-4" style={{ background: `${accentColor}06`, border: `1px solid ${accentColor}18` }}>
            <p className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: accentColor }}>Research Signals</p>
            <ul className="flex flex-col gap-1.5">
              {groundedSignals.map((sig, i) => (
                <li key={`sig-${i}`} className="flex items-start gap-2 text-[13px]" style={{ color: textMuted }}>
                  <span className="font-mono mt-0.5 shrink-0" style={{ color: accentColor }}>›</span>{sig}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Record result — bottom of card */}
        {sessionId && (
          <RecordResultForm variant={variant} accentColor={accentColor} sessionId={sessionId} messageId={messageId} onSaved={onResultSaved} />
        )}
      </div>
    </HoverCard>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export function ExecutionPlan({ output, product, sessionId, messageId, onRefined }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('variants');
  const [activeVariantIdx, setActiveVariantIdx] = useState(0);
  const [isRefining, setIsRefining] = useState(false);
  const [refineStatus, setRefineStatus] = useState<string | null>(null);
  const [refineHadError, setRefineHadError] = useState(false);
  const [variantsWithResults, setVariantsWithResults] = useState<Set<string>>(new Set());
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [publishedSteps, setPublishedSteps] = useState<Set<number>>(new Set());
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<'all' | 'email' | 'linkedin' | 'ads'>('all');
  const { border: borderC, surface: cardBg, surface2: cardBg2, text: textMain, textMuted, textSubtle } = useTheme();

  const variants = (output.variants ?? []).map(variant => ({
    ...variant,
    groundedSignals: uniqueStrings(variant.groundedSignals ?? []),
    channels: {
      ...variant.channels,
      email: variant.channels?.email
        ? { ...variant.channels.email, followUps: uniqueStrings(variant.channels.email.followUps ?? []) }
        : undefined,
    },
  }));
  const deployment = output.deployment ?? [];
  const brief = {
    ...output.brief,
    painPoints: uniqueStrings(output.brief.painPoints ?? []),
    successMetrics: uniqueStrings(output.brief.successMetrics ?? []),
    nextSteps: uniqueStrings(output.brief.nextSteps ?? []),
    keyMessagingAngles: (output.brief.keyMessagingAngles ?? []).filter((angle, idx, arr) =>
      arr.findIndex(a => normalizeText(a.angle) === normalizeText(angle.angle)) === idx,
    ),
  };
  const sources = output.sources ?? [];

  const safeVariantIdx = variants.length === 0 ? 0 : Math.min(activeVariantIdx, variants.length - 1);
  const activeVariant = variants[safeVariantIdx];
  const activeVariantColor = ANGLE_COLORS[safeVariantIdx % ANGLE_COLORS.length];
  const feedbackEnabled = Boolean(sessionId && messageId);

  const onVariantResultSaved = useCallback((variantId: string) => {
    setVariantsWithResults(prev => new Set(prev).add(variantId));
  }, []);

  const toggleStepComplete = useCallback((stepIdx: number) => {
    setCompletedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepIdx)) next.delete(stepIdx); else next.add(stepIdx);
      return next;
    });
  }, []);

  const handlePublishStep = useCallback((stepIdx: number) => {
    setPublishedSteps(prev => new Set(prev).add(stepIdx));
    setCompletedSteps(prev => new Set(prev).add(stepIdx));
    setPublishStatus(`Publish queued for step ${stepIdx + 1}`);
    setTimeout(() => setPublishStatus(null), 3500);
  }, []);

  const handlePublishAll = useCallback(() => {
    const idxs = deployment.map((s, i) => ({ s, i })).filter(({ s }) => selectedChannel === 'all' || s.channel === selectedChannel).map(({ i }) => i);
    setPublishedSteps(prev => new Set([...prev, ...idxs]));
    setCompletedSteps(prev => new Set([...prev, ...idxs]));
    setPublishStatus(idxs.length > 0 ? `Published ${idxs.length} step${idxs.length === 1 ? '' : 's'}` : 'No steps for this channel');
    setTimeout(() => setPublishStatus(null), 3500);
  }, [deployment, selectedChannel]);

  const handleRefine = async () => {
    if (!sessionId || !messageId || isRefining) return;
    setIsRefining(true);
    setRefineStatus('Pulling feedback…');
    setRefineHadError(false);
    try {
      const result = await refineExecutionPlan({ sessionId, messageId });
      if (result.ok) {
        const { recommendationFeedback, recommendationActions, variantResults } = result.feedbackApplied;
        setRefineStatus(`Refined: ${variantResults} results, ${recommendationFeedback} ratings, ${recommendationActions} actions`);
        onRefined?.({ plan: result.executionPlan, orchestratorOutput: result.orchestratorOutput, changes: result.changes });
        setTimeout(() => setRefineStatus(null), 5000);
      } else {
        setRefineHadError(true);
        setRefineStatus(result.error);
        setTimeout(() => setRefineStatus(null), 12000);
      }
    } catch (e) {
      setRefineHadError(true);
      setRefineStatus(e instanceof Error ? e.message : 'Refine failed');
      setTimeout(() => setRefineStatus(null), 12000);
    } finally {
      setIsRefining(false);
    }
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'variants', label: `Variants (${variants.length})`, icon: <Target size={13} /> },
    { key: 'brief', label: 'Campaign Brief', icon: <BookOpen size={13} /> },
    { key: 'deployment', label: `Timeline (${deployment.length})`, icon: <Calendar size={13} /> },
  ];

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid #0070f3`, background: cardBg, boxShadow: '0 0 0 1px rgba(0,112,243,0.1)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 gap-3" style={{ borderBottom: `1px solid ${borderC}`, background: 'rgba(0,112,243,0.05)' }}>
        <div className="flex items-center gap-3 min-w-0">
          <ArrowRight size={15} style={{ color: '#0070f3' }} className="shrink-0" />
          <span className="text-[15px] font-semibold" style={{ color: textMain }}>Execution Plan</span>
          <span className="text-[11px] font-mono px-2.5 py-1 rounded-md truncate" style={{ color: '#0070f3', background: 'rgba(0,112,243,0.1)', border: '1px solid rgba(0,112,243,0.2)' }}>
            {product}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {feedbackEnabled && (
            <button type="button" onClick={handleRefine} disabled={isRefining}
              className="flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-md transition-all hover:opacity-80 disabled:opacity-50"
              style={{ color: '#0070f3', background: 'rgba(0,112,243,0.08)', border: '1px solid rgba(0,112,243,0.3)' }}>
              <RefreshCw size={11} className={isRefining ? 'animate-spin' : ''} />
              {isRefining ? 'Refining…' : 'Refine'}
            </button>
          )}
          <span className="text-[11px] font-mono px-2.5 py-1 rounded-md" style={{
            color: output.confidence === 'high' ? '#10b981' : output.confidence === 'medium' ? '#f59e0b' : '#6b7280',
            background: output.confidence === 'high' ? 'rgba(16,185,129,0.1)' : output.confidence === 'medium' ? 'rgba(245,158,11,0.1)' : 'rgba(107,114,128,0.1)',
            border: `1px solid ${output.confidence === 'high' ? 'rgba(16,185,129,0.25)' : output.confidence === 'medium' ? 'rgba(245,158,11,0.25)' : 'rgba(107,114,128,0.2)'}`,
          }}>{output.confidence}</span>
        </div>
      </div>
      {refineStatus && (
        <div
          className="px-5 py-2 text-[11px] font-mono"
          style={{
            background: refineHadError ? 'rgba(239,68,68,0.08)' : 'rgba(0,112,243,0.05)',
            color: refineHadError ? '#f87171' : '#0070f3',
            borderBottom: `1px solid ${borderC}`,
          }}
        >
          {refineStatus}
        </div>
      )}

      {/* Tabs */}
      <div className="flex" style={{ borderBottom: `1px solid ${borderC}` }}>
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className="flex items-center gap-2 px-5 py-3 text-[13px] font-mono font-medium transition-all hover:opacity-80"
            style={{
              color: activeTab === tab.key ? '#0070f3' : textSubtle,
              borderBottom: activeTab === tab.key ? '2px solid #0070f3' : '2px solid transparent',
              marginBottom: '-1px',
            }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5 lg:p-6">

        {/* ── Variants ── */}
        {activeTab === 'variants' && (
          <div className="flex flex-col gap-5">
            {variants.length > 0 && activeVariant ? (
              <>
                {/* Channel coverage graph */}
                <ChannelCoverageChart variants={variants} />

                {/* Variant tab strip */}
                <div className="flex flex-wrap gap-2" role="tablist">
                  {variants.map((v, i) => {
                    const c = ANGLE_COLORS[i % ANGLE_COLORS.length];
                    const isActive = i === safeVariantIdx;
                    return (
                      <button key={v.id} type="button" role="tab" aria-selected={isActive}
                        onClick={() => setActiveVariantIdx(i)}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-[12px] font-mono transition-all hover:opacity-80"
                        style={{
                          color: isActive ? c : textSubtle,
                          background: isActive ? `${c}12` : 'transparent',
                          border: `1px solid ${isActive ? c : borderC}`,
                          fontWeight: isActive ? 600 : 500,
                          boxShadow: isActive ? `0 0 0 1px ${c}22` : 'none',
                        }}>
                        <span className="font-bold">{v.id}</span>
                        <span className="opacity-80 truncate max-w-[180px]">{v.angle}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Active variant detail */}
                <VariantDetail variant={activeVariant} accentColor={activeVariantColor} sessionId={sessionId} messageId={messageId} onResultSaved={onVariantResultSaved} />

                {/* Nav */}
                <div className="flex items-center justify-between text-[11px] font-mono" style={{ color: textSubtle }}>
                  <span>{safeVariantIdx + 1} of {variants.length}</span>
                  <span className="flex items-center gap-2">
                    <button type="button" onClick={() => setActiveVariantIdx(i => (i - 1 + variants.length) % variants.length)}
                      className="px-3 py-1 rounded-md border transition-all hover:opacity-70" style={{ borderColor: borderC }}>← prev</button>
                    <button type="button" onClick={() => setActiveVariantIdx(i => (i + 1) % variants.length)}
                      className="px-3 py-1 rounded-md border transition-all hover:opacity-70" style={{ borderColor: borderC }}>next →</button>
                  </span>
                </div>
              </>
            ) : (
              <p className="text-[14px]" style={{ color: textMuted }}>No variants generated.</p>
            )}
          </div>
        )}

        {/* ── Brief ── */}
        {activeTab === 'brief' && brief && (
          <div className="flex flex-col gap-5">
            <HoverCard style={{ background: 'rgba(0,112,243,0.05)', border: '1px solid rgba(0,112,243,0.2)' }}>
              <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2" style={{ color: '#0070f3' }}>Objective</p>
                  <p className="text-[14px] leading-relaxed" style={{ color: textMain }}>{brief.objective}</p>
                </div>
                <div>
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2" style={{ color: '#0070f3' }}>Target Audience</p>
                  <p className="text-[14px]" style={{ color: textMain }}>{brief.targetAudience}</p>
                </div>
              </div>
            </HoverCard>

            {brief.painPoints.length > 0 && (
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2" style={{ color: textSubtle }}>Pain Points</p>
                <ul className="flex flex-col gap-1.5">
                  {brief.painPoints.map((p, i) => (
                    <li key={`pain-${i}`} className="flex items-start gap-2 text-[13px]" style={{ color: textMuted }}>
                      <span style={{ color: '#ef4444', marginTop: '2px', flexShrink: 0 }}>✕</span>{p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {brief.keyMessagingAngles.length > 0 && (
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2" style={{ color: textSubtle }}>Key Messaging Angles</p>
                <div className="flex flex-col gap-2">
                  {brief.keyMessagingAngles.map((a, i) => (
                    <HoverCard key={`angle-${i}`} style={{ background: cardBg2, border: `1px solid ${borderC}` }}>
                      <div className="p-4">
                        <p className="text-[13px] font-semibold mb-1" style={{ color: textMain }}>{a.angle}</p>
                        <p className="text-[12px] italic" style={{ color: textMuted }}>{a.hypothesis}</p>
                      </div>
                    </HoverCard>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <HoverCard style={{ background: cardBg2, border: `1px solid ${borderC}` }}>
                <div className="p-4">
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2" style={{ color: textSubtle }}>Channel Strategy</p>
                  <p className="text-[13px]" style={{ color: textMuted }}>{brief.channelStrategy}</p>
                </div>
              </HoverCard>
              <HoverCard style={{ background: cardBg2, border: `1px solid ${borderC}` }}>
                <div className="p-4">
                  <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2" style={{ color: textSubtle }}>Success Metrics</p>
                  <ul className="flex flex-col gap-1">
                    {brief.successMetrics.map((m, i) => (
                      <li key={`metric-${i}`} className="flex items-center gap-2 text-[13px]" style={{ color: textMuted }}>
                        <CheckCircle2 size={11} style={{ color: '#10b981', flexShrink: 0 }} />{m}
                      </li>
                    ))}
                  </ul>
                </div>
              </HoverCard>
            </div>

            {brief.nextSteps.length > 0 && (
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2" style={{ color: textSubtle }}>Next Steps</p>
                <ol className="flex flex-col gap-1.5">
                  {brief.nextSteps.map((s, i) => (
                    <li key={`step-${i}`} className="flex items-start gap-2 text-[13px]" style={{ color: textMuted }}>
                      <span className="text-[11px] font-mono w-5 shrink-0 mt-0.5 font-semibold" style={{ color: '#0070f3' }}>{i + 1}.</span>{s}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        {/* ── Deployment ── */}
        {activeTab === 'deployment' && (
          <div className="flex flex-col gap-4">
            {deployment.length > 0 ? (
              <>
                <DeploymentTimeline steps={deployment} />

                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {(['all', 'email', 'linkedin', 'ads'] as const).map(ch => {
                      const active = selectedChannel === ch;
                      return (
                        <button key={ch} type="button" onClick={() => setSelectedChannel(ch)}
                          className="text-[11px] font-mono px-3 py-1.5 rounded-md transition-all hover:opacity-80"
                          style={{ color: active ? '#0070f3' : textSubtle, background: active ? 'rgba(0,112,243,0.08)' : 'transparent', border: `1px solid ${active ? 'rgba(0,112,243,0.2)' : borderC}` }}>
                          {ch === 'all' ? 'All' : ch}
                        </button>
                      );
                    })}
                  </div>
                  <button type="button" onClick={handlePublishAll}
                    className="text-[11px] font-mono px-4 py-1.5 rounded-md transition-all hover:opacity-80"
                    style={{ color: '#fff', background: '#0070f3' }}>
                    Publish all
                  </button>
                </div>

                {publishStatus && (
                  <div className="text-[11px] font-mono px-3 py-2 rounded-md" style={{ color: '#0070f3', background: 'rgba(0,112,243,0.06)', border: '1px solid rgba(0,112,243,0.15)' }}>
                    {publishStatus}
                  </div>
                )}

                {[...deployment].sort((a, b) => a.day - b.day).map((step, i) => {
                  const isDone = completedSteps.has(i);
                  const isPublished = publishedSteps.has(i);
                  const stepVisible = selectedChannel === 'all' || step.channel === selectedChannel;
                  return (
                    <HoverCard key={`deploy-${i}`} style={{
                      background: cardBg2, border: `1px solid ${isDone ? 'rgba(16,185,129,0.3)' : borderC}`,
                      opacity: stepVisible ? (isDone ? 0.75 : 1) : 0.5,
                    }}>
                      <div className="flex items-start gap-3 px-4 py-3.5">
                        <button type="button" onClick={() => toggleStepComplete(i)} className="mt-1 shrink-0 transition-all hover:scale-110"
                          style={{ color: isDone ? '#10b981' : borderC }}>
                          {isDone ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                        </button>
                        <div className="flex flex-col items-center gap-0.5 shrink-0 w-12">
                          <span className="text-[10px] font-mono" style={{ color: textSubtle }}>Day</span>
                          <span className="text-[18px] font-bold font-mono" style={{ color: isDone ? '#10b981' : '#0070f3' }}>{step.day}</span>
                        </div>
                        <div className="w-px self-stretch mx-1" style={{ background: borderC }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="flex items-center gap-1.5 text-[11px] font-mono px-2 py-0.5 rounded-md"
                              style={{ color: CHANNEL_COLORS[step.channel] ?? textSubtle, background: `${CHANNEL_COLORS[step.channel] ?? '#666'}15`, border: `1px solid ${CHANNEL_COLORS[step.channel] ?? '#666'}30` }}>
                              {CHANNEL_ICONS[step.channel]} {step.channel}
                            </span>
                            {isPublished && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-md" style={{ color: '#10b981', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)' }}>published</span>
                            )}
                          </div>
                          <p className="text-[13px] font-medium" style={{ color: textMain, textDecoration: isDone ? 'line-through' : 'none' }}>{step.action}</p>
                          <p className="text-[12px] mt-1" style={{ color: textSubtle }}>Audience: {step.audience}</p>
                          <div className="flex items-center gap-2 mt-2.5">
                            <button type="button" onClick={() => handlePublishStep(i)}
                              className="text-[11px] font-mono px-3 py-1 rounded-md transition-all hover:opacity-80"
                              style={{ color: '#0070f3', background: 'rgba(0,112,243,0.08)', border: '1px solid rgba(0,112,243,0.2)' }}>
                              publish
                            </button>
                            <button type="button" onClick={() => toggleStepComplete(i)}
                              className="text-[11px] font-mono px-3 py-1 rounded-md transition-all hover:opacity-70"
                              style={{ color: textSubtle, border: `1px solid ${borderC}` }}>
                              {isDone ? 'undo' : 'complete'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </HoverCard>
                  );
                })}
              </>
            ) : (
              <p className="text-[14px]" style={{ color: textMuted }}>No deployment steps generated.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
