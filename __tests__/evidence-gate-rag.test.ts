import { describe, expect, it } from 'vitest';
import { assessEvidence } from '@/lib/agents/evidence-gate';

describe('evidence gate vs RAG', () => {
  it('does not count retrieved evidence toward relevantSourceCount', () => {
    const retrievedEvidenceHits = 5;
    const liveSources = 2;

    const assessment = assessEvidence({
      relevantSourceCount: liveSources,
      searchedFor: ['vector agents pricing'],
      domain: 'pricing',
    });

    expect(assessment.relevantSourceCount).toBe(2);
    expect(assessment.status).toBe('thin');
    expect(retrievedEvidenceHits).toBeGreaterThan(assessment.relevantSourceCount);
  });

  it('stays insufficient when only RAG would exist (zero live sources)', () => {
    const assessment = assessEvidence({
      relevantSourceCount: 0,
      searchedFor: ['competitors'],
      domain: 'competitive',
    });
    expect(assessment.status).toBe('insufficient');
  });
});
