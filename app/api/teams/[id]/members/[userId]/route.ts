import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

type RouteCtx = { params: Promise<{ id: string; userId: string }> };

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const { id: teamId, userId: targetUserId } = await ctx.params;
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

  let body: { role?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const role = body.role;
  if (role !== 'editor' && role !== 'viewer' && role !== 'owner') {
    return jsonError('role must be owner, editor, or viewer', 400);
  }

  if (role === 'owner' && targetUserId !== user.id) {
    return jsonError('Cannot assign owner role to another user in MVP', 400);
  }

  const { error } = await supabase
    .from('team_members')
    .update({ role })
    .eq('team_id', teamId)
    .eq('user_id', targetUserId);

  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: RouteCtx) {
  const { id: teamId, userId: targetUserId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return jsonError('Not authenticated', 401);

  const { data: membership } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .maybeSingle();

  const isOwner = membership?.role === 'owner';
  const isSelf = targetUserId === user.id;

  if (!isOwner && !isSelf) return jsonError('Forbidden', 403);

  if (isOwner && !isSelf) {
    const { data: owners } = await supabase
      .from('team_members')
      .select('id')
      .eq('team_id', teamId)
      .eq('role', 'owner');

    const { data: target } = await supabase
      .from('team_members')
      .select('role')
      .eq('team_id', teamId)
      .eq('user_id', targetUserId)
      .maybeSingle();

    if (target?.role === 'owner' && (owners?.length ?? 0) <= 1) {
      return jsonError('Cannot remove the last owner', 400);
    }
  }

  const { error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
    .eq('user_id', targetUserId);

  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ ok: true });
}
