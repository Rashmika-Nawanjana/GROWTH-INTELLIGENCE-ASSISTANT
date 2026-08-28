import type { SupabaseClient } from '@supabase/supabase-js';
import { embedText } from '@/lib/embeddings';
import type { RecallHit, RecallResult } from './types';

export interface RecallSimilarTurnsInput {
  sessionId: string;
  query: string;
  matchCount?: number;
  userId?: string;
}

function buildRecallContextBlock(hits: RecallHit[]): string {
  if (!hits.length) return '';
  return `[Relevant context from earlier in this chat]\n${hits
    .map(h => `- (${h.role}) ${h.content.slice(0, 300)}`)
    .join('\n')}`;
}

export async function recallSimilarTurns(
  supabase: SupabaseClient,
  input: RecallSimilarTurnsInput,
): Promise<RecallResult> {
  const { sessionId, query, matchCount = 5, userId } = input;

  if (!sessionId || !query?.trim()) {
    return { hits: [], contextBlock: '' };
  }

  if (userId) {
    const { data: session } = await supabase
      .from('chat_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!session) {
      return { hits: [], contextBlock: '' };
    }
  }

  const embedding = await embedText(query);
  if (!embedding) {
    return { hits: [], contextBlock: '' };
  }

  const { data, error } = await supabase.rpc('match_chat_embeddings', {
    p_session_id: sessionId,
    p_query_embedding: embedding as unknown as string,
    p_match_count: matchCount,
  });

  if (error) {
    console.error('[recall rpc]', error.message);
    return { hits: [], contextBlock: '' };
  }

  const hits = (data ?? []) as RecallHit[];
  return {
    hits,
    contextBlock: buildRecallContextBlock(hits),
  };
}
