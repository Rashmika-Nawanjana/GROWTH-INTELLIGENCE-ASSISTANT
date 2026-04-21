import { describe, expect, it } from 'vitest';
import { extractKeywords, planQueries } from '@/lib/tools/query-planner';
import type { IntelligenceDomain } from '@/lib/agents/types';

describe('query planner', () => {
  it('builds market-trends queries with dynamic years', () => {
    const year = new Date().getFullYear();
    const nextYear = year + 1;
    const bundle = planQueries({
      product: 'OpenAI',
      domain: 'market-trends',
      query: 'openai market momentum',
      category: 'AI foundation models',
    });

    expect(bundle.broad).toContain(String(year));
    expect(bundle.broad).toContain(String(nextYear));
    expect(bundle.targeted).toContain('AI foundation models');
  });

  it('sanitizes missing optional context in competitive domain', () => {
    const bundle = planQueries({
      product: 'Anthropic',
      domain: 'competitive',
      query: 'compare competitors',
    });

    expect(bundle.broad).toContain('top competitors');
    expect(bundle.hypothesis).not.toContain('undefined');
    expect(bundle.targeted).not.toContain('undefined');
  });

  it('returns fallback bundle for unknown domain safely', () => {
    const bundle = planQueries({
      product: 'Vector Agents',
      // intentional unknown domain to validate fallback behavior
      domain: 'invalid-domain' as IntelligenceDomain,
      query: 'vector agents growth',
    });

    expect(bundle.broad).toBe('vector agents growth');
    expect(bundle.targeted).toContain('site:reddit.com OR site:linkedin.com');
    expect(bundle.keywords.length).toBeGreaterThan(0);
  });

  it('extracts stable keyword set', () => {
    const bundle = planQueries({
      product: 'Vector Agents',
      domain: 'positioning',
      query: 'positioning gaps for ai sdr',
      competitor: '11x',
    });
    const keywords = extractKeywords(bundle);
    expect(keywords.size).toBeGreaterThan(5);
    expect(Array.from(keywords).some(k => k.includes('position'))).toBe(true);
  });
});
