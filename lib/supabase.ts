import { createClient } from '@supabase/supabase-js';
import { getAdminClient } from './supabase-admin';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** @deprecated Prefer getAdminClient for signal_cache; kept for legacy conversation helpers. */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Cache TTL in minutes per tool type
const CACHE_TTL: Record<string, number> = {
  serpapi_search: 30,
  serpapi_news: 15,
  serpapi_trends: 60,
  reddit: 20,
  hn: 30,
  firecrawl: 120,
};

export interface CacheEntry {
  id?: string;
  cache_key: string;
  tool: string;
  result: unknown;
  created_at?: string;
}

function cacheClient() {
  try {
    return getAdminClient();
  } catch {
    // Fall back to anon only when service role is missing (local without key).
    // After migration 011 this will fail closed (no RLS policies for anon).
    return supabase;
  }
}

export async function getCached(tool: string, cacheKey: string): Promise<unknown | null> {
  try {
    const ttlMinutes = CACHE_TTL[tool] ?? 30;
    const cutoff = new Date(Date.now() - ttlMinutes * 60 * 1000).toISOString();
    const client = cacheClient();

    const { data, error } = await client
      .from('signal_cache')
      .select('result')
      .eq('cache_key', cacheKey)
      .eq('tool', tool)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return data.result;
  } catch {
    return null;
  }
}

export async function setCache(tool: string, cacheKey: string, result: unknown): Promise<void> {
  try {
    const client = cacheClient();
    await client.from('signal_cache').upsert({
      cache_key: cacheKey,
      tool,
      result,
      created_at: new Date().toISOString(),
    }, { onConflict: 'cache_key,tool' });
  } catch {
    // Cache write failure is non-fatal
  }
}

export async function saveConversation(
  sessionId: string,
  messages: { role: string; content: string }[]
): Promise<void> {
  try {
    const client = cacheClient();
    await client.from('conversations').upsert({
      session_id: sessionId,
      messages,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'session_id' });
  } catch {
    // Non-fatal — legacy table; prefer chat_sessions
  }
}

export async function getConversation(
  sessionId: string
): Promise<{ role: string; content: string }[] | null> {
  try {
    const client = cacheClient();
    const { data } = await client
      .from('conversations')
      .select('messages')
      .eq('session_id', sessionId)
      .single();
    return data?.messages ?? null;
  } catch {
    return null;
  }
}
