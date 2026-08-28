import type { SupabaseClient } from '@supabase/supabase-js';
import { embedText } from '@/lib/embeddings';
import {
  isWorkspaceRagEnabled,
  WORKSPACE_RETRIEVE_TIMEOUT_MS,
  workspaceRagBoardTopK,
  workspaceRagItemTopK,
} from './rag-config';
import type {
  RetrievedWorkspaceChunk,
  WorkspaceRetrieveResult,
} from './rag-types';

export interface RetrieveWorkspaceInput {
  userId: string;
  query: string;
  workspaceItemId: string;
  workspaceId?: string | null;
  product?: string;
  itemTopK?: number;
  boardTopK?: number;
}

function normalizeProduct(product?: string): string | null {
  const p = product?.trim();
  if (!p) return null;
  return p;
}

function mapRpcRow(row: Record<string, unknown>): RetrievedWorkspaceChunk {
  return {
    id: String(row.id),
    workspaceItemId: String(row.workspace_item_id),
    section: String(row.section) as RetrievedWorkspaceChunk['section'],
    content: String(row.content ?? ''),
    similarity: Number(row.similarity ?? 0),
    itemTitle: String(row.item_title ?? ''),
    artifactType: String(row.artifact_type ?? ''),
  };
}

function buildItemContextBlock(hits: RetrievedWorkspaceChunk[]): string {
  if (!hits.length) return '';
  const lines = hits.map(
    h =>
      `- (${h.section}, ${h.similarity.toFixed(2)}) ${h.content.slice(0, 500)}`,
  );
  return [
    '[RELEVANT SECTIONS — retrieved by semantic search]',
    ...lines,
  ].join('\n');
}

function buildBoardContextBlock(
  hits: RetrievedWorkspaceChunk[],
  excludeItemId: string,
): string {
  const filtered = hits.filter(h => h.workspaceItemId !== excludeItemId);
  if (!filtered.length) return '';
  const lines = filtered.map(
    h =>
      `- ${h.itemTitle} (${h.artifactType}, ${h.similarity.toFixed(2)}): ${h.content.slice(0, 350)}`,
  );
  return [
    '[OTHER ARTIFACTS ON THIS BOARD — context only]',
    ...lines,
  ].join('\n');
}

async function matchChunks(
  supabase: SupabaseClient,
  input: RetrieveWorkspaceInput,
  scope: 'item' | 'board',
  embedding: number[],
): Promise<RetrievedWorkspaceChunk[]> {
  const topK =
    scope === 'item'
      ? (input.itemTopK ?? workspaceRagItemTopK())
      : (input.boardTopK ?? workspaceRagBoardTopK());

  const { data, error } = await supabase.rpc('match_workspace_chunks', {
    p_user_id: input.userId,
    p_query_embedding: embedding as unknown as string,
    p_match_count: topK,
    p_workspace_item_id: scope === 'item' ? input.workspaceItemId : null,
    p_workspace_id: scope === 'board' ? (input.workspaceId ?? null) : null,
    p_product: normalizeProduct(input.product),
  });

  if (error) {
    console.error(`[workspace retrieve ${scope}]`, error.message);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => mapRpcRow(row));
}

export async function retrieveWorkspaceChunks(
  supabase: SupabaseClient,
  input: RetrieveWorkspaceInput,
  embedding?: number[] | null,
): Promise<WorkspaceRetrieveResult> {
  const empty: WorkspaceRetrieveResult = {
    itemHits: [],
    boardHits: [],
    itemContextBlock: '',
    boardContextBlock: '',
  };

  if (!isWorkspaceRagEnabled()) return empty;
  if (!input.userId || !input.query?.trim()) return empty;

  const queryEmbedding = embedding ?? (await embedText(input.query, 'workspace-retrieve'));
  if (!queryEmbedding) return empty;

  const [itemHits, boardHits] = await Promise.all([
    matchChunks(supabase, input, 'item', queryEmbedding),
    input.workspaceId
      ? matchChunks(supabase, input, 'board', queryEmbedding)
      : Promise.resolve([]),
  ]);

  return {
    itemHits,
    boardHits,
    itemContextBlock: buildItemContextBlock(itemHits),
    boardContextBlock: buildBoardContextBlock(boardHits, input.workspaceItemId),
  };
}

export async function retrieveWorkspaceChunksWithTimeout(
  supabase: SupabaseClient,
  input: RetrieveWorkspaceInput,
  timeoutMs = WORKSPACE_RETRIEVE_TIMEOUT_MS,
): Promise<WorkspaceRetrieveResult> {
  const empty: WorkspaceRetrieveResult = {
    itemHits: [],
    boardHits: [],
    itemContextBlock: '',
    boardContextBlock: '',
  };

  if (!isWorkspaceRagEnabled()) return empty;

  try {
    return await Promise.race([
      retrieveWorkspaceChunks(supabase, input),
      new Promise<WorkspaceRetrieveResult>((_, reject) => {
        setTimeout(() => reject(new Error('workspace retrieve timeout')), timeoutMs);
      }),
    ]);
  } catch {
    return empty;
  }
}
