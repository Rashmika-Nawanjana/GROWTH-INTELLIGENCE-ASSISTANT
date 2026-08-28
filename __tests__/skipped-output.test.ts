import { describe, it, expect } from 'vitest';
import { insufficientOutput } from '@/lib/agents/skipped-output';

describe('insufficientOutput', () => {
  it('builds pricing output with insufficient evidence and no sources', () => {
    const out = insufficientOutput({
      domain: 'pricing',
      searchedFor: ['agritech pricing Sri Lanka', 'local farm tech plans'],
      gaps: ['No local vendors found'],
      geographyName: 'Sri Lanka',
      category: 'agritech',
      candidates: [{ name: 'NoiseCo', classification: 'global' }],
    });

    expect(out.domain).toBe('pricing');
    expect(out.artifactType).toBe('pricing-table');
    expect(out.confidence).toBe('low');
    expect(out.confidenceScore).toBeLessThanOrEqual(0.35);
    expect(out.evidence?.status).toBe('insufficient');
    expect(out.evidence?.searchedFor).toContain('agritech pricing Sri Lanka');
    expect(out.sources).toHaveLength(0);
    expect(out.toolCallCount).toBe(0);
    expect(out.facts).toHaveLength(0);
  });

  it('builds win-loss and positioning variants', () => {
    const wl = insufficientOutput({
      domain: 'win-loss',
      geographyName: 'Sri Lanka',
      searchedFor: ['buyer reviews Sri Lanka agritech'],
    });
    expect(wl.artifactType).toBe('win-loss-scorecard');
    expect(wl.evidence?.status).toBe('insufficient');

    const pos = insufficientOutput({
      domain: 'positioning',
      geographyName: 'Sri Lanka',
    });
    expect(pos.artifactType).toBe('positioning-gap');
    expect(Array.isArray((pos as { gaps?: unknown[] }).gaps)).toBe(true);
  });
});
