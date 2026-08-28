import type { SupabaseClient } from '@supabase/supabase-js';
import { generateHuggingFaceJson } from '@/lib/agents/gemini';
import { buildMemoryContext, type MemoryFact, type UserMemory } from '@/lib/memory';
import type { MemoryExtractionInput, MemoryExtractionResult } from './types';

export const EMPTY_USER_MEMORY: UserMemory = {
  role: null,
  company: null,
  products: [],
  competitors: [],
  interests: [],
  facts: [],
  raw_summary: null,
  updated_at: new Date().toISOString(),
};

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.map(s => s.trim()).filter(Boolean))];
}

function mapRowToUserMemory(data: Record<string, unknown>): UserMemory {
  return {
    role: (data.role as string | null) ?? null,
    company: (data.company as string | null) ?? null,
    products: (data.products as string[]) ?? [],
    competitors: (data.competitors as string[]) ?? [],
    interests: (data.interests as string[]) ?? [],
    facts: (data.facts as MemoryFact[]) ?? [],
    raw_summary: (data.raw_summary as string | null) ?? null,
    updated_at: (data.updated_at as string) ?? new Date().toISOString(),
  };
}

export async function getUserMemoryServer(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserMemory> {
  const { data, error } = await supabase
    .from('user_memory')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return { ...EMPTY_USER_MEMORY };

  return mapRowToUserMemory(data as Record<string, unknown>);
}

export interface UserMemoryWithContext {
  memory: UserMemory;
  contextBlock: string;
}

export async function getUserMemoryWithContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserMemoryWithContext> {
  const memory = await getUserMemoryServer(supabase, userId);
  return {
    memory,
    contextBlock: buildMemoryContext(memory),
  };
}

export async function upsertUserMemory(
  supabase: SupabaseClient,
  update: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('user_memory')
    .upsert(update, { onConflict: 'user_id' });
  if (error) throw error;
}

export async function buildMemoryUpdateFromExchange(
  input: MemoryExtractionInput,
  userId: string,
): Promise<MemoryExtractionResult> {
  const { sessionId, userQuery, assistantAnswer, existingMemory } = input;

  const existingSummary = existingMemory.raw_summary
    ? `Existing memory about this user:\n${existingMemory.raw_summary}\nKnown products: ${existingMemory.products.join(', ') || 'none'}\nKnown competitors: ${existingMemory.competitors.join(', ') || 'none'}`
    : 'No prior memory about this user.';

  const systemPrompt = `You are a memory extraction system for a growth intelligence assistant.
Your job is to extract durable facts about the USER from their query — not about the companies they're researching.

Extract ONLY facts that reveal something about WHO THE USER IS:
- Their role or job title
- Their company or product they work on
- Companies/products they regularly research or compete with
- Their strategic focus areas

Do NOT extract facts about external companies — only about the user themselves.`;

  const userPrompt = `${existingSummary}

Latest exchange:
User asked: "${userQuery}"
System answered: "${assistantAnswer.slice(0, 400)}"

Return JSON with this exact shape:
{
  "role": string | null,
  "company": string | null,
  "new_products": string[],
  "new_competitors": string[],
  "new_interests": string[],
  "new_facts": string[],
  "summary_update": string
}`;

  const parsed = await generateHuggingFaceJson<Record<string, unknown>>(systemPrompt, userPrompt, {
    maxNewTokens: 512,
    temperature: 0.1,
  }).catch(() => ({} as Record<string, unknown>));

  const mergedProducts = dedupe([...existingMemory.products, ...((parsed.new_products as string[]) ?? [])]);
  const mergedCompetitors = dedupe([...existingMemory.competitors, ...((parsed.new_competitors as string[]) ?? [])]);
  const mergedInterests = dedupe([...existingMemory.interests, ...((parsed.new_interests as string[]) ?? [])]);

  const newFacts: MemoryFact[] = ((parsed.new_facts as string[]) ?? [])
    .filter(Boolean)
    .map(fact => ({ fact, source_session: sessionId, created_at: new Date().toISOString() }));

  const mergedFacts = [...existingMemory.facts, ...newFacts].slice(-30);

  const update: Record<string, unknown> = {
    user_id: userId,
    products: mergedProducts,
    competitors: mergedCompetitors,
    interests: mergedInterests,
    facts: mergedFacts,
    updated_at: new Date().toISOString(),
  };

  if (parsed.role) update.role = parsed.role;
  if (parsed.company) update.company = parsed.company;
  if (parsed.summary_update) update.raw_summary = parsed.summary_update;

  return { update };
}

export async function updateUserMemoryFromExchange(
  supabase: SupabaseClient,
  userId: string,
  input: MemoryExtractionInput,
): Promise<void> {
  const { update } = await buildMemoryUpdateFromExchange(input, userId);
  await upsertUserMemory(supabase, update);
}
