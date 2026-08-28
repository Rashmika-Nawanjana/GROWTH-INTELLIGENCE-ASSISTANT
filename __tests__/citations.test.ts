import { describe, it, expect } from 'vitest';
import {
  buildCitationIndex,
  stripUnknownCitations,
  formatCitationsForPrompt,
} from '@/lib/agents/citations';
import type { AgentOutput } from '@/lib/agents/types';

function makeOutput(
  domain: AgentOutput['domain'],
  sources: { url: string; title: string }[],
): AgentOutput {
  return {
    agentId: domain,
    domain,
    confidence: 'medium',
    confidenceScore: 0.6,
    facts: [],
    interpretation: [],
    sources: sources.map(s => ({
      ...s,
      timestamp: new Date().toISOString(),
      tool: 'serpapi',
    })),
    generatedAt: new Date().toISOString(),
    artifactType: 'scorecard',
  };
}

describe('buildCitationIndex', () => {
  it('dedupes by normalised URL and assigns stable ids', () => {
    const outputs = [
      makeOutput('competitive', [
        { url: 'https://Example.com/path/', title: 'One' },
        { url: 'https://other.com/a', title: 'Two' },
      ]),
      makeOutput('pricing', [
        { url: 'https://example.com/path', title: 'One again' },
        { url: 'https://third.com', title: 'Three' },
      ]),
    ];

    const citations = buildCitationIndex(outputs);
    expect(citations).toHaveLength(3);
    expect(citations[0].id).toBe(1);
    expect(citations[1].id).toBe(2);
    expect(citations[2].id).toBe(3);
    expect(outputs[0].sources[0].citationId).toBe(1);
    expect(outputs[1].sources[0].citationId).toBe(1);
    expect(citations[0].domains).toContain('competitive');
    expect(citations[0].domains).toContain('pricing');
  });
});

describe('stripUnknownCitations', () => {
  it('keeps valid [n] and strips out-of-range', () => {
    const text = 'Claim A [1]. Claim B [99]. Claim C [2].';
    expect(stripUnknownCitations(text, 2)).toBe('Claim A [1]. Claim B. Claim C [2].');
  });

  it('returns empty-safe for blank', () => {
    expect(stripUnknownCitations('', 5)).toBe('');
  });
});

describe('formatCitationsForPrompt', () => {
  it('formats numbered list', () => {
    const formatted = formatCitationsForPrompt([
      { id: 1, url: 'https://a.com', title: 'A', domains: ['competitive'] },
    ]);
    expect(formatted).toContain('[1] A: https://a.com');
  });
});
