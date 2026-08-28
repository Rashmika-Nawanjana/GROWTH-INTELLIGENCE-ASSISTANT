import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  generateInviteToken,
  hashInviteToken,
  inviteUrl,
} from '@/lib/teams/invite-token';
import type { InviteRole } from '@/lib/teams/types';

export const runtime = 'nodejs';

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const { id: teamId } = await ctx.params;
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

  const { data, error } = await supabase
    .from('team_invites')
    .select('id, email, role, expires_at, created_at, accepted_at, revoked_at')
    .eq('team_id', teamId)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) return jsonError(error.message, 500);

  return NextResponse.json({
    ok: true,
    invites: (data ?? []).map(row => ({
      id: row.id,
      email: row.email,
      role: row.role,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    })),
  });
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { id: teamId } = await ctx.params;
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

  let body: { email?: string; role?: InviteRole };
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  const role = body.role ?? 'editor';
  if (!email || !email.includes('@')) return jsonError('Valid email is required', 400);
  if (role !== 'editor' && role !== 'viewer') return jsonError('role must be editor or viewer', 400);

  const token = generateInviteToken();
  const tokenHash = hashInviteToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('team_invites')
    .insert({
      team_id: teamId,
      email,
      role,
      token_hash: tokenHash,
      invited_by: user.id,
      expires_at: expiresAt,
    })
    .select('id, email, role, expires_at')
    .single();

  if (error) return jsonError(error.message, 500);

  const origin = req.headers.get('origin') ?? undefined;

  return NextResponse.json({
    ok: true,
    invite: {
      id: data.id,
      email: data.email,
      role: data.role,
      expiresAt: data.expires_at,
      url: inviteUrl(token, origin),
    },
  });
}
