'use client';

/**
 * Member 3 — ExecutionPlan Artifact
 *
 * Renders inline in the chat thread when the Execution Engine returns an
 * execution-plan artifact. Tabs: Variants | Brief | Deployment.
 *
 * Design rules:
 *  - Renders as a card inside the conversation (not-a-chatbot rule)
 *  - Reads theme tokens from ThemeContext (same as page.tsx and other components)
 *  - Each variant clearly shows the falsifiable hypothesis
 */

import { useState, useCallback } from 'react';
import { Mail, Linkedin, Target, BookOpen, Calendar, CheckCircle2, Circle, ArrowRight, Copy, Check, RefreshCw, BarChart3, ChevronDown } from 'lucide-react';
import { useTheme } from '@/lib/theme-provider';
import type { ExecutionPlanOutput, CampaignVariant, OrchestratorOutput, RefinementDelta } from '../../lib/agents/types';
import { recordVariantResult, refineExecutionPlan } from '@/lib/feedback';

interface Props {
  output: ExecutionPlanOutput;
  product: string;
  // Optional — if provided the variant/refine actions will be wired to the
  // feedback loop. Omit in preview/storybook contexts.
  sessionId?: string | null;
  messageId?: string | null;
  onRefined?: (result: { plan: ExecutionPlanOutput; orchestratorOutput?: OrchestratorOutput; changes?: RefinementDelta[] }) => void;
}

type Tab = 'variants' | 'brief' | 'deployment';

const ANGLE_COLORS = ['#3b82f6', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#6366f1'];

// ── Tiny copy-to-clipboard button used inside variant cards ─────────────────
function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const { textSubtle, border: borderC } = useTheme();
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard unavailable — no-op */ }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      className="text-[10px] font-mono px-2 py-0.5 rounded flex items-center gap-1 transition-colors"
      style={{ color: copied ? '#10b981' : textSubtle, border: `1px solid ${copied ? 'rgba(16,185,129,0.35)' : borderC}` }}
      title={copied ? 'Copied' : 'Copy to clipboard'}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  email: <Mail size={12} />,
  linkedin: <Linkedin size={12} />,
  ads: <Target size={12} />,
};

const PRIORITY_COLORS: Record<string, string> = {
  email:    '#3b82f6',
  linkedin: '#0077b5',
  ads:      '#f59e0b',
};

// ── Record result mini-form ─────────────────────────────────────────────────
// Lets the user paste actual campaign numbers for a variant. Stores them via
// /api/feedback so the refiner can reason over them on the next refine.
function RecordResultForm({
  variant,
  accentColor,
  sessionId,
  messageId,
  onSaved,
}: {
  variant: CampaignVariant;
  accentColor: string;
  sessionId: string;
  messageId?: string | null;
  onSaved?: (variantId: string) => void;
}) {
  const { border: borderC, surface: cardBg, text: textMain, textMuted, textSubtle } = useTheme();
  const [open, setOpen] = useState(false);
  const [sentCount, setSentCount] = useState('');
  const [openRate, setOpenRate] = useState('');
  const [replyRate, setReplyRate] = useState('');
  const [meetingsBooked, setMeetingsBooked] = useState('');
  const [hypothesisConfirmed, setHypothesisConfirmed] = useState<'yes' | 'no' | 'unclear' | ''>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const numOrUndef = (s: string) => {
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : undefined;
  };

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await recordVariantResult({
      sessionId,
      messageId,
      variantId: variant.id,
      variantAngle: variant.angle,
      hypothesis: variant.hypothesis,
      successMetric: variant.successMetric,
      sentCount: numOrUndef(sentCount),
      openRate: numOrUndef(openRate),
      replyRate: numOrUndef(replyRate),
      meetingsBooked: numOrUndef(meetingsBooked),
      hypothesisConfirmed: hypothesisConfirmed || undefined,
      notes: notes || undefined,
    });
    setSaving(false);
    if (ok) {
      setSaved(true);
      onSaved?.(variant.id);
      setTimeout(() => { setSaved(false); setOpen(false); }, 1800);
    }
  };

  return (
    <div className="rounded-md overflow-hidden" style={{ border: `1px dashed ${borderC}` }}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-[10px] font-mono uppercase tracking-wider transition-colors"
        style={{ color: accentColor, background: `${accentColor}08` }}
      >
        <span className="flex items-center gap-1.5">
          <BarChart3 size={11} /> Record campaign result
        </span>
        <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms' }} />
      </button>
      {open && (
        <div className="p-3 flex flex-col gap-3" style={{ background: cardBg }}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Field label="Sent" value={sentCount} onChange={setSentCount} placeholder="250" />
            <Field label="Open %" value={openRate} onChange={setOpenRate} placeholder="42" />
            <Field label="Reply %" value={replyRate} onChange={setReplyRate} placeholder="4.2" />
            <Field label="Meetings" value={meetingsBooked} onChange={setMeetingsBooked} placeholder="3" />
          </div>
          <div>
            <p className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: textSubtle }}>Hypothesis confirmed?</p>
            <div className="flex gap-1">
              {(['yes', 'no', 'unclear'] as const).map(v => {
                const active = hypothesisConfirmed === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setHypothesisConfirmed(v)}
                    className="text-[10px] font-mono px-2 py-1 rounded transition-colors"
                    style={{
                      color: active ? accentColor : textSubtle,
                      background: active ? `${accentColor}15` : 'transparent',
                      border: `1px solid ${active ? accentColor : borderC}`,
                    }}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: textSubtle }}>Notes</p>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              placeholder="What worked / what didn't"
              className="w-full text-[11px] rounded px-2 py-1.5 font-sans resize-none focus:outline-none"
              style={{ background: 'transparent', border: `1px solid ${borderC}`, color: textMain }}
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[9px] font-mono" style={{ color: textSubtle }}>
              Feeds the refiner on your next <span style={{ color: accentColor }}>Refine with feedback</span> click.
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={saving || saved}
              className="text-[10px] font-mono px-3 py-1 rounded transition-colors disabled:opacity-60"
              style={{ color: '#fff', background: saved ? '#10b981' : accentColor, border: `1px solid ${saved ? '#10b981' : accentColor}` }}
            >
              {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save result'}
            </button>
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
      <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: textSubtle }}>{label}</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="text-[11px] rounded px-2 py-1 font-mono focus:outline-none"
        style={{ background: 'transparent', border: `1px solid ${borderC}`, color: textMain }}
      />
    </label>
  );
}

// ── Active variant detail panel ─────────────────────────────────────────────
//
// Renders one variant in full. Hypothesis + success metric are pinned at the
// top of the panel so users can compare two variants by just clicking between
// tabs without losing the test context.
function VariantDetail({
  variant,
  accentColor,
  sessionId,
  messageId,
  onResultSaved,
}: {
  variant: CampaignVariant;
  accentColor: string;
  sessionId?: string | null;
  messageId?: string | null;
  onResultSaved?: (variantId: string) => void;
}) {
  const { border: borderC, surface2: cardBg, text: textMain, textMuted, textSubtle } = useTheme();
  const email = variant.channels?.email;
  const linkedin = variant.channels?.linkedin;
  const followUps = email?.followUps ?? [];
  const groundedSignals = variant.groundedSignals ?? [];

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${accentColor}`, background: cardBg, boxShadow: `0 0 0 1px ${accentColor}22` }}>
      {/* Header — angle + ID */}
      <div className="flex items-center gap-2.5 px-4 py-3" style={{ borderBottom: `1px solid ${borderC}`, background: `${accentColor}10` }}>
        <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded shrink-0"
          style={{ color: accentColor, background: `${accentColor}15`, border: `1px solid ${accentColor}30` }}>
          {variant.id}
        </span>
        <span className="text-[13px] font-semibold truncate flex-1" style={{ color: textMain }}>{variant.angle}</span>
      </div>

      {/* Hypothesis + metric — always visible, pinned to the top */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px" style={{ background: borderC, borderBottom: `1px solid ${borderC}` }}>
        <div className="p-3" style={{ background: `${accentColor}08` }}>
          <p className="text-[10px] font-mono font-semibold uppercase tracking-wider mb-1" style={{ color: accentColor }}>Hypothesis</p>
          <p className="text-[12px] leading-relaxed italic" style={{ color: textMuted }}>{variant.hypothesis}</p>
        </div>
        <div className="p-3" style={{ background: cardBg }}>
          <p className="text-[10px] font-mono font-semibold uppercase tracking-wider mb-1" style={{ color: textSubtle }}>Success Metric</p>
          <p className="text-[12px] font-mono" style={{ color: textMain }}>{variant.successMetric}</p>
          <p className="text-[10px] font-mono mt-1" style={{ color: textSubtle }}>
            <span className="opacity-70">Variable: </span>{variant.variable}
          </p>
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-4">
        {/* Email */}
        {email && (
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5">
                <Mail size={12} style={{ color: '#3b82f6' }} />
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider" style={{ color: '#3b82f6' }}>Email Sequence</span>
              </div>
              <CopyButton text={`Subject: ${email.subject}\n\n${email.body}`} label="Copy email" />
            </div>
            <div className="rounded-md p-3 flex flex-col gap-2" style={{ background: cardBg, border: `1px solid ${borderC}` }}>
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider mb-0.5" style={{ color: textSubtle }}>Subject</p>
                <p className="text-[12px] font-medium" style={{ color: textMain }}>{email.subject}</p>
              </div>
              <div style={{ borderTop: `1px solid ${borderC}`, paddingTop: '8px' }}>
                <p className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: textSubtle }}>Body</p>
                <p className="text-[12px] leading-relaxed whitespace-pre-line" style={{ color: textMuted }}>{email.body}</p>
              </div>
              {followUps.length > 0 && (
                <div style={{ borderTop: `1px solid ${borderC}`, paddingTop: '8px' }}>
                  <p className="text-[9px] font-mono uppercase tracking-wider mb-1.5" style={{ color: textSubtle }}>Follow-ups</p>
                  <div className="flex flex-col gap-1.5">
                    {followUps.map((fu, i) => (
                      <div key={`fu-${i}-${fu.slice(0, 12)}`} className="flex items-start gap-2">
                        <span className="text-[9px] font-mono mt-0.5 shrink-0" style={{ color: textSubtle }}>↳ {i + 1}</span>
                        <p className="text-[11px] leading-relaxed" style={{ color: textMuted }}>{fu}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* LinkedIn */}
        {linkedin && (
          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5">
                <Linkedin size={12} style={{ color: '#0077b5' }} />
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider" style={{ color: '#0077b5' }}>LinkedIn</span>
              </div>
              <CopyButton text={`${linkedin.hook}\n\n${linkedin.post}`} label="Copy post" />
            </div>
            <div className="rounded-md p-3 flex flex-col gap-2" style={{ background: cardBg, border: `1px solid ${borderC}` }}>
              <div>
                <p className="text-[9px] font-mono uppercase tracking-wider mb-0.5" style={{ color: textSubtle }}>Hook</p>
                <p className="text-[12px] font-semibold" style={{ color: textMain }}>{linkedin.hook}</p>
              </div>
              <div style={{ borderTop: `1px solid ${borderC}`, paddingTop: '8px' }}>
                <p className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: textSubtle }}>Post</p>
                <p className="text-[12px] leading-relaxed" style={{ color: textMuted }}>{linkedin.post}</p>
              </div>
            </div>
          </div>
        )}

        {/* Grounded signals */}
        {groundedSignals.length > 0 && (
          <div>
            <p className="text-[9px] font-mono uppercase tracking-wider mb-1.5" style={{ color: textSubtle }}>Grounded Signals</p>
            <ul className="flex flex-col gap-1">
              {groundedSignals.map((sig, i) => (
                <li key={`sig-${i}-${sig.slice(0, 12)}`} className="flex items-start gap-1.5 text-[11px]" style={{ color: textSubtle }}>
                  <span className="font-mono mt-0.5 shrink-0" style={{ color: accentColor }}>›</span>{sig}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Record result form — only shown when feedback loop is active */}
        {sessionId && (
          <RecordResultForm
            variant={variant}
            accentColor={accentColor}
            sessionId={sessionId}
            messageId={messageId}
            onSaved={onResultSaved}
          />
        )}
      </div>
    </div>
  );
}

export function ExecutionPlan({ output, product, sessionId, messageId, onRefined }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('variants');
  const [activeVariantIdx, setActiveVariantIdx] = useState(0);
  const [isRefining, setIsRefining] = useState(false);
  const [refineStatus, setRefineStatus] = useState<string | null>(null);
  // Track which variants have recorded results (local state — set by RecordResultForm callback)
  const [variantsWithResults, setVariantsWithResults] = useState<Set<string>>(new Set());
  // Track completed deployment steps (local toggle)
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const { border: borderC, surface: cardBg, surface2: cardBg2, text: textMain, textMuted, textSubtle } = useTheme();

  const variants = output.variants ?? [];
  const deployment = output.deployment ?? [];
  const brief = output.brief;

  // Clamp the active variant index in case the variant list shrinks (e.g.
  // a re-render with sparser data) so we never index out of bounds.
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
      if (next.has(stepIdx)) next.delete(stepIdx);
      else next.add(stepIdx);
      return next;
    });
  }, []);

  const handleRefine = async () => {
    if (!sessionId || !messageId || isRefining) return;
    setIsRefining(true);
    setRefineStatus('Pulling feedback…');
    try {
      const result = await refineExecutionPlan({ sessionId, messageId });
      if (result?.executionPlan) {
        const { recommendationFeedback, recommendationActions, variantResults } = result.feedbackApplied;
        setRefineStatus(`Refined with ${variantResults} results, ${recommendationFeedback} ratings, ${recommendationActions} actions`);
        onRefined?.({
          plan: result.executionPlan,
          orchestratorOutput: result.orchestratorOutput,
          changes: result.changes,
        });
      } else {
        setRefineStatus('Refine failed — check logs');
      }
    } catch {
      setRefineStatus('Refine failed');
    } finally {
      setIsRefining(false);
      setTimeout(() => setRefineStatus(null), 4000);
    }
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'variants',   label: `Variants (${variants.length})`, icon: <Target size={12} /> },
    { key: 'brief',      label: 'Campaign Brief',  icon: <BookOpen size={12} /> },
    { key: 'deployment', label: `Deployment (${completedSteps.size > 0 ? `${completedSteps.size}/${deployment.length}` : deployment.length})`, icon: <Calendar size={12} /> },
  ];

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid #0070f3`, background: cardBg, boxShadow: '0 0 0 1px rgba(0,112,243,0.1)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 gap-3" style={{ borderBottom: `1px solid ${borderC}`, background: 'rgba(0,112,243,0.06)' }}>
        <div className="flex items-center gap-2.5 min-w-0">
          <ArrowRight size={14} style={{ color: '#0070f3' }} className="shrink-0" />
          <span className="text-[13px] font-semibold" style={{ color: textMain }}>Execution Plan</span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded truncate" style={{ color: '#0070f3', background: 'rgba(0,112,243,0.1)', border: '1px solid rgba(0,112,243,0.2)' }}>
            {product}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Refine button — pulls feedback + re-runs full orchestration loop */}
          {feedbackEnabled && (
            <button
              type="button"
              onClick={handleRefine}
              disabled={isRefining}
              className="flex items-center gap-1.5 text-[10px] font-mono px-2 py-1 rounded transition-colors disabled:opacity-50"
              style={{ color: '#0070f3', background: 'rgba(0,112,243,0.08)', border: '1px solid rgba(0,112,243,0.3)' }}
              title="Re-run research + execution with your feedback and recorded variant outcomes"
            >
              <RefreshCw size={10} className={isRefining ? 'animate-spin' : ''} />
              {isRefining ? 'Refining…' : 'Refine with feedback'}
            </button>
          )}
          {/* Confidence */}
          <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{
            color:   output.confidence === 'high' ? '#10b981' : output.confidence === 'medium' ? '#f59e0b' : '#6b7280',
            background: output.confidence === 'high' ? 'rgba(16,185,129,0.1)' : output.confidence === 'medium' ? 'rgba(245,158,11,0.1)' : 'rgba(107,114,128,0.1)',
            border: `1px solid ${output.confidence === 'high' ? 'rgba(16,185,129,0.25)' : output.confidence === 'medium' ? 'rgba(245,158,11,0.25)' : 'rgba(107,114,128,0.2)'}`,
          }}>
            {output.confidence} confidence
          </span>
        </div>
      </div>
      {refineStatus && (
        <div className="px-5 py-1.5 text-[10px] font-mono" style={{ background: 'rgba(0,112,243,0.06)', color: '#0070f3', borderBottom: `1px solid ${borderC}` }}>
          {refineStatus}
        </div>
      )}

      {/* Tabs */}
      <div className="flex" style={{ borderBottom: `1px solid ${borderC}` }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-mono font-medium transition-colors"
            style={{
              color: activeTab === tab.key ? '#0070f3' : textSubtle,
              borderBottom: activeTab === tab.key ? '2px solid #0070f3' : '2px solid transparent',
              marginBottom: '-1px',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-5">

        {/* ── Variants Tab ── */}
        {activeTab === 'variants' && (
          <div className="flex flex-col gap-4">
            {variants.length > 0 && activeVariant ? (
              <>
                {/* Variant outcome tracking progress */}
                {feedbackEnabled && variants.length > 0 && (
                  <div className="flex items-center gap-3 rounded-md px-3 py-2" style={{ background: `${variantsWithResults.size > 0 ? '#10b981' : '#0070f3'}08`, border: `1px solid ${variantsWithResults.size > 0 ? 'rgba(16,185,129,0.2)' : 'rgba(0,112,243,0.15)'}` }}>
                    <div className="flex items-center gap-1.5">
                      <BarChart3 size={12} style={{ color: variantsWithResults.size > 0 ? '#10b981' : '#0070f3' }} />
                      <span className="text-[10px] font-mono font-semibold" style={{ color: variantsWithResults.size > 0 ? '#10b981' : '#0070f3' }}>
                        {variantsWithResults.size}/{variants.length} tracked
                      </span>
                    </div>
                    <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: `${borderC}` }}>
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${(variantsWithResults.size / variants.length) * 100}%`,
                          background: variantsWithResults.size === variants.length ? '#10b981' : '#0070f3',
                        }}
                      />
                    </div>
                    <span className="text-[9px] font-mono" style={{ color: textSubtle }}>
                      {variantsWithResults.size === 0
                        ? 'Record campaign results below to feed the refiner'
                        : variantsWithResults.size === variants.length
                          ? 'All variants tracked — ready to refine'
                          : `${variants.length - variantsWithResults.size} remaining`}
                    </span>
                  </div>
                )}

                {/* Variant tab strip — one button per variant */}
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Variants">
                  {variants.map((v, i) => {
                    const c = ANGLE_COLORS[i % ANGLE_COLORS.length];
                    const isActive = i === safeVariantIdx;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setActiveVariantIdx(i)}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors"
                        style={{
                          color: isActive ? c : textSubtle,
                          background: isActive ? `${c}12` : 'transparent',
                          border: `1px solid ${isActive ? c : borderC}`,
                          fontWeight: isActive ? 600 : 500,
                        }}
                      >
                        <span className="font-bold">{v.id}</span>
                        <span className="opacity-80 truncate max-w-[160px]">{v.angle}</span>
                      </button>
                    );
                  })}
                </div>

                <VariantDetail variant={activeVariant} accentColor={activeVariantColor} sessionId={sessionId} messageId={messageId} onResultSaved={onVariantResultSaved} />

                {/* Compare hint + actions */}
                <div className="flex items-center justify-between text-[10px] font-mono" style={{ color: textSubtle }}>
                  <span>Showing {safeVariantIdx + 1} of {variants.length} — click any tab above to compare.</span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setActiveVariantIdx(i => (i - 1 + variants.length) % variants.length)}
                      className="px-1.5 py-0.5 rounded border transition-colors"
                      style={{ borderColor: borderC, color: textSubtle }}
                      aria-label="Previous variant"
                    >prev</button>
                    <button
                      type="button"
                      onClick={() => setActiveVariantIdx(i => (i + 1) % variants.length)}
                      className="px-1.5 py-0.5 rounded border transition-colors"
                      style={{ borderColor: borderC, color: textSubtle }}
                      aria-label="Next variant"
                    >next</button>
                  </span>
                </div>
              </>
            ) : (
              <p className="text-[13px]" style={{ color: textMuted }}>No variants generated.</p>
            )}
          </div>
        )}

        {/* ── Campaign Brief Tab ── */}
        {activeTab === 'brief' && brief && (
          <div className="flex flex-col gap-5">
            {/* Objective + Audience hero — pinned at top so users always see
                what the campaign is for and who it's targeting before reading
                the supporting messaging detail. */}
            <div className="rounded-md p-4 grid grid-cols-1 md:grid-cols-3 gap-4" style={{ background: 'rgba(0,112,243,0.05)', border: '1px solid rgba(0,112,243,0.2)' }}>
              <div className="md:col-span-2">
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#0070f3' }}>Objective</p>
                <p className="text-[13px] leading-relaxed" style={{ color: textMain }}>{brief.objective}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-1.5" style={{ color: '#0070f3' }}>Target Audience</p>
                <p className="text-[13px]" style={{ color: textMain }}>{brief.targetAudience}</p>
              </div>
            </div>

            {/* Pain points */}
            {(brief.painPoints?.length ?? 0) > 0 && (
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-1.5" style={{ color: textSubtle }}>Pain Points</p>
                <ul className="flex flex-col gap-1">
                  {(brief.painPoints ?? []).map((p, i) => (
                    <li key={`pain-${i}-${p.slice(0, 12)}`} className="flex items-start gap-1.5 text-[12px]" style={{ color: textMuted }}>
                      <span style={{ color: '#ef4444', marginTop: '2px', flexShrink: 0 }}>✕</span>{p}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Key messaging angles */}
            {brief.keyMessagingAngles && brief.keyMessagingAngles.length > 0 && (
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2" style={{ color: textSubtle }}>Key Messaging Angles</p>
                <div className="flex flex-col gap-2">
                  {brief.keyMessagingAngles.map((a, i) => (
                    <div key={`angle-${i}-${a.angle.slice(0, 12)}`} className="rounded-md p-3" style={{ background: cardBg2, border: `1px solid ${borderC}` }}>
                      <p className="text-[12px] font-semibold mb-1" style={{ color: textMain }}>{a.angle}</p>
                      <p className="text-[11px] italic" style={{ color: textMuted }}>{a.hypothesis}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Channel strategy + success metrics */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-1.5" style={{ color: textSubtle }}>Channel Strategy</p>
                <p className="text-[12px]" style={{ color: textMuted }}>{brief.channelStrategy}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-1.5" style={{ color: textSubtle }}>Success Metrics</p>
                <ul className="flex flex-col gap-0.5">
                  {(brief.successMetrics ?? []).map((m, i) => (
                    <li key={`metric-${i}-${m.slice(0, 12)}`} className="flex items-center gap-1.5 text-[12px]" style={{ color: textMuted }}>
                      <CheckCircle2 size={10} style={{ color: '#10b981', flexShrink: 0 }} />{m}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Next steps */}
            {brief.nextSteps && brief.nextSteps.length > 0 && (
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-1.5" style={{ color: textSubtle }}>Next Steps</p>
                <ol className="flex flex-col gap-1">
                  {brief.nextSteps.map((s, i) => (
                    <li key={`step-${i}-${s.slice(0, 12)}`} className="flex items-start gap-2 text-[12px]" style={{ color: textMuted }}>
                      <span className="text-[10px] font-mono w-4 shrink-0 mt-0.5" style={{ color: '#0070f3' }}>{i + 1}.</span>{s}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}

        {/* ── Deployment Tab ── */}
        {activeTab === 'deployment' && (
          <div className="flex flex-col gap-3">
            {deployment.length > 0 ? (
              <>
                {/* Progress summary */}
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-mono uppercase tracking-wider" style={{ color: textSubtle }}>
                    Sequenced rollout — {deployment.length} {deployment.length === 1 ? 'step' : 'steps'}
                  </p>
                  {completedSteps.size > 0 && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{
                      color: completedSteps.size === deployment.length ? '#10b981' : '#0070f3',
                      background: completedSteps.size === deployment.length ? 'rgba(16,185,129,0.1)' : 'rgba(0,112,243,0.08)',
                      border: `1px solid ${completedSteps.size === deployment.length ? 'rgba(16,185,129,0.25)' : 'rgba(0,112,243,0.2)'}`,
                    }}>
                      {completedSteps.size}/{deployment.length} completed
                    </span>
                  )}
                </div>

                {/* Sort by day so the timeline always reads top-to-bottom in chronological order */}
                {[...deployment].sort((a, b) => a.day - b.day).map((step, i) => {
                  const isDone = completedSteps.has(i);
                  return (
                    <div key={`deploy-${i}-${step.day}-${step.channel}`}
                      className="flex items-start gap-3 rounded-md px-3 py-2.5 transition-opacity"
                      style={{
                        background: isDone ? `${cardBg2}` : cardBg2,
                        border: `1px solid ${isDone ? 'rgba(16,185,129,0.3)' : borderC}`,
                        opacity: isDone ? 0.65 : 1,
                      }}>
                      {/* Completion toggle */}
                      <button
                        type="button"
                        onClick={() => toggleStepComplete(i)}
                        className="mt-2 shrink-0 transition-colors"
                        title={isDone ? 'Mark as pending' : 'Mark as completed'}
                        style={{ color: isDone ? '#10b981' : borderC }}
                      >
                        {isDone
                          ? <CheckCircle2 size={16} />
                          : <Circle size={16} />}
                      </button>
                      {/* Day badge */}
                      <div className="flex flex-col items-center gap-0.5 shrink-0 w-10">
                        <span className="text-[9px] font-mono" style={{ color: textSubtle }}>Day</span>
                        <span className="text-[16px] font-bold font-mono" style={{ color: isDone ? '#10b981' : '#0070f3', lineHeight: 1 }}>{step.day}</span>
                      </div>
                      {/* Separator */}
                      <div className="w-px self-stretch mx-1" style={{ background: borderC }} />
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded"
                            style={{
                              color: PRIORITY_COLORS[step.channel] ?? textSubtle,
                              background: `${PRIORITY_COLORS[step.channel] ?? '#666'}15`,
                              border: `1px solid ${PRIORITY_COLORS[step.channel] ?? '#666'}30`,
                            }}>
                            {CHANNEL_ICONS[step.channel]} {step.channel}
                          </span>
                        </div>
                        <p className="text-[12px] font-medium" style={{ color: textMain, textDecoration: isDone ? 'line-through' : 'none' }}>{step.action}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: textSubtle }}>
                          <span className="opacity-70">Audience: </span>{step.audience}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              <p className="text-[13px]" style={{ color: textMuted }}>No deployment steps generated.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
