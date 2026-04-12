import { createClient } from '@/lib/supabase-browser';

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface StoredMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function createSession(title: string): Promise<ChatSession | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('chat_sessions')
    .insert({ user_id: user.id, title, updated_at: new Date().toISOString() })
    .select()
    .single();

  if (error) { console.error('createSession:', error.message); return null; }
  return data as ChatSession;
}

export async function updateSessionTitle(sessionId: string, title: string): Promise<void> {
  const supabase = createClient();
  await supabase
    .from('chat_sessions')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', sessionId);
}

export async function listSessions(): Promise<ChatSession[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('chat_sessions')
    .select('id, title, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(40);

  if (error) { console.error('listSessions:', error.message); return []; }
  return (data ?? []) as ChatSession[];
}

export async function deleteSession(sessionId: string): Promise<void> {
  const supabase = createClient();
  await supabase.from('chat_sessions').delete().eq('id', sessionId);
}

// ── Messages ──────────────────────────────────────────────────────────────────

export async function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
  metadata: Record<string, unknown> = {},
): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      session_id: sessionId,
      role,
      content,
      metadata,
    })
    .select('id')
    .single();
  if (error) {
    console.error('saveMessage:', error.message);
    return null;
  }

  // Keep updated_at fresh on the session
  await supabase
    .from('chat_sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId);

  return (data?.id as string | undefined) ?? null;
}

export async function loadMessages(sessionId: string): Promise<StoredMessage[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) { console.error('loadMessages:', error.message); return []; }
  return (data ?? []) as StoredMessage[];
}
