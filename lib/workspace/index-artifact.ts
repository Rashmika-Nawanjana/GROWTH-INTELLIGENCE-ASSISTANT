import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgentOutput } from '@/lib/agents/types';
import { embedText } from '@/lib/embeddings';
import { chunkWorkspaceArtifact } from './chunker';
import {
  isWorkspaceRagEnabled,
  WORKSPACE_INDEX_CONCURRENCY,
} from './rag-config';
import type { WorkspaceChunkDraft } from './rag-types';

export interface IndexWorkspaceArtifactInput {
  userId: string;
  workspaceItemId: string;
  workspaceId: string | null;
  title: string;
  artifactType: string;
  product: string;
  payload: AgentOutput;
  notes?: string | null;
}

export function workspaceContentHash(
  payload: AgentOutput,
  notes?: string | null,
): string {
  return createHash('sha256')
    .update(JSON.stringify({ payload, notes: notes ?? '' }))
    .digest('hex');
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length || 1) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

async function getExistingContentHash(
  supabase: SupabaseClient,
  workspaceItemId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('workspace_artifact_chunks')
    .select('content_hash')
    .eq('workspace_item_id', workspaceItemId)
    .limit(1)
    .maybeSingle();

  return data?.content_hash ? String(data.content_hash) : null;
}

export async function indexWorkspaceArtifact(
  supabase: SupabaseClient,
  input: IndexWorkspaceArtifactInput,
): Promise<{ indexed: boolean; chunkCount: number }> {
  if (!isWorkspaceRagEnabled()) {
    return { indexed: false, chunkCount: 0 };
  }

  const hash = workspaceContentHash(input.payload, input.notes);
  const existing = await getExistingContentHash(supabase, input.workspaceItemId);
  if (existing === hash) {
    return { indexed: false, chunkCount: 0 };
  }

  const drafts = chunkWorkspaceArtifact(input.payload, input.notes);
  if (drafts.length === 0) {
    return { indexed: false, chunkCount: 0 };
  }

  await supabase
    .from('workspace_artifact_chunks')
    .delete()
    .eq('workspace_item_id', input.workspaceItemId);

  const rows = await mapWithConcurrency(
    drafts,
    WORKSPACE_INDEX_CONCURRENCY,
    async (draft: WorkspaceChunkDraft) => {
      const embedding = await embedText(draft.content, 'workspace-index');
      if (!embedding) return null;
      return {
        user_id: input.userId,
        workspace_item_id: input.workspaceItemId,
        workspace_id: input.workspaceId,
        section: draft.section,
        chunk_index: draft.chunkIndex,
        content: draft.content.slice(0, 8000),
        content_hash: hash,
        embedding: embedding as unknown as string,
      };
    },
  );

  const validRows = rows.filter((r): r is NonNullable<typeof r> => r !== null);
  if (validRows.length === 0) {
    return { indexed: false, chunkCount: 0 };
  }

  const { error } = await supabase.from('workspace_artifact_chunks').insert(validRows);
  if (error) {
    console.error('[workspace index]', error.message);
    return { indexed: false, chunkCount: 0 };
  }

  return { indexed: true, chunkCount: validRows.length };
}

export async function countWorkspaceChunks(
  supabase: SupabaseClient,
  workspaceItemId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('workspace_artifact_chunks')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_item_id', workspaceItemId);

  if (error) return 0;
  return count ?? 0;
}
