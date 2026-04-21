import { NextRequest, NextResponse } from 'next/server';
import { generateHuggingFaceJson } from '@/lib/agents/gemini';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { UserMemory, MemoryFact } from '@/lib/memory';

export const runtime = 'nodejs';

function dedupe(arr: string[]): string[] {
  return [...new Set(arr.map(s => s.trim()).filter(Boolean))];
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId, userQuery, assistantAnswer, existingMemory } = await req.json() as {
      sessionId: string;
      userQuery: string;
      assistantAnswer: string;
      existingMemory: UserMemory;
    };

    if (!userQuery?.trim() || !assistantAnswer?.trim()) {
      return NextResponse.json({ ok: true });
    }

    // Server-side Supabase client
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            try {
              cookiesToSet.forEach(({ name, value, options }) => {
                cookieStore.set(name, value, options);
              });
            } catch {
              // Called from a context where cookies can't be mutated — safe to ignore
            }
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });

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
      user_id: user.id,
      products: mergedProducts,
      competitors: mergedCompetitors,
      interests: mergedInterests,
      facts: mergedFacts,
      updated_at: new Date().toISOString(),
    };

    if (parsed.role) update.role = parsed.role;
    if (parsed.company) update.company = parsed.company;
    if (parsed.summary_update) update.raw_summary = parsed.summary_update;

    await supabase.from('user_memory').upsert(update, { onConflict: 'user_id' });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Memory extraction is non-critical — return 200 on rate limit / transient
    // provider errors so the client doesn't surface a DevTools error.
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (
      msg.includes('429') ||
      lower.includes('resource_exhausted') ||
      lower.includes('rate') ||
      lower.includes('hugging face')
    ) {
      return NextResponse.json({ ok: true, skipped: 'rate_limited' });
    }
    console.error('memory route error:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
