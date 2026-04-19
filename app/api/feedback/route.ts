import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';

// ── Body shapes ─────────────────────────────────────────────────────────────
// A single unified endpoint that accepts three kinds of feedback payloads.
// Discriminated union keeps the wire format small and the UI simple.

type RecommendationFeedbackBody = {
  kind: 'recommendation-feedback';
  sessionId: string;
  messageId?: string | null;
  recommendationKey: string;          // stable hash built on the client
  title: string;
  rating: 'up' | 'down' | 'neutral';
  note?: string;
};

type RecommendationActionBody = {
  kind: 'recommendation-action';
  sessionId: string;
  messageId?: string | null;
  recommendationKey: string;
  title: string;
  action: 'accepted' | 'rejected' | 'refined' | 'copied';
  metadata?: Record<string, unknown>;
};

type VariantResultBody = {
  kind: 'variant-result';
  sessionId: string;
  messageId?: string | null;
  variantId: string;
  variantAngle?: string;
  hypothesis?: string;
  successMetric?: string;
  sentCount?: number;
  openRate?: number;
  replyRate?: number;
  clickRate?: number;
  meetingsBooked?: number;
  hypothesisConfirmed?: 'yes' | 'no' | 'unclear';
  notes?: string;
};

type FeedbackBody = RecommendationFeedbackBody | RecommendationActionBody | VariantResultBody;

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
  let body: FeedbackBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  if (!body?.kind || !body.sessionId) {
    return NextResponse.json({ ok: false, error: 'missing kind or sessionId' }, { status: 400 });
  }

  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  }

  try {
    if (body.kind === 'recommendation-feedback') {
      if (!body.recommendationKey || !body.title || !body.rating) {
        return NextResponse.json({ ok: false, error: 'missing required fields' }, { status: 400 });
      }
      const { error } = await supabase.from('recommendation_feedback').insert({
        user_id: user.id,
        session_id: body.sessionId,
        message_id: body.messageId ?? null,
        recommendation_key: body.recommendationKey,
        title: body.title,
        rating: body.rating,
        note: body.note ?? null,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.kind === 'recommendation-action') {
      if (!body.recommendationKey || !body.title || !body.action) {
        return NextResponse.json({ ok: false, error: 'missing required fields' }, { status: 400 });
      }
      const { error } = await supabase.from('recommendation_actions').insert({
        user_id: user.id,
        session_id: body.sessionId,
        message_id: body.messageId ?? null,
        recommendation_key: body.recommendationKey,
        title: body.title,
        action: body.action,
        metadata: body.metadata ?? {},
      });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (body.kind === 'variant-result') {
      if (!body.variantId) {
        return NextResponse.json({ ok: false, error: 'missing variantId' }, { status: 400 });
      }
      const { error } = await supabase.from('variant_results').insert({
        user_id: user.id,
        session_id: body.sessionId,
        message_id: body.messageId ?? null,
        variant_id: body.variantId,
        variant_angle: body.variantAngle ?? null,
        hypothesis: body.hypothesis ?? null,
        success_metric: body.successMetric ?? null,
        sent_count: body.sentCount ?? null,
        open_rate: body.openRate ?? null,
        reply_rate: body.replyRate ?? null,
        click_rate: body.clickRate ?? null,
        meetings_booked: body.meetingsBooked ?? null,
        hypothesis_confirmed: body.hypothesisConfirmed ?? null,
        notes: body.notes ?? null,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: 'unknown kind' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'server error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// ── GET — pull accumulated outcomes for a session (used by /refine) ─────────
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

  const [feedbackRes, actionsRes, resultsRes] = await Promise.all([
    supabase.from('recommendation_feedback').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(50),
    supabase.from('recommendation_actions').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(50),
    supabase.from('variant_results').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(50),
  ]);

  return NextResponse.json({
    ok: true,
    feedback: feedbackRes.data ?? [],
    actions: actionsRes.data ?? [],
    variantResults: resultsRes.data ?? [],
  });
}
