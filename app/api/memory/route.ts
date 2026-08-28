import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { buildMemoryUpdateFromExchange, getUserMemoryServer, upsertUserMemory } from '@/lib/memory-store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const { memoryBodySchema, formatZodError } = await import('@/lib/validation/schemas');
    const parsed = memoryBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400 });
    }

    const { sessionId, userQuery: rawQuery, assistantAnswer } = parsed.data;

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

    const { enforceUserQuotas, guardInput, logGuardrailEvent } = await import('@/lib/guardrails');
    const quota = await enforceUserQuotas(supabase, user.id, 'memory');
    if (!quota.allowed) {
      return NextResponse.json({ ok: true, skipped: 'rate_limited' });
    }

    const verdict = await guardInput(rawQuery);
    if (verdict.blocked) {
      await logGuardrailEvent(supabase, {
        userId: user.id,
        route: 'memory',
        risk: verdict.risk,
        blocked: true,
        findings: verdict.findings,
      });
      return NextResponse.json({ ok: true, skipped: 'blocked' });
    }

    // Load existing memory from DB — do not trust client-supplied existingMemory
    const existingMemory = await getUserMemoryServer(supabase, user.id);

    const { update } = await buildMemoryUpdateFromExchange(
      {
        sessionId,
        userQuery: verdict.redactedText,
        assistantAnswer,
        existingMemory,
      },
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
    console.error('memory route error:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
