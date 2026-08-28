import { describe, expect, it } from 'vitest';
import { chunkWorkspaceArtifact } from '@/lib/workspace/chunker';
import type { AgentOutput } from '@/lib/agents/types';

function makePayload(overrides: Partial<AgentOutput> = {}): AgentOutput {
  return {
    agentId: 'competitive',
    domain: 'competitive',
    confidence: 'medium',
    confidenceScore: 0.6,
    facts: [`Vector Agents leads in workflow automation. ${'detail '.repeat(30)}`],
    interpretation: [`Market is consolidating around digital workers. ${'context '.repeat(25)}`],
    sources: [
      {
        url: 'https://example.com/review',
        title: 'G2 Review — Vector Agents competitive positioning and buyer sentiment across enterprise segments',
        timestamp: '2026-01-01T00:00:00.000Z',
        tool: 'firecrawl',
      },
      {
        url: 'https://example.com/news',
        title: 'TechCrunch — Digital workers category consolidation accelerates as buyers demand workflow depth',
        timestamp: '2026-01-02T00:00:00.000Z',
        tool: 'serpapi',
      },
    ],
    generatedAt: '2026-01-01T00:00:00.000Z',
    artifactType: 'competitive-matrix',
    ...overrides,
  };
}

describe('workspace chunker', () => {
  it('chunks facts, interpretation, sources, and notes', () => {
    const chunks = chunkWorkspaceArtifact(
      makePayload(),
      'Focus on enterprise buyers in Q2 and emphasize workflow automation depth over generic AI SDR positioning when speaking to procurement teams. Highlight integration depth and security posture.',
    );

    const sections = new Set(chunks.map(c => c.section));
    expect(sections.has('facts')).toBe(true);
    expect(sections.has('interpretation')).toBe(true);
    expect(sections.has('sources')).toBe(true);
    expect(sections.has('notes')).toBe(true);
  });

  it('includes domain-specific fields', () => {
    const withMatrix = {
      ...makePayload(),
      matrix: [
        {
          competitor: 'Lilian',
          features: { sdr: true, workflow: false, integrations: true },
          score: 0.7,
          summary:
            'Lilian competes on outbound automation but lacks deep workflow orchestration for complex enterprise sales cycles and multi-stakeholder buying committees.',
        },
      ],
    } as AgentOutput & { matrix: unknown[] };

    const chunks = chunkWorkspaceArtifact(withMatrix);

    expect(chunks.some(c => c.section === 'domain')).toBe(true);
    expect(chunks.some(c => c.content.includes('matrix'))).toBe(true);
  });

  it('drops chunks under minimum size', () => {
    const chunks = chunkWorkspaceArtifact(
      makePayload({ facts: ['short'], interpretation: ['tiny'] }),
    );
    expect(chunks.filter(c => c.section === 'facts')).toHaveLength(0);
  });
});
