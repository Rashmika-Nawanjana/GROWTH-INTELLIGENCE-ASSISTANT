// @ts-nocheck
import { describe, expect, it } from 'vitest';
import type { AgentOutput } from '@/lib/agents/types';
import { buildFeedbackSummary, buildRefinementDeltas } from '@/lib/agents/refine-utils';

function makeOutput(partial: Partial<AgentOutput>): AgentOutput {
  return {
    agentId: 'test-agent',
    domain: 'market-trends',
    confidence: 'medium',
    confidenceScore: 0.6,
    facts: [],
    interpretation: [],
    sources: [],
    generatedAt: new Date().toISOString(),
    artifactType: 'scorecard',
    ...partial,
  };
}

describe('refine loop helpers', () => {
  it('buildFeedbackSummary includes outcome context and refinement rules', () => {
    const summary = buildFeedbackSummary(
      [{ rating: 'up', title: 'Lead with ROI proof' }],
      [{ action: 'accepted', title: 'Deploy Variant V1' }],
      [{ variant_id: 'V1-ROI', variant_angle: 'ROI', reply_rate: 4.5, hypothesis_confirmed: 'yes' }],
      'Improve VP Sales outreach',
    );

    expect(summary).toContain('[USER FEEDBACK & OUTCOMES');
    expect(summary).toContain('Refinement focus: Improve VP Sales outreach');
    expect(summary).toContain('liked: Lead with ROI proof');
    expect(summary).toContain('accepted: Deploy Variant V1');
    expect(summary).toContain('V1-ROI (ROI)');
    expect(summary).toContain('REFINEMENT RULES:');
  });

  it('buildRefinementDeltas reports confidence shifts and new evidence', () => {
    const previous = [
      makeOutput({
        domain: 'pricing',
        confidence: 'medium',
        confidenceScore: 0.55,
        facts: ['Buyers cite budget pressure as key blocker'],
      }),
      makeOutput({
        domain: 'competitive',
        confidence: 'medium',
        confidenceScore: 0.62,
        facts: ['Competitor emphasizes speed messaging'],
      }),
    ];

    const next = [
      makeOutput({
        domain: 'pricing',
        confidence: 'high',
        confidenceScore: 0.72,
        facts: ['Buyers cite budget pressure as key blocker'],
      }),
      makeOutput({
        domain: 'competitive',
        confidence: 'medium',
        confidenceScore: 0.64,
        facts: ['Competitor emphasizes speed messaging', 'New competitor shifted to ROI framing'],
      }),
    ];

    const deltas = buildRefinementDeltas(previous, next);

    expect(deltas).toHaveLength(2);
    expect(deltas[0].summary).toContain('confidence increased');
    expect(deltas[0].beforeConfidence).toBe('medium');
    expect(deltas[0].afterConfidence).toBe('high');
    expect(deltas[1].summary).toContain('added new evidence');
  });
});
