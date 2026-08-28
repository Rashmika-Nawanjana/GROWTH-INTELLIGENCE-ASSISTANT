import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { recallSimilarTurns } from '@/lib/memory-store';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { recallBodySchema, formatZodError } = await import('@/lib/validation/schemas');
  const parsed = recallBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodError(parsed.error) }, { status: 400 });
  }

  const { sessionId, query, matchCount } = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const { hits, contextBlock } = await recallSimilarTurns(supabase, {
    sessionId,
    query,
    matchCount,
    userId: user.id,
  });

  return NextResponse.json({ hits, context: contextBlock });
}
