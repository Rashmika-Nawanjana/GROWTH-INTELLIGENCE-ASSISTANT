import { describe, it, expect } from 'vitest';
import { computeSignalQualityPenalty, extractToolResults, buildToolResult } from '@/lib/tools/fallback';

describe('buildToolResult', () => {
  it('sets ok status with ~0.85 confidence', () => {
    const r = buildToolResult({ data: [1], status: 'ok', source: 'test' });
    expect(r.status).toBe('ok');
    expect(r.confidence).toBe(0.85);
    expect(r.cached).toBe(false);
  });

  it('sets degraded status with ~0.55 confidence', () => {
    const r = buildToolResult({ data: null, status: 'degraded', source: 'test' });
    expect(r.status).toBe('degraded');
    expect(r.confidence).toBe(0.55);
  });

  it('sets failed status with ~0.15 confidence', () => {
    const r = buildToolResult({ data: [], status: 'failed', source: 'test' });
    expect(r.status).toBe('failed');
    expect(r.confidence).toBe(0.15);
  });

  it('respects confidenceOverride', () => {
    const r = buildToolResult({ data: [], status: 'ok', source: 'test', confidenceOverride: 0.95 });
    expect(r.confidence).toBe(0.95);
  });
});

describe('computeSignalQualityPenalty', () => {
  it('returns 1.0 when all tools are ok', () => {
    const results = [
      buildToolResult({ data: 'a', status: 'ok', source: 'A' }),
      buildToolResult({ data: 'b', status: 'ok', source: 'B' }),
      buildToolResult({ data: 'c', status: 'ok', source: 'C' }),
    ];
    expect(computeSignalQualityPenalty(results, 3)).toBe(1);
  });

  it('returns 0.5 when all tools failed', () => {
    const results = [
      buildToolResult({ data: [], status: 'failed', source: 'A' }),
      buildToolResult({ data: [], status: 'failed', source: 'B' }),
    ];
    expect(computeSignalQualityPenalty(results, 2)).toBe(0.5);
  });

  it('returns a value between 0.5 and 1.0 for mixed results', () => {
    const results = [
      buildToolResult({ data: 'a', status: 'ok', source: 'A' }),
      buildToolResult({ data: null, status: 'degraded', source: 'B' }),
      buildToolResult({ data: [], status: 'failed', source: 'C' }),
    ];
    const penalty = computeSignalQualityPenalty(results, 3);
    expect(penalty).toBeGreaterThan(0.5);
    expect(penalty).toBeLessThan(1.0);
  });

  it('accounts for missing tools (expectedCount > results.length)', () => {
    const results = [
      buildToolResult({ data: 'a', status: 'ok', source: 'A' }),
    ];
    const withAll = computeSignalQualityPenalty(results, 1);
    const withMissing = computeSignalQualityPenalty(results, 5);
    expect(withMissing).toBeLessThan(withAll);
  });

  it('infers status from confidence for legacy results without status', () => {
    const legacy = [
      { data: 'x', source: 'old', timestamp: '2025-01-01', confidence: 0.9, cached: false },
      { data: 'y', source: 'old', timestamp: '2025-01-01', confidence: 0.1, cached: false },
    ];
    const penalty = computeSignalQualityPenalty(legacy, 2);
    expect(penalty).toBeGreaterThan(0.5);
    expect(penalty).toBeLessThan(1.0);
  });
});

describe('extractToolResults', () => {
  it('extracts fulfilled results with confidence property', () => {
    const settled: PromiseSettledResult<any>[] = [
      { status: 'fulfilled', value: buildToolResult({ data: 'a', status: 'ok', source: 'A' }) },
      { status: 'rejected', reason: new Error('fail') },
      { status: 'fulfilled', value: buildToolResult({ data: 'b', status: 'degraded', source: 'B' }) },
      { status: 'fulfilled', value: null },
    ];
    const results = extractToolResults(settled);
    expect(results).toHaveLength(2);
    expect(results[0].source).toBe('A');
    expect(results[1].source).toBe('B');
  });
});
