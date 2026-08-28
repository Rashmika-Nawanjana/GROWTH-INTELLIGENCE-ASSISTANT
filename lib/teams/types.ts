export type TeamRole = 'owner' | 'editor' | 'viewer';
export type InviteRole = 'editor' | 'viewer';

export interface TeamMember {
  id: string;
  userId: string;
  email: string | null;
  role: TeamRole;
  createdAt: string;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: InviteRole;
  expiresAt: string;
  createdAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface TeamSummary {
  id: string;
  name: string;
  createdAt: string;
  workspaceId: string | null;
  myRole: TeamRole;
  members: TeamMember[];
  pendingInvites?: TeamInvite[];
}
