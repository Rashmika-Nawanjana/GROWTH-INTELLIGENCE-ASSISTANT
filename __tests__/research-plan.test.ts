import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/tools/serpapi', () => ({
  searchWeb: vi.fn(),
  searchNews: vi.fn(),
}));
vi.mock('@/lib/tools/firecrawl', () => ({
  scrapePage: vi.fn(),
}));
vi.mock('@/lib/tools/discover-and-scrape', () => ({
  discoverAndScrape: vi.fn(),
}));
vi.mock('@/lib/agents/gemini', () => ({
  generateHuggingFaceJson: vi.fn(),
}));

import {
  normalizeResearchPlan,
  shouldSkipDomainLlm,
  ENTITY_DEPENDENT_DOMAINS,
  type ResearchPlan,
} from '@/lib/agents/research-plan';

describe('normalizeResearchPlan', () => {
  it('drops global brands from localEntities', () => {
    const plan = normalizeResearchPlan(
      {
        localEntities: [
          { name: 'Figma', type: 'vendor' },
          { name: 'Govi Isuru', type: 'vendor', url: 'https://example.lk' },
          { name: 'Salesforce', type: 'vendor' },
          { name: 'John Deere', type: 'vendor' },
        ],
        perDomainQueries: {
          competitive: ['agritech startups Sri Lanka'],
        },
        gapQueries: ['Govi Isuru pricing'],
        notes: ['Found one local player'],
      },
      {
        candidates: [],
        searchedFor: ['agritech Sri Lanka'],
        scrapedCount: 1,
        searchCallCount: 3,
      },
    );

    expect(plan.localEntities.map(e => e.name)).toEqual(['Govi Isuru']);
    expect(plan.localEntities[0].type).toBe('vendor');
    expect(plan.perDomainQueries.competitive?.[0]).toContain('Sri Lanka');
    expect(plan.scrapedCount).toBe(1);
  });

  it('falls back to heuristic candidates when LLM returns empty', () => {
    const plan = normalizeResearchPlan(
      { localEntities: [] },
      {
        candidates: [
          { name: 'CropSense LK', type: 'vendor', url: 'https://cropsense.lk' },
          { name: 'G2', type: 'unclear' },
        ],
        searchedFor: ['q'],
        scrapedCount: 0,
        searchCallCount: 2,
      },
    );
    expect(plan.localEntities.map(e => e.name)).toEqual(['CropSense LK']);
  });

  it('marks entity-dependent domains inapplicable when no local entities', () => {
    const plan = normalizeResearchPlan(
      { localEntities: [], applicableDomains: ['pricing', 'win-loss', 'competitive'] },
      {
        candidates: [],
        searchedFor: ['x'],
        scrapedCount: 0,
        searchCallCount: 1,
      },
    );
    expect(plan.localEntities).toHaveLength(0);
    for (const d of ENTITY_DEPENDENT_DOMAINS) {
      expect(plan.applicableDomains).not.toContain(d);
    }
    expect(plan.applicableDomains).toContain('competitive');
  });
});

describe('shouldSkipDomainLlm', () => {
  const emptyPlan: ResearchPlan = {
    localEntities: [],
    perDomainQueries: {},
    gapQueries: [],
    applicableDomains: ['competitive', 'market-trends', 'adjacent'],
    notes: [],
    searchedFor: ['agritech Sri Lanka'],
    scrapedCount: 0,
    searchCallCount: 2,
  };

  it('skips pricing/win-loss when geography set and no local entities', () => {
    expect(
      shouldSkipDomainLlm('pricing', emptyPlan, { name: 'Sri Lanka', countryCode: 'lk' }),
    ).toBe(true);
    expect(
      shouldSkipDomainLlm('win-loss', emptyPlan, { name: 'Sri Lanka', countryCode: 'lk' }),
    ).toBe(true);
    expect(
      shouldSkipDomainLlm('competitive', emptyPlan, { name: 'Sri Lanka', countryCode: 'lk' }),
    ).toBe(false);
  });

  it('does not skip when local entities exist', () => {
    const withEntities: ResearchPlan = {
      ...emptyPlan,
      localEntities: [{ name: 'Govi Isuru', type: 'vendor' }],
    };
    expect(
      shouldSkipDomainLlm('pricing', withEntities, { name: 'Sri Lanka', countryCode: 'lk' }),
    ).toBe(false);
  });

  it('does not skip without geography', () => {
    expect(shouldSkipDomainLlm('pricing', emptyPlan, undefined)).toBe(false);
  });
});
