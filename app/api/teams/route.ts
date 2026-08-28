import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import type { TeamRole, TeamSummary } from '@/lib/teams/types';

export const runtime = 'nodejs';

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return jsonError('Not authenticated', 401);

  const { data: memberships, error: memErr } = await supabase
    .from('team_members')
    .select('team_id, role, created_at')
    .eq('user_id', user.id);

  if (memErr) return jsonError(memErr.message, 500);
  if (!memberships?.length) {
    return NextResponse.json({ ok: true, teams: [] as TeamSummary[] });
  }

  const teamIds = memberships.map(m => m.team_id as string);
  const roleByTeam = new Map(memberships.map(m => [m.team_id as string, m.role as TeamRole]));

  const { data: teams, error: teamErr } = await supabase
    .from('teams')
    .select('id, name, created_at')
    .in('id', teamIds);

  if (teamErr) return jsonError(teamErr.message, 500);

  const { data: boards } = await supabase
    .from('workspaces')
    .select('id, team_id')
    .in('team_id', teamIds);

  const boardByTeam = new Map((boards ?? []).map(b => [b.team_id as string, b.id as string]));

  const { data: allMembers } = await supabase
    .from('team_members')
    .select('id, team_id, user_id, role, created_at')
    .in('team_id', teamIds);

  const userIds = [...new Set((allMembers ?? []).map(m => m.user_id as string))];
  const emailByUser = new Map<string, string | null>();

  if (userIds.length > 0) {
    const { data: profiles } = await supabase.rpc('get_user_emails_for_teams', { p_user_ids: userIds });
    if (profiles && Array.isArray(profiles)) {
      for (const row of profiles as { user_id: string; email: string }[]) {
        emailByUser.set(row.user_id, row.email);
      }
    }
  }

  const summaries: TeamSummary[] = (teams ?? []).map(t => {
    const tid = t.id as string;
    const members = (allMembers ?? [])
      .filter(m => m.team_id === tid)
      .map(m => ({
        id: m.id as string,
        userId: m.user_id as string,
        email: emailByUser.get(m.user_id as string) ?? null,
        role: m.role as TeamRole,
        createdAt: m.created_at as string,
      }));

    return {
      id: tid,
      name: t.name as string,
      createdAt: t.created_at as string,
      workspaceId: boardByTeam.get(tid) ?? null,
      myRole: roleByTeam.get(tid) ?? 'viewer',
      members,
    };
  });

  return NextResponse.json({ ok: true, teams: summaries });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return jsonError('Not authenticated', 401);

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const name = (body.name ?? '').trim();
  if (!name) return jsonError('name is required', 400);

  const { data, error } = await supabase.rpc('create_team_with_board', { p_name: name });
  if (error) return jsonError(error.message, 500);

  const result = data as { teamId: string; workspaceId: string; name: string };

  return NextResponse.json({
    ok: true,
    teamId: result.teamId,
    workspaceId: result.workspaceId,
    name: result.name,
  });
}
