import { describe, it, expect } from 'vitest';
import { scoreRelevance, filterRelevant } from '@/lib/tools/relevance';

const sriLankaReq = {
  geography: { name: 'Sri Lanka', countryCode: 'lk', hl: 'en' },
  category: 'agritech / AI in agriculture',
  namedEntities: ['Govi Isuru'],
  requiredTerms: ['Sri Lanka', 'agriculture', 'agritech'],
  product: 'AI-powered agricultural technology platforms',
};

describe('scoreRelevance', () => {
  it('scores zero for G2 category pages under a Sri Lanka constraint', () => {
    const score = scoreRelevance(
      {
        title: 'Best Precision Agriculture Software',
        url: 'https://www.g2.com/categories/precision-agriculture',
        snippet: 'Compare the best precision agriculture software of 2026',
      },
      sriLankaReq,
    );
    expect(score).toBe(0);
  });

  it('scores zero for Figma pricing under a geo constraint', () => {
    const score = scoreRelevance(
      {
        title: 'Plans & Pricing - Figma',
        url: 'https://www.figma.com/pricing/',
        snippet: 'Figma pricing for design teams',
      },
      sriLankaReq,
    );
    expect(score).toBe(0);
  });

  it('scores zero for Salesforce Agentforce pricing under a geo constraint', () => {
    const score = scoreRelevance(
      {
        title: 'Salesforce Agentforce pricing',
        url: 'https://www.salesforce.com/products/agentforce/pricing/',
        snippet: 'Agentforce pricing models',
      },
      sriLankaReq,
    );
    expect(score).toBe(0);
  });

  it('keeps a Sri Lanka agritech hit', () => {
    const score = scoreRelevance(
      {
        title: 'Govi Isuru launches AI crop advisory in Sri Lanka',
        url: 'https://example.lk/govi-isuru',
        snippet: 'Sri Lankan agritech platform for farmers',
      },
      sriLankaReq,
    );
    expect(score).toBeGreaterThan(0.5);
  });

  it('hard-fails global market blogs that omit Sri Lanka', () => {
    const score = scoreRelevance(
      {
        title: 'AI in Agriculture Market Size 2026',
        url: 'https://www.linkedin.com/pulse/ai-agriculture-market',
        snippet: 'Global AI in agriculture market projected to grow',
      },
      sriLankaReq,
    );
    expect(score).toBe(0);
  });
});

describe('filterRelevant', () => {
  it('drops generic pages and keeps geo-relevant ones', () => {
    const { kept, dropped } = filterRelevant(
      [
        {
          title: 'Best Software Products 2026 - G2',
          url: 'https://www.g2.com/best-software-companies/top-products',
          snippet: 'Top products',
        },
        {
          title: 'Agritech startups in Sri Lanka',
          url: 'https://news.lk/agritech-startups',
          snippet: 'Local agriculture technology platforms',
        },
      ],
      sriLankaReq,
      { minScore: 0.25 },
    );
    expect(kept.map(k => k.url)).toEqual(['https://news.lk/agritech-startups']);
    expect(dropped.length).toBe(1);
  });
});
