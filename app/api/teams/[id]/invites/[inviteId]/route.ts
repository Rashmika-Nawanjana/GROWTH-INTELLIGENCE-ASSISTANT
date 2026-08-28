import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

type RouteCtx = { params: Promise<{ id: string; inviteId: string }> };

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const { id: teamId, inviteId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return jsonError('Not authenticated', 401);

  const { data: membership } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membership?.role !== 'owner') return jsonError('Forbidden', 403);

  const { error } = await supabase
    .from('team_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('team_id', teamId);

  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ ok: true });
}
