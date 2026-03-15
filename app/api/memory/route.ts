import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { UserMemory, MemoryFact } from '@/lib/memory';

export const runtime = 'nodejs';

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
    return JSON.parse(clean);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch { /* ignore */ } }
    return {};
  }
}

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
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const existingSummary = existingMemory.raw_summary
      ? `Existing memory about this user:\n${existingMemory.raw_summary}\nKnown products: ${existingMemory.products.join(', ') || 'none'}\nKnown competitors: ${existingMemory.competitors.join(', ') || 'none'}`
      : 'No prior memory about this user.';

    const prompt = `You are a memory extraction system for a growth intelligence assistant.
Your job is to extract durable facts about the USER from their query — not about the companies they're researching.

${existingSummary}

Latest exchange:
User asked: "${userQuery}"
System answered: "${assistantAnswer.slice(0, 400)}"

Extract ONLY facts that reveal something about WHO THE USER IS:
- Their role or job title
- Their company or product they work on
- Companies/products they regularly research or compete with
- Their strategic focus areas

Do NOT extract facts about external companies — only about the user themselves.

Return JSON:
{
  "role": string | null,
  "company": string | null,
  "new_products": string[],
  "new_competitors": string[],
  "new_interests": string[],
  "new_facts": string[],
  "summary_update": string
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json' },
    });

    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const parsed = safeParseJson(raw);

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
    console.error('memory route error:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
