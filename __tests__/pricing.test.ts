import { describe, it, expect } from 'vitest';
import {
  estimateLlmCostUsd,
  estimateEmbeddingCostUsd,
  estimateTokensFromChars,
  getLlmRates,
} from '@/lib/observability/pricing';

describe('pricing', () => {
  it('computes LLM cost from token counts', () => {
    const cost = estimateLlmCostUsd('gemini-2.5-flash', 1_000_000, 500_000);
    const rates = getLlmRates('gemini-2.5-flash');
    const expected = rates.inputPerM + rates.outputPerM * 0.5;
    expect(cost).toBeCloseTo(expected, 4);
  });

  it('estimates embedding cost', () => {
    const cost = estimateEmbeddingCostUsd(1_000_000);
    expect(cost).toBeGreaterThan(0);
  });

  it('estimates tokens from chars', () => {
    expect(estimateTokensFromChars(400)).toBe(100);
    expect(estimateTokensFromChars(0)).toBe(1);
  });
});
