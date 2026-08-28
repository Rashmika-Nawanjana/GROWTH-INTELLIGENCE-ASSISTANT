import { describe, it, expect } from 'vitest';
import { planQueries } from '@/lib/tools/query-planner';

describe('planQueries geography', () => {
  it('appends geo qualifier and never emits relevant competitors literally', () => {
    const bundle = planQueries({
      product: 'AI agritech platforms',
      competitor: 'relevant competitors',
      domain: 'competitive',
      query: 'competitive landscape AI agriculture Sri Lanka',
      category: 'agritech',
      geography: { name: 'Sri Lanka', countryCode: 'lk', hl: 'en' },
      namedEntities: ['Govi Isuru'],
    });

    expect(bundle.broad.toLowerCase()).toContain('sri lanka');
    expect(bundle.hypothesis.toLowerCase()).toContain('sri lanka');
    expect(bundle.broad.toLowerCase()).not.toContain('relevant competitors');
    expect(bundle.targeted.toLowerCase()).not.toContain('relevant competitors');
    expect(bundle.entityProbes.length).toBeGreaterThan(0);
    expect(bundle.entityProbes[0]).toContain('Govi Isuru');
    expect(bundle.requiredTerms.some(t => /sri lanka/i.test(t))).toBe(true);
  });

  it('uses real competitor name when provided', () => {
    const bundle = planQueries({
      product: 'Vector Agents',
      competitor: 'Lilian',
      domain: 'pricing',
      query: 'Lilian pricing',
    });
    expect(bundle.broad.toLowerCase()).toContain('lilian');
    expect(bundle.entityProbes).toEqual([]);
  });

  it('builds pricing discovery query without placeholder competitor', () => {
    const bundle = planQueries({
      product: 'farmer advisory',
      competitor: 'top competitors',
      domain: 'pricing',
      query: 'pricing for agritech Sri Lanka',
      category: 'agritech',
      geography: { name: 'Sri Lanka', countryCode: 'lk' },
    });
    expect(bundle.broad.toLowerCase()).toContain('sri lanka');
    expect(bundle.broad.toLowerCase()).not.toMatch(/top competitors/);
  });
});
