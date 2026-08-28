import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/embeddings', () => ({
  embedText: vi.fn(),
}));

vi.mock('@/lib/workspace/rag-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspace/rag-config')>();
  return {
    ...actual,
    isWorkspaceRagEnabled: vi.fn(() => true),
    WORKSPACE_RETRIEVE_TIMEOUT_MS: 50,
  };
});

import { embedText } from '@/lib/embeddings';
import { retrieveWorkspaceChunksWithTimeout } from '@/lib/workspace/retrieve';

function makeSupabase(rows: Record<string, unknown>[]) {
  return {
    rpc: vi.fn(async (_name: string, params: Record<string, unknown>) => {
      if (params.p_workspace_item_id) {
        return {
          data: rows.filter(r => r.workspace_item_id === params.p_workspace_item_id),
          error: null,
        };
      }
      if (params.p_workspace_id) {
        return { data: rows, error: null };
      }
      return { data: [], error: null };
    }),
  } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

describe('workspace retrieve', () => {
  beforeEach(() => {
    vi.mocked(embedText).mockReset();
    vi.mocked(embedText).mockResolvedValue([0.5, 0.5, 0.5]);
  });

  it('retrieves item-scoped chunks', async () => {
    const supabase = makeSupabase([
      {
        id: 'c1',
        workspace_item_id: 'item-1',
        section: 'facts',
        chunk_index: 0,
        content: 'Vector Agents workflow strength',
        similarity: 0.91,
        item_title: 'Competitive view',
        artifact_type: 'competitive-matrix',
      },
    ]);

    const result = await retrieveWorkspaceChunksWithTimeout(supabase, {
      userId: 'user-1',
      query: 'workflow',
      workspaceItemId: 'item-1',
      workspaceId: 'ws-1',
    });

    expect(result.itemHits).toHaveLength(1);
    expect(result.itemContextBlock).toContain('RELEVANT SECTIONS');
  });

  it('excludes current item from board context block', async () => {
    const supabase = makeSupabase([
      {
        id: 'c1',
        workspace_item_id: 'item-1',
        section: 'facts',
        chunk_index: 0,
        content: 'same item',
        similarity: 0.9,
        item_title: 'A',
        artifact_type: 'score-card',
      },
      {
        id: 'c2',
        workspace_item_id: 'item-2',
        section: 'interpretation',
        chunk_index: 0,
        content: 'other board item',
        similarity: 0.85,
        item_title: 'B',
        artifact_type: 'trend-chart',
      },
    ]);

    const result = await retrieveWorkspaceChunksWithTimeout(supabase, {
      userId: 'user-1',
      query: 'compare',
      workspaceItemId: 'item-1',
      workspaceId: 'ws-1',
    });

    expect(result.boardContextBlock).toContain('B');
    expect(result.boardContextBlock).not.toContain('same item');
  });

  it('fail-opens on timeout', async () => {
    vi.mocked(embedText).mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve([0.1]), 200)),
    );

    const supabase = makeSupabase([]);
    const result = await retrieveWorkspaceChunksWithTimeout(supabase, {
      userId: 'user-1',
      query: 'slow',
      workspaceItemId: 'item-1',
    });

    expect(result.itemHits).toHaveLength(0);
    expect(result.boardHits).toHaveLength(0);
  });

  it('returns empty when RAG disabled', async () => {
    const { isWorkspaceRagEnabled } = await import('@/lib/workspace/rag-config');
    vi.mocked(isWorkspaceRagEnabled).mockReturnValue(false);

    const supabase = makeSupabase([]);
    const result = await retrieveWorkspaceChunksWithTimeout(supabase, {
      userId: 'user-1',
      query: 'test',
      workspaceItemId: 'item-1',
    });

    expect(result.itemHits).toHaveLength(0);
  });
});
