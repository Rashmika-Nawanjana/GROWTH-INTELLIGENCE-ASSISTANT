// @ts-nocheck
import { describe, expect, it } from 'vitest';
import type { AgentOutput, CampaignVariant } from '@/lib/agents/types';
import { enforceExecutionGrounding } from '@/lib/agents/execution/grounding';

const researchOutputs: AgentOutput[] = [
  {
    agentId: 'competitive',
    domain: 'competitive',
    confidence: 'high',
    confidenceScore: 0.8,
    facts: ['Competitor launched a pricing calculator for enterprise prospects'],
    interpretation: ['Messaging now emphasizes measurable ROI over feature parity'],
    sources: [],
    generatedAt: new Date().toISOString(),
    artifactType: 'competitive-matrix',
  },
];

describe('execution grounding contract', () => {
  it('fills missing grounding fields on existing variants', () => {
    const variants: CampaignVariant[] = [
      {
        id: '',
        angle: '',
        hypothesis: '',
        successMetric: '',
        variable: '',
        channels: {},
        groundedSignals: [],
      },
    ];

    const safe = enforceExecutionGrounding(variants, researchOutputs, 'Vector Agents');

    expect(safe).toHaveLength(1);
    expect(safe[0].id).toBe('V1-SIGNAL');
    expect(safe[0].hypothesis.length).toBeGreaterThan(10);
    expect(safe[0].groundedSignals.length).toBeGreaterThan(0);
    expect(safe[0].successMetric).toContain('reply rate');
  });

  it('creates a safe fallback variant when no variants exist', () => {
    const safe = enforceExecutionGrounding([], researchOutputs, 'Vector Agents');

    expect(safe).toHaveLength(1);
    expect(safe[0].id).toBe('V1-SIGNAL-LED');
    expect(safe[0].channels.email?.subject).toContain('Vector Agents');
    expect(safe[0].groundedSignals[0]).toContain('[competitive]');
  });
});
