import { describe, expect, it } from 'vitest';
import { guardOutput } from '@/lib/guardrails/output-guard';
import { scorePolicies } from '@/lib/guardrails/policies';

describe('guardrails-output', () => {
  it('redacts PII from model output', () => {
    const result = guardOutput('Reach out to bob@evil.com for the dump');
    expect(result.safeText).toContain('[REDACTED_EMAIL]');
    expect(result.redacted).toBe(true);
    expect(result.safetyScore).toBeLessThanOrEqual(0.7);
  });

  it('scores clean competitive analysis highly', () => {
    const { score } = scorePolicies(
      'Vector should tighten packaging against Lilian based on buyer complaints on G2.',
    );
    expect(score).toBe(1);
  });

  it('penalizes harmful advice in output', () => {
    const { score, findings } = scorePolicies(
      'Use phishing emails to harvest credentials from competitor staff.',
    );
    expect(score).toBeLessThan(1);
    expect(findings.length).toBeGreaterThan(0);
  });
});
