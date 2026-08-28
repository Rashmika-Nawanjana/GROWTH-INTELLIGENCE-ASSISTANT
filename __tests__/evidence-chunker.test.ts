import { describe, expect, it } from 'vitest';
import { chunkAgentFacts, chunkPageMarkdown } from '@/lib/evidence/chunker';

describe('evidence chunker', () => {
  it('splits markdown by headings and respects min size', () => {
    const md = `## Pricing\n${'Enterprise plan starts at $99/mo with annual billing. '.repeat(12)}\n\n## Features\n${'Automation workflows and CRM integrations included. '.repeat(12)}`;
    const chunks = chunkPageMarkdown(md);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every(c => c.kind === 'page')).toBe(true);
    expect(chunks.every(c => c.content.length >= 200)).toBe(true);
  });

  it('caps chunks at 12 and prioritizes required terms', () => {
    const filler = 'generic market overview without keywords. '.repeat(40);
    const target = 'Vector Agents AI SDR pricing comparison details. '.repeat(40);
    const md = `${filler}\n\n## Vector Agents\n${target}`;
    const chunks = chunkPageMarkdown(md, { requiredTerms: ['Vector Agents'] });
    expect(chunks.length).toBeLessThanOrEqual(12);
    expect(chunks.some(c => c.content.includes('Vector Agents'))).toBe(true);
  });

  it('creates one chunk per qualifying fact', () => {
    const facts = [
      'A'.repeat(220),
      'Short',
      'B'.repeat(250),
    ];
    const chunks = chunkAgentFacts(facts);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].kind).toBe('fact');
  });
});
