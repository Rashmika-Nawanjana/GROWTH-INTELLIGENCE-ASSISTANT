import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { UserMemory } from '@/lib/memory';
import { buildMemoryUpdateFromExchange, upsertUserMemory } from '@/lib/memory-store';

export const runtime = 'nodejs';

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

    const { update } = await buildMemoryUpdateFromExchange(
      { sessionId, userQuery, assistantAnswer, existingMemory },
      user.id,
    );
    await upsertUserMemory(supabase, update);

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (
      msg.includes('429') ||
      lower.includes('resource_exhausted') ||
      lower.includes('rate') ||
      lower.includes('gemini') ||
      lower.includes('hugging face')
    ) {
      return NextResponse.json({ ok: true, skipped: 'rate_limited' });
    }
    console.error('memory route error:', err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
