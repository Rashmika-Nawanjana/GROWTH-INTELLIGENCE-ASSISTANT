import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/embeddings', () => ({
  embedText: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  getCached: vi.fn(),
}));

vi.mock('@/lib/evidence/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/evidence/config')>();
  return {
    ...actual,
    isEvidenceRagEnabled: vi.fn(() => true),
    EVIDENCE_INDEX_CONCURRENCY: 2,
  };
});

import { embedText } from '@/lib/embeddings';
import { getCached } from '@/lib/supabase';
import { indexRunEvidence } from '@/lib/evidence/store';
import type { AgentOutput } from '@/lib/agents/types';

function makeOutput(overrides: Partial<AgentOutput> = {}): AgentOutput {
  return {
    agentId: 'competitive',
    domain: 'competitive',
    confidence: 'medium',
    confidenceScore: 0.6,
    facts: ['A'.repeat(220)],
    interpretation: [],
    sources: [{
      url: 'https://example.com/page',
      title: 'Example',
      timestamp: '2026-01-01T00:00:00.000Z',
      tool: 'firecrawl',
    }],
    generatedAt: '2026-01-01T00:00:00.000Z',
    artifactType: 'competitive-matrix',
    ...overrides,
  };
}

describe('evidence store', () => {
  beforeEach(() => {
    vi.mocked(embedText).mockReset();
    vi.mocked(getCached).mockReset();
    vi.mocked(embedText).mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('indexes from signal_cache markdown', async () => {
    vi.mocked(getCached).mockResolvedValue({
      data: {
        url: 'https://example.com/page',
        title: 'Example',
        markdown: `## Overview\n${'Vector Agents competitive positioning details. '.repeat(20)}`,
        excerpt: 'excerpt',
      },
      source: 'firecrawl',
      timestamp: '2026-01-01T00:00:00.000Z',
      confidence: 0.9,
      cached: false,
    });

    const inserts: unknown[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'evidence_documents') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null }),
                }),
              }),
            }),
            insert: (row: unknown) => {
              inserts.push({ table, row });
              return {
                select: () => ({
                  single: async () => ({ data: { id: 'doc-1' }, error: null }),
                }),
              };
            },
            update: () => ({ eq: async () => ({ error: null }) }),
          };
        }
        if (table === 'evidence_chunks') {
          return {
            delete: () => ({ eq: async () => ({ error: null }) }),
            insert: async (rows: unknown) => {
              inserts.push({ table, rows });
              return { error: null };
            },
          };
        }
        return {};
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const result = await indexRunEvidence(supabase, {
      userId: 'user-1',
      outputs: [makeOutput()],
      classification: { product: 'Vector Agents' },
    });

    expect(result.indexedDocuments).toBe(1);
    expect(inserts.some(i => JSON.stringify(i).includes('evidence_chunks'))).toBe(true);
  });

  it('falls back to facts when cache misses', async () => {
    vi.mocked(getCached).mockResolvedValue(null);

    const inserts: unknown[] = [];
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'evidence_documents') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null }),
                }),
              }),
            }),
            insert: (row: unknown) => {
              inserts.push({ table, row });
              return {
                select: () => ({
                  single: async () => ({ data: { id: 'doc-2' }, error: null }),
                }),
              };
            },
          };
        }
        if (table === 'evidence_chunks') {
          return {
            delete: () => ({ eq: async () => ({ error: null }) }),
            insert: async (rows: unknown) => {
              inserts.push({ table, rows });
              return { error: null };
            },
          };
        }
        return {};
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const result = await indexRunEvidence(supabase, {
      userId: 'user-1',
      outputs: [makeOutput()],
      classification: { product: 'Vector Agents' },
    });

    expect(result.indexedDocuments).toBe(1);
    const docInsert = inserts.find(
      i => typeof i === 'object' && i !== null && (i as { table?: string }).table === 'evidence_documents',
    ) as { row?: { source_tool?: string } } | undefined;
    expect(docInsert?.row?.source_tool).toBe('firecrawl');
  });
});
