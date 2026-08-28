import { describe, it, expect } from 'vitest';
import { assessEvidence, applyInsufficientGate } from '@/lib/agents/evidence-gate';

describe('assessEvidence', () => {
  it('marks 0–1 relevant sources as insufficient', () => {
    const a = assessEvidence({
      relevantSourceCount: 0,
      searchedFor: ['agritech Sri Lanka'],
      domain: 'pricing',
      geography: { name: 'Sri Lanka', countryCode: 'lk' },
      category: 'agritech',
    });
    expect(a.status).toBe('insufficient');
    expect(a.gaps.length).toBeGreaterThan(0);
    expect(a.gaps[0].toLowerCase()).toContain('sri lanka');
  });

  it('marks 1 source as insufficient', () => {
    expect(
      assessEvidence({
        relevantSourceCount: 1,
        searchedFor: ['q'],
        domain: 'competitive',
      }).status,
    ).toBe('insufficient');
  });

  it('marks 2–3 as thin', () => {
    expect(
      assessEvidence({
        relevantSourceCount: 2,
        searchedFor: ['q'],
        domain: 'win-loss',
      }).status,
    ).toBe('thin');
  });

  it('marks 4+ as sufficient', () => {
    expect(
      assessEvidence({
        relevantSourceCount: 4,
        searchedFor: ['q'],
        domain: 'market-trends',
      }).status,
    ).toBe('sufficient');
  });
});

describe('applyInsufficientGate', () => {
  it('forces low confidence when LLM flags insufficientEvidence', () => {
    const assessment = assessEvidence({
      relevantSourceCount: 5,
      searchedFor: ['q'],
      domain: 'pricing',
    });
    const gate = applyInsufficientGate(
      { insufficientEvidence: true, confidenceScore: 0.9 },
      assessment,
    );
    expect(gate.insufficient).toBe(true);
    expect(gate.confidenceScore).toBeLessThanOrEqual(0.35);
  });

  it('caps thin evidence confidence', () => {
    const assessment = assessEvidence({
      relevantSourceCount: 2,
      searchedFor: ['q'],
      domain: 'pricing',
    });
    const gate = applyInsufficientGate({ confidenceScore: 0.9 }, assessment);
    expect(gate.insufficient).toBe(false);
    expect(gate.confidenceScore).toBeLessThanOrEqual(0.55);
  });
});
