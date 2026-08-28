import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/embeddings', () => ({
  embedText: vi.fn(),
}));

vi.mock('@/lib/evidence/config', () => ({
  isEvidenceRagEnabled: vi.fn(() => true),
  evidenceRagTopK: vi.fn(() => 8),
  evidenceRagDefaultMaxAgeDays: vi.fn(() => 30),
  maxAgeDaysForDomain: vi.fn(() => 7),
  EVIDENCE_RETRIEVE_TIMEOUT_MS: 1500,
}));

import { embedText } from '@/lib/embeddings';
import {
  buildDomainEvidenceBlock,
  retrieveEvidence,
  retrieveEvidenceWithTimeout,
} from '@/lib/evidence/retrieve';
import type { RetrievedEvidenceHit } from '@/lib/agents/types';

function mockSupabase(rpcData: unknown[] | null, rpcError: { message: string } | null = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: rpcData, error: rpcError }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

const sampleHit: RetrievedEvidenceHit = {
  id: 'c1',
  documentId: 'd1',
  kind: 'page',
  content: 'Vector Agents pricing starts at enterprise tier.',
  similarity: 0.91,
  url: 'https://example.com/pricing',
  title: 'Pricing',
  sourceTool: 'firecrawl',
  domain: 'pricing',
  product: 'vector agents',
  fetchedAt: new Date().toISOString(),
  ageDays: 2,
};

describe('evidence retrieve', () => {
  beforeEach(() => {
    vi.mocked(embedText).mockReset();
  });

  it('returns empty when embedding unavailable', async () => {
    vi.mocked(embedText).mockResolvedValue(null);
    const result = await retrieveEvidence(mockSupabase([]), {
      userId: 'user-1',
      query: 'pricing',
    });
    expect(result.hits).toEqual([]);
    expect(result.contextBlock).toBe('');
  });

  it('builds age-labeled context block', async () => {
    vi.mocked(embedText).mockResolvedValue([0.1, 0.2]);
    const supabase = mockSupabase([
      {
        id: 'c1',
        document_id: 'd1',
        kind: 'page',
        chunk_index: 0,
        content: sampleHit.content,
        similarity: 0.91,
        url: sampleHit.url,
        title: sampleHit.title,
        source_tool: 'firecrawl',
        domain: 'pricing',
        product: 'vector agents',
        fetched_at: sampleHit.fetchedAt,
        age_days: 2,
      },
    ]);

    const result = await retrieveEvidence(supabase, {
      userId: 'user-1',
      query: 'vector agents pricing',
      product: 'Vector Agents',
      domain: 'pricing',
    });

    expect(result.hits).toHaveLength(1);
    expect(result.contextBlock).toContain('PRIOR VERIFIED EVIDENCE');
    expect(result.contextBlock).toContain('context only');
    expect(result.contextBlock).toContain('2 days ago');
  });

  it('fail-opens on timeout', async () => {
    vi.mocked(embedText).mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve([0.1]), 50)),
    );
    const supabase = {
      rpc: vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ data: [], error: null }), 100)),
      ),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const result = await retrieveEvidenceWithTimeout(
      supabase,
      { userId: 'user-1', query: 'test' },
      10,
    );
    expect(result.hits).toEqual([]);
  });

  it('filters hits per domain for block builder', () => {
    const hits: RetrievedEvidenceHit[] = [
      sampleHit,
      { ...sampleHit, id: 'c2', domain: 'competitive', content: 'Competitor landscape data.' },
    ];
    const block = buildDomainEvidenceBlock(hits, 'pricing');
    expect(block).toContain('Pricing');
    expect(block).not.toContain('Competitor landscape');
  });
});
