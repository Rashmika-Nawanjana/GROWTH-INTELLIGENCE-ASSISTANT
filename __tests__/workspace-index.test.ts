import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/embeddings', () => ({
  embedText: vi.fn(),
}));

vi.mock('@/lib/workspace/rag-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/rag-config')>();
  return {
    ...actual,
    isWorkspaceRagEnabled: vi.fn(() => true),
    WORKSPACE_INDEX_CONCURRENCY: 2,
  };
});

import { embedText } from '@/lib/embeddings';
import {
  indexWorkspaceArtifact,
  workspaceContentHash,
} from '@/lib/workspace/index-artifact';
import type { AgentOutput } from '@/lib/agents/types';

const payload: AgentOutput = {
  agentId: 'competitive',
  domain: 'competitive',
  confidence: 'medium',
  confidenceScore: 0.6,
  facts: [`Competitive insight about Vector Agents. ${'x'.repeat(220)}`],
  interpretation: [],
  sources: [],
  generatedAt: '2026-01-01T00:00:00.000Z',
  artifactType: 'competitive-matrix',
};

describe('workspace index', () => {
  beforeEach(() => {
    vi.mocked(embedText).mockReset();
    vi.mocked(embedText).mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it('skips re-index when content_hash unchanged', async () => {
    const hash = workspaceContentHash(payload, null);
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'workspace_artifact_chunks') {
          return {
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { content_hash: hash } }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const result = await indexWorkspaceArtifact(supabase, {
      userId: 'user-1',
      workspaceItemId: 'item-1',
      workspaceId: 'ws-1',
      title: 'Test',
      artifactType: 'competitive-matrix',
      product: 'Vector Agents',
      payload,
    });

    expect(result.indexed).toBe(false);
    expect(embedText).not.toHaveBeenCalled();
  });

  it('indexes chunks when hash differs', async () => {
    let inserted = 0;
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'workspace_artifact_chunks') {
          return {
            select: () => ({
              eq: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null }),
                }),
              }),
            }),
            delete: () => ({ eq: async () => ({ error: null }) }),
            insert: async () => {
              inserted += 1;
              return { error: null };
            },
          };
        }
        return {};
      }),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    const result = await indexWorkspaceArtifact(supabase, {
      userId: 'user-1',
      workspaceItemId: 'item-1',
      workspaceId: 'ws-1',
      title: 'Test',
      artifactType: 'competitive-matrix',
      product: 'Vector Agents',
      payload,
      notes: 'Updated notes for enterprise segment.',
    });

    expect(result.indexed).toBe(true);
    expect(result.chunkCount).toBeGreaterThan(0);
    expect(inserted).toBe(1);
  });
});
