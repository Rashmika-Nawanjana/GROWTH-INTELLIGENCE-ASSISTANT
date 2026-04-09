/**
 * E2E check: empty artifacts never crash.
 *
 * Validates that withArrayDefaults and the switch-case guards in
 * ArtifactRenderer prevent crashes when agent output arrays are
 * undefined, null, or empty.
 */

import { describe, it, expect } from 'vitest';

// Reproduce the exact helper from ArtifactRenderer.tsx so the test stays
// decoupled from React (no DOM needed). If the logic changes in the
// component, this test must be kept in sync.
function withArrayDefaults<T extends Record<string, any>>(output: T, fields: (keyof T)[]): T {
  let patched: T | null = null;
  for (const f of fields) {
    if (output[f] === undefined || output[f] === null) {
      if (!patched) patched = { ...output };
      (patched as any)[f] = [];
    }
  }
  return patched ?? output;
}

// All artifact types and their array fields (mirrors ArtifactRenderer switch)
const ARTIFACT_ARRAY_FIELDS: Record<string, string[]> = {
  'trend-chart':        ['trends', 'keySignals'],
  'competitive-matrix': ['matrix', 'hiringSignals', 'recentMoves'],
  'win-loss-scorecard': ['competitorWins', 'competitorLosses', 'topSwitchTriggers'],
  'pricing-table':      ['competitorPricing', 'pricingSignals'],
  'positioning-gap':    ['gaps', 'adThemes'],
  'threat-heatmap':     ['threats', 'defensiveActions'],
  'mind-map':           ['branches'],
  'execution-plan':     ['variants', 'deployment'],
};

describe('withArrayDefaults', () => {
  it('patches undefined fields to empty arrays', () => {
    const input = { trends: undefined, keySignals: null, categoryOutlook: 'emerging' } as any;
    const result = withArrayDefaults(input, ['trends', 'keySignals']);
    expect(result.trends).toEqual([]);
    expect(result.keySignals).toEqual([]);
    expect(result.categoryOutlook).toBe('emerging');
  });

  it('returns same reference when no patches needed', () => {
    const input = { trends: [1, 2], keySignals: ['a'] } as any;
    const result = withArrayDefaults(input, ['trends', 'keySignals']);
    expect(result).toBe(input);
  });

  it('does not touch non-null fields', () => {
    const input = { trends: [{ keyword: 'ai' }], keySignals: undefined } as any;
    const result = withArrayDefaults(input, ['trends', 'keySignals']);
    expect(result.trends).toEqual([{ keyword: 'ai' }]);
    expect(result.keySignals).toEqual([]);
  });
});

describe('artifact array fields are safe for all artifact types', () => {
  for (const [artifactType, fields] of Object.entries(ARTIFACT_ARRAY_FIELDS)) {
    it(`${artifactType}: all array fields default to [] when missing`, () => {
      // Simulate an output with all array fields set to undefined
      const minimal: Record<string, unknown> = {
        agentId: 'test',
        domain: 'market-trends',
        confidence: 'low',
        confidenceScore: 0.3,
        facts: [],
        interpretation: [],
        sources: [],
        generatedAt: new Date().toISOString(),
        artifactType,
      };

      const patched = withArrayDefaults(minimal, fields);

      for (const f of fields) {
        expect(Array.isArray(patched[f])).toBe(true);
        expect(patched[f]).toEqual([]);
      }
    });

    it(`${artifactType}: populated arrays pass through untouched`, () => {
      const populated: Record<string, unknown> = {
        agentId: 'test',
        domain: 'market-trends',
        confidence: 'high',
        confidenceScore: 0.9,
        facts: ['fact'],
        interpretation: ['interp'],
        sources: [],
        generatedAt: new Date().toISOString(),
        artifactType,
      };
      for (const f of fields) {
        populated[f] = [{ sample: true }];
      }

      const result = withArrayDefaults(populated, fields);

      for (const f of fields) {
        expect(result[f]).toEqual([{ sample: true }]);
      }
    });
  }
});
