import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { recallSimilarTurns } from '@/lib/memory-store';

export const runtime = 'nodejs';

interface RecallBody {
  sessionId: string;
  query: string;
  matchCount?: number;
}

export async function POST(req: NextRequest) {
  let body: RecallBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { sessionId, query, matchCount = 5 } = body;
  if (!sessionId || !query?.trim()) {
    return NextResponse.json({ error: 'sessionId and query are required' }, { status: 400 });
  }

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
