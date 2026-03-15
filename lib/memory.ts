import { createClient } from '@/lib/supabase-browser';

export interface UserMemory {
  role: string | null;
  company: string | null;
  products: string[];
  competitors: string[];
  interests: string[];
  facts: MemoryFact[];
  raw_summary: string | null;
  updated_at: string;
}

export interface MemoryFact {
  fact: string;
  source_session: string;
  created_at: string;
}

const EMPTY_MEMORY: UserMemory = {
  role: null,
  company: null,
  products: [],
  competitors: [],
  interests: [],
  facts: [],
  raw_summary: null,
  updated_at: new Date().toISOString(),
};

// ── Read ──────────────────────────────────────────────────────────────────────

export async function getUserMemory(): Promise<UserMemory> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return EMPTY_MEMORY;

  const { data, error } = await supabase
    .from('user_memory')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (error || !data) return EMPTY_MEMORY;

  return {
    role: data.role ?? null,
    company: data.company ?? null,
    products: data.products ?? [],
    competitors: data.competitors ?? [],
    interests: data.interests ?? [],
    facts: (data.facts as MemoryFact[]) ?? [],
    raw_summary: data.raw_summary ?? null,
    updated_at: data.updated_at,
  };
}

// ── Extract + merge after a query ─────────────────────────────────────────────
// Called in the background after every assistant response.
// Delegates to server-side API route — keeps Gemini key off the client.

export async function extractAndUpdateMemory(
  sessionId: string,
  userQuery: string,
  assistantAnswer: string,
  existingMemory: UserMemory,
): Promise<void> {
  try {
    await fetch('/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, userQuery, assistantAnswer, existingMemory }),
    });
  } catch (err) {
    // Non-fatal — memory extraction never blocks the UI
    console.error('memory extraction failed:', err);
  }
}

// ── Build memory context string for agents ────────────────────────────────────

export function buildMemoryContext(memory: UserMemory): string {
  if (!memory.raw_summary && memory.products.length === 0 && memory.facts.length === 0) {
    return '';
  }

  const lines: string[] = ['[USER MEMORY — persistent across all sessions]'];

  if (memory.raw_summary) lines.push(`Who they are: ${memory.raw_summary}`);
  if (memory.role) lines.push(`Role: ${memory.role}`);
  if (memory.company) lines.push(`Company: ${memory.company}`);
  if (memory.products.length > 0) lines.push(`Products they work on: ${memory.products.join(', ')}`);
  if (memory.competitors.length > 0) lines.push(`Competitors they track: ${memory.competitors.join(', ')}`);
  if (memory.interests.length > 0) lines.push(`Strategic interests: ${memory.interests.join(', ')}`);
  if (memory.facts.length > 0) {
    lines.push('Notable facts:');
    memory.facts.slice(-8).forEach(f => lines.push(`  - ${f.fact}`));
  }

  return lines.join('\n');
}

