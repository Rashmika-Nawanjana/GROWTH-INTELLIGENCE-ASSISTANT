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

import { useState } from 'react';
import { ChevronRight, Mail, Linkedin, Target, BookOpen, Calendar, CheckCircle2, ArrowRight } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import type { ExecutionPlanOutput, CampaignVariant, DeploymentStep } from '../../lib/agents/types';

interface Props {
  output: ExecutionPlanOutput;
  product: string;
}

type Tab = 'variants' | 'brief' | 'deployment';

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

function VariantCard({ variant, idx }: { variant: CampaignVariant; idx: number }) {
  const [expanded, setExpanded] = useState(false);
  const { isDark, border: borderC, surface2: cardBg, text: textMain, textMuted, textSubtle } = useTheme();

  const ANGLE_COLORS = ['#3b82f6', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#6366f1'];
  const accentColor = ANGLE_COLORS[idx % ANGLE_COLORS.length];

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${expanded ? accentColor : borderC}`, background: cardBg, boxShadow: expanded ? `0 0 0 1px ${accentColor}22` : 'none', transition: 'border-color 0.15s, box-shadow 0.15s' }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
        style={{ borderBottom: expanded ? `1px solid ${borderC}` : 'none' }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded shrink-0"
            style={{ color: accentColor, background: `${accentColor}15`, border: `1px solid ${accentColor}30` }}>
            {variant.id}
          </span>
          <span className="text-[13px] font-semibold truncate" style={{ color: textMain }}>{variant.angle}</span>
        </div>
        <ChevronRight size={14} style={{ color: textSubtle, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>

      {/* Hypothesis — always visible */}
      <div className="px-4 py-2.5" style={{ borderBottom: `1px solid ${borderC}`, background: `${accentColor}08` }}>
        <p className="text-[10px] font-mono font-semibold uppercase tracking-wider mb-1" style={{ color: accentColor }}>Hypothesis</p>
        <p className="text-[12px] leading-relaxed italic" style={{ color: textMuted }}>{variant.hypothesis}</p>
      </div>

      {/* Meta row */}
      <div className="px-4 py-2 flex flex-wrap gap-3" style={{ borderBottom: expanded ? `1px solid ${borderC}` : 'none' }}>
        <div>
          <p className="text-[9px] font-mono uppercase tracking-wider mb-0.5" style={{ color: textSubtle }}>Success Metric</p>
          <p className="text-[11px] font-mono" style={{ color: textMuted }}>{variant.successMetric}</p>
        </div>
        <div>
          <p className="text-[9px] font-mono uppercase tracking-wider mb-0.5" style={{ color: textSubtle }}>Variable Tested</p>
          <p className="text-[11px] font-mono" style={{ color: textMuted }}>{variant.variable}</p>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-4 pt-3">
          {/* Email */}
          {variant.channels.email && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Mail size={12} style={{ color: '#3b82f6' }} />
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider" style={{ color: '#3b82f6' }}>Email Sequence</span>
              </div>
              <div className="rounded-md p-3 flex flex-col gap-2" style={{ background: cardBg, border: `1px solid ${borderC}` }}>
                <div>
                  <p className="text-[9px] font-mono uppercase tracking-wider mb-0.5" style={{ color: textSubtle }}>Subject</p>
                  <p className="text-[12px] font-medium" style={{ color: textMain }}>{variant.channels.email.subject}</p>
                </div>
                <div style={{ borderTop: `1px solid ${borderC}`, paddingTop: '8px' }}>
                  <p className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: textSubtle }}>Body</p>
                  <p className="text-[12px] leading-relaxed whitespace-pre-line" style={{ color: textMuted }}>{variant.channels.email.body}</p>
                </div>
                {variant.channels.email.followUps && variant.channels.email.followUps.length > 0 && (
                  <div style={{ borderTop: `1px solid ${borderC}`, paddingTop: '8px' }}>
                    <p className="text-[9px] font-mono uppercase tracking-wider mb-1.5" style={{ color: textSubtle }}>Follow-ups</p>
                    <div className="flex flex-col gap-1.5">
                      {variant.channels.email.followUps.map((fu, i) => (
                        <div key={i} className="flex items-start gap-2">
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
          {variant.channels.linkedin && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Linkedin size={12} style={{ color: '#0077b5' }} />
                <span className="text-[10px] font-mono font-semibold uppercase tracking-wider" style={{ color: '#0077b5' }}>LinkedIn</span>
              </div>
              <div className="rounded-md p-3 flex flex-col gap-2" style={{ background: cardBg, border: `1px solid ${borderC}` }}>
                <div>
                  <p className="text-[9px] font-mono uppercase tracking-wider mb-0.5" style={{ color: textSubtle }}>Hook</p>
                  <p className="text-[12px] font-semibold" style={{ color: textMain }}>{variant.channels.linkedin.hook}</p>
                </div>
                <div style={{ borderTop: `1px solid ${borderC}`, paddingTop: '8px' }}>
                  <p className="text-[9px] font-mono uppercase tracking-wider mb-1" style={{ color: textSubtle }}>Post</p>
                  <p className="text-[12px] leading-relaxed" style={{ color: textMuted }}>{variant.channels.linkedin.post}</p>
                </div>
              </div>
            </div>
          )}

          {/* Grounded signals */}
          {variant.groundedSignals && variant.groundedSignals.length > 0 && (
            <div>
              <p className="text-[9px] font-mono uppercase tracking-wider mb-1.5" style={{ color: textSubtle }}>Grounded Signals</p>
              <ul className="flex flex-col gap-1">
                {variant.groundedSignals.map((sig, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px]" style={{ color: textSubtle }}>
                    <span className="font-mono mt-0.5 shrink-0" style={{ color: accentColor }}>›</span>{sig}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ExecutionPlan({ output, product }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('variants');
  const { border: borderC, surface: cardBg, surface2: cardBg2, text: textMain, textMuted, textSubtle } = useTheme();

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'variants',   label: `Variants (${output.variants?.length ?? 0})`, icon: <Target size={12} /> },
    { key: 'brief',      label: 'Campaign Brief',  icon: <BookOpen size={12} /> },
    { key: 'deployment', label: `Deployment (${output.deployment?.length ?? 0})`, icon: <Calendar size={12} /> },
  ];

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid #0070f3`, background: cardBg, boxShadow: '0 0 0 1px rgba(0,112,243,0.1)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${borderC}`, background: 'rgba(0,112,243,0.06)' }}>
        <div className="flex items-center gap-2.5">
          <ArrowRight size={14} style={{ color: '#0070f3' }} />
          <span className="text-[13px] font-semibold" style={{ color: textMain }}>Execution Plan</span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: '#0070f3', background: 'rgba(0,112,243,0.1)', border: '1px solid rgba(0,112,243,0.2)' }}>
            {product}
          </span>
        </div>
        {/* Confidence */}
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{
          color:   output.confidence === 'high' ? '#10b981' : output.confidence === 'medium' ? '#f59e0b' : '#6b7280',
          background: output.confidence === 'high' ? 'rgba(16,185,129,0.1)' : output.confidence === 'medium' ? 'rgba(245,158,11,0.1)' : 'rgba(107,114,128,0.1)',
          border: `1px solid ${output.confidence === 'high' ? 'rgba(16,185,129,0.25)' : output.confidence === 'medium' ? 'rgba(245,158,11,0.25)' : 'rgba(107,114,128,0.2)'}`,
        }}>
          {output.confidence} confidence
        </span>
      </div>

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
          <div className="flex flex-col gap-3">
            {output.variants && output.variants.length > 0 ? (
              output.variants.map((v, i) => (
                <VariantCard key={v.id} variant={v} idx={i} />
              ))
            ) : (
              <p className="text-[13px]" style={{ color: textMuted }}>No variants generated.</p>
            )}
          </div>
        )}

        {/* ── Campaign Brief Tab ── */}
        {activeTab === 'brief' && output.brief && (
          <div className="flex flex-col gap-5">
            {/* Objective */}
            <div>
              <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-1.5" style={{ color: textSubtle }}>Objective</p>
              <p className="text-[13px] leading-relaxed" style={{ color: textMuted }}>{output.brief.objective}</p>
            </div>

            {/* Target audience + pain points */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-1.5" style={{ color: textSubtle }}>Target Audience</p>
                <p className="text-[13px]" style={{ color: textMuted }}>{output.brief.targetAudience}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-1.5" style={{ color: textSubtle }}>Pain Points</p>
                <ul className="flex flex-col gap-1">
                  {(output.brief.painPoints ?? []).map((p, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-[12px]" style={{ color: textMuted }}>
                      <span style={{ color: '#ef4444', marginTop: '2px', flexShrink: 0 }}>✕</span>{p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Key messaging angles */}
            {output.brief.keyMessagingAngles && output.brief.keyMessagingAngles.length > 0 && (
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-2" style={{ color: textSubtle }}>Key Messaging Angles</p>
                <div className="flex flex-col gap-2">
                  {output.brief.keyMessagingAngles.map((a, i) => (
                    <div key={i} className="rounded-md p-3" style={{ background: cardBg2, border: `1px solid ${borderC}` }}>
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
                <p className="text-[12px]" style={{ color: textMuted }}>{output.brief.channelStrategy}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-1.5" style={{ color: textSubtle }}>Success Metrics</p>
                <ul className="flex flex-col gap-0.5">
                  {(output.brief.successMetrics ?? []).map((m, i) => (
                    <li key={i} className="flex items-center gap-1.5 text-[12px]" style={{ color: textMuted }}>
                      <CheckCircle2 size={10} style={{ color: '#10b981', flexShrink: 0 }} />{m}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Next steps */}
            {output.brief.nextSteps && output.brief.nextSteps.length > 0 && (
              <div>
                <p className="text-[10px] font-mono font-semibold uppercase tracking-widest mb-1.5" style={{ color: textSubtle }}>Next Steps</p>
                <ol className="flex flex-col gap-1">
                  {output.brief.nextSteps.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-[12px]" style={{ color: textMuted }}>
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
          <div className="flex flex-col gap-2">
            {output.deployment && output.deployment.length > 0 ? (
              output.deployment.map((step, i) => (
                <div key={i} className="flex items-start gap-3 rounded-md px-3 py-2.5"
                  style={{ background: cardBg2, border: `1px solid ${borderC}` }}>
                  {/* Day badge */}
                  <div className="flex flex-col items-center gap-0.5 shrink-0">
                    <span className="text-[9px] font-mono" style={{ color: textSubtle }}>Day</span>
                    <span className="text-[16px] font-bold font-mono" style={{ color: '#0070f3', lineHeight: 1 }}>{step.day}</span>
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
                    <p className="text-[12px] font-medium" style={{ color: textMain }}>{step.action}</p>
                    <p className="text-[11px]" style={{ color: textSubtle }}>{step.audience}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[13px]" style={{ color: textMuted }}>No deployment steps generated.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
