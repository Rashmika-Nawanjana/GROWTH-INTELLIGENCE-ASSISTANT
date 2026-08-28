/**
 * Regression fixture for the Sri Lanka / Govi Isuru competitive landscape query.
 * Asserts that relevance filtering prefers geo-local sources over global noise.
 */
import { describe, it, expect } from 'vitest';
import { filterRelevant } from '@/lib/tools/relevance';
import { planQueries } from '@/lib/tools/query-planner';
import { assessEvidence } from '@/lib/agents/evidence-gate';

export const SRI_LANKA_AGRI_QUERY =
  'Analyze the competitive landscape for AI-powered agricultural technology platforms in Sri Lanka. Identify notable competitors, their products/services, target customers, pricing information if publicly available, recent developments, and differentiating features';

const req = {
  geography: { name: 'Sri Lanka', countryCode: 'lk', hl: 'en' },
  category: 'agritech / AI in agriculture',
  namedEntities: ['Govi Isuru'],
  requiredTerms: ['Sri Lanka', 'agriculture', 'agritech', 'Govi Isuru'],
  product: 'AI-powered agricultural technology platforms',
};

/** Simulated SERP mix mirroring the bad production run. */
const SIMULATED_SERP = [
  {
    title: 'AI in Agriculture: 50 Ways Technology is Transforming Farm',
    url: 'https://www.linkedin.com/pulse/ai-agriculture-50-ways',
    snippet: 'Global AI in agriculture market growth',
  },
  {
    title: 'Best Software Products for 2026 - G2',
    url: 'https://www.g2.com/best-software-companies/top-products',
    snippet: 'Top products on G2',
  },
  {
    title: 'What is Mistral AI?',
    url: 'https://techcrunch.com/2026/07/04/what-is-mistral-ai',
    snippet: 'OpenAI competitor',
  },
  {
    title: 'Plans & Pricing - Figma',
    url: 'https://www.figma.com/pricing/',
    snippet: 'Figma pricing plans',
  },
  {
    title: 'Best Precision Agriculture Software',
    url: 'https://www.g2.com/categories/precision-agriculture',
    snippet: 'User reviews from G2',
  },
  {
    title: 'Govi Isuru AI farming platform Sri Lanka',
    url: 'https://www.dailynews.lk/govi-isuru-ai',
    snippet: 'Sri Lankan agritech startup Govi Isuru launches crop disease detection',
  },
  {
    title: 'Department of Agriculture digital services Sri Lanka',
    url: 'https://doa.gov.lk/digital',
    snippet: 'Government farmer advisory services in Sri Lanka',
  },
  {
    title: 'Agritech startups accelerating in Colombo',
    url: 'https://economy.lk/agritech-startups',
    snippet: 'Local agriculture technology platforms in Sri Lanka',
  },
];

describe('Sri Lanka / Govi Isuru geo fixture', () => {
  it('query planner grounds competitive searches in Sri Lanka + Govi Isuru', () => {
    const bundle = planQueries({
      product: 'AI-powered agricultural technology platforms',
      competitor: 'relevant competitors',
      domain: 'competitive',
      query: SRI_LANKA_AGRI_QUERY,
      category: 'agritech',
      geography: req.geography,
      namedEntities: req.namedEntities,
    });
    expect(bundle.broad.toLowerCase()).toContain('sri lanka');
    expect(bundle.entityProbes.some(p => /govi isuru/i.test(p))).toBe(true);
    expect(bundle.broad.toLowerCase()).not.toContain('relevant competitors');
  });

  it('keeps majority geo-relevant sources after filtering', () => {
    const { kept, dropped } = filterRelevant(SIMULATED_SERP, req, { minScore: 0.25 });
    const geoRatio = kept.length / SIMULATED_SERP.length;
    expect(kept.length).toBeGreaterThanOrEqual(2);
    expect(geoRatio).toBeGreaterThanOrEqual(0.25);
    expect(dropped.some(d => d.url.includes('figma.com'))).toBe(true);
    expect(dropped.some(d => d.url.includes('g2.com'))).toBe(true);
    expect(kept.every(k =>
      /sri lanka|govi|\.lk|colombo|agriculture/i.test(`${k.title} ${k.snippet} ${k.url}`),
    )).toBe(true);
  });

  it('keeps Govi Isuru hit in filtered set', () => {
    const { kept } = filterRelevant(SIMULATED_SERP, req, { minScore: 0.25 });
    expect(kept.some(k => /govi isuru/i.test(k.title))).toBe(true);
  });

  it('reports insufficient when only global noise remains', () => {
    const { kept } = filterRelevant(SIMULATED_SERP.slice(0, 5), req, { minScore: 0.25 });
    const assessment = assessEvidence({
      relevantSourceCount: kept.length,
      searchedFor: ['AI agriculture Sri Lanka'],
      domain: 'competitive',
      geography: req.geography,
    });
    expect(assessment.status).toBe('insufficient');
  });

  it('drops Figma / Salesforce / G2 category URLs under geo requirements', () => {
    const { kept, dropped } = filterRelevant(SIMULATED_SERP, req, { minScore: 0.25 });
    expect(kept.every(k => !/figma\.com|salesforce\.com|g2\.com\/categories/i.test(k.url))).toBe(true);
    expect(dropped.some(d => /figma\.com/i.test(d.url))).toBe(true);
    expect(dropped.some(d => /g2\.com/i.test(d.url))).toBe(true);
  });

  it('scrape floor eligibility: ≥2 geo hits implies at least 2 scrape candidates', () => {
    const { kept } = filterRelevant(SIMULATED_SERP, req, { minScore: 0.25 });
    expect(kept.length).toBeGreaterThanOrEqual(2);
    const scrapeCandidates = kept.slice(0, 2);
    expect(scrapeCandidates).toHaveLength(2);
    expect(scrapeCandidates.every(k => /\.lk|sri lanka|govi|colombo|agriculture/i.test(`${k.title} ${k.snippet} ${k.url}`))).toBe(true);
  });
});
