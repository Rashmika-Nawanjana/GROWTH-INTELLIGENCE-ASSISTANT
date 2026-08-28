import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return jsonError('Not authenticated', 401);

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const token = (body.token ?? '').trim();
  if (!token) return jsonError('token is required', 400);

  const { data, error } = await supabase.rpc('accept_team_invite', { p_token: token });

  if (error) {
    const msg = error.message ?? 'Accept failed';
    if (msg.startsWith('EMAIL_MISMATCH:')) {
      const invitedEmail = msg.replace('EMAIL_MISMATCH:', '');
      return jsonError(
        `This invite was sent to ${invitedEmail}. You are signed in as ${user.email ?? 'another account'}.`,
        403,
        'EMAIL_MISMATCH',
      );
    }
    return jsonError(msg, 400);
  }

  const result = data as { teamId: string; role: string };

  const { data: board } = await supabase
    .from('workspaces')
    .select('id')
    .eq('team_id', result.teamId)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    teamId: result.teamId,
    workspaceId: board?.id ?? null,
    role: result.role,
  });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')?.trim();
  if (!token) return jsonError('token is required', 400);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('peek_team_invite', { p_token: token });

  if (error) return jsonError(error.message, 500);
  if (!data) return jsonError('Invite not found or expired', 404);

  return NextResponse.json({ ok: true, invite: data });
}
