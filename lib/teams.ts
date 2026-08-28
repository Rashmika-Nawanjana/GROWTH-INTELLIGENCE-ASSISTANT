'use client';

import type { TeamRole, TeamSummary, InviteRole } from '@/lib/teams/types';

export async function fetchTeams(): Promise<TeamSummary[]> {
  const res = await fetch('/api/teams');
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Failed to load teams');
  return data.teams as TeamSummary[];
}

export async function createTeam(name: string): Promise<{
  teamId: string;
  workspaceId: string;
  name: string;
}> {
  const res = await fetch('/api/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Failed to create team');
  return { teamId: data.teamId, workspaceId: data.workspaceId, name: data.name };
}

export async function createTeamInvite(
  teamId: string,
  email: string,
  role: InviteRole,
): Promise<{ url: string; email: string; role: InviteRole; expiresAt: string }> {
  const res = await fetch(`/api/teams/${teamId}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, role }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Failed to create invite');
  return data.invite;
}

export async function revokeTeamInvite(teamId: string, inviteId: string): Promise<void> {
  const res = await fetch(`/api/teams/${teamId}/invites/${inviteId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Failed to revoke invite');
}

export async function updateMemberRole(
  teamId: string,
  userId: string,
  role: TeamRole,
): Promise<void> {
  const res = await fetch(`/api/teams/${teamId}/members/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Failed to update role');
}

export async function removeMember(teamId: string, userId: string): Promise<void> {
  const res = await fetch(`/api/teams/${teamId}/members/${userId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Failed to remove member');
}

export async function acceptInvite(token: string): Promise<{
  teamId: string;
  workspaceId: string | null;
  role: string;
}> {
  const res = await fetch('/api/invites/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    const err = new Error(data.error ?? 'Failed to accept invite') as Error & { code?: string };
    err.code = data.code;
    throw err;
  }
  return {
    teamId: data.teamId,
    workspaceId: data.workspaceId,
    role: data.role,
  };
}

export async function peekInvite(token: string): Promise<{
  teamId: string;
  teamName: string;
  email: string;
  role: string;
  expiresAt: string;
}> {
  const res = await fetch(`/api/invites/accept?token=${encodeURIComponent(token)}`);
  const data = await res.json();
  if (!res.ok || !data.ok) throw new Error(data.error ?? 'Invite not found');
  return data.invite;
}
