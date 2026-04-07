import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { embedText } from '@/lib/embeddings';

export const runtime = 'nodejs';

interface RecallBody {
  sessionId: string;
  query: string;
  matchCount?: number;
}

interface RecallHit {
  id: string;
  message_id: string | null;
  role: 'user' | 'assistant';
  content: string;
  similarity: number;
  created_at: string;
}

export async function POST(req: NextRequest) {
  let body: RecallBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId, query, matchCount = 5 } = body;
  if (!sessionId || !query?.trim()) {
    return NextResponse.json({ error: 'sessionId and query are required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Verify session ownership
  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ hits: [], context: '' });
  }

  const embedding = await embedText(query);
  if (!embedding) {
    return NextResponse.json({ hits: [], context: '' });
  }

  const { data, error } = await supabase.rpc('match_chat_embeddings', {
    p_session_id: sessionId,
    p_query_embedding: embedding as unknown as string,
    p_match_count: matchCount,
  });

  if (error) {
    console.error('[recall rpc]', error.message);
    return NextResponse.json({ hits: [], context: '' });
  }

  const hits = (data ?? []) as RecallHit[];

  // Build a labeled context block the orchestrator can inject into prompts
  const context = hits.length
    ? `[Relevant context from earlier in this chat]\n${hits
        .map(h => `- (${h.role}) ${h.content.slice(0, 300)}`)
        .join('\n')}`
    : '';

  return NextResponse.json({ hits, context });
}
