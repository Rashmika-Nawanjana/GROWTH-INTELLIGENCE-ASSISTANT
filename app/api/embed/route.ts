import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { embedText } from '@/lib/embeddings';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { embedBodySchema, formatZodError } = await import('@/lib/validation/schemas');
  const parsed = embedBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const { sessionId, messageId, role, content } = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Verify session ownership (RLS will also enforce this on insert)
  const { data: session } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  const embedding = await embedText(content, 'embed-api');
  if (!embedding) {
    // Embedding model unavailable (quota, region, or key scope) — skip indexing silently.
    // The chat system works without semantic recall; embeddings are a background enhancement only.
    return NextResponse.json({ ok: true, skipped: true });
  }

  const { error } = await supabase.from('chat_embeddings').insert({
    session_id: sessionId,
    message_id: messageId ?? null,
    role,
    content: content.slice(0, 8000),
    embedding: embedding as unknown as string, // pgvector accepts number[] via supabase-js
  });

  if (error) {
    console.error('[embed insert]', error.message);
    const { toPublicError } = await import('@/lib/api/errors');
    const { message } = toPublicError(error, 'Failed to store embedding');
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
