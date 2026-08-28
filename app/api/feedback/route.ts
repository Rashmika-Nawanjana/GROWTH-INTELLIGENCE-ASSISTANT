import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getPastOutcomes, recordOutcome } from '@/lib/memory-store';
import type { OutcomeRecordPayload } from '@/lib/memory-store';

export const runtime = 'nodejs';

async function getSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
}

export async function POST(req: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  const { feedbackBodySchema, formatZodError } = await import('@/lib/validation/schemas');
  const parsed = feedbackBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: formatZodError(parsed.error) }, { status: 400 });
  }

  const body = parsed.data as OutcomeRecordPayload;

  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }

  try {
    await recordOutcome(supabase, user.id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const { toPublicError } = await import('@/lib/api/errors');
    const { message } = toPublicError(err, 'Failed to record feedback');
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ ok: false, error: 'sessionId required' }, { status: 400 });
  }

  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }

  const { feedback, actions, variantResults } = await getPastOutcomes(supabase, {
    sessionId,
    scope: 'session',
    limit: 50,
    userId: user.id,
  });

  return NextResponse.json({
    ok: true,
    feedback,
    actions,
    variantResults,
  });
}
