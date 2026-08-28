'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  Copy,
  Loader2,
  Plus,
  RefreshCw,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useTheme } from '@/lib/theme-provider';
import { WorkspaceCard } from '@/components/workspace/WorkspaceCard';
import { listWorkspaceItems } from '@/lib/workspace';
import type { WorkspaceItem } from '@/lib/workspace';
import {
  createTeam,
  createTeamInvite,
  fetchTeams,
  removeMember,
  revokeTeamInvite,
  updateMemberRole,
} from '@/lib/teams';
import type { InviteRole, TeamRole, TeamSummary } from '@/lib/teams/types';

const ACTIVE_TEAM_KEY = 'veracity-active-team';

export function SharedWorkspacePanel() {
  const { surface, border, text, textMuted, textSubtle } = useTheme();
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [teamName, setTeamName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('editor');
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const activeTeam = teams.find(t => t.id === activeTeamId) ?? teams[0] ?? null;
  const readOnly = activeTeam?.myRole === 'viewer';
  const isOwner = activeTeam?.myRole === 'owner';

  const loadTeams = useCallback(async (preferTeamId?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchTeams();
      setTeams(list);
      const stored = typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_TEAM_KEY) : null;
      const nextId =
        (preferTeamId && list.some(t => t.id === preferTeamId) ? preferTeamId : null)
        ?? (stored && list.some(t => t.id === stored) ? stored : null)
        ?? list[0]?.id
        ?? null;
      setActiveTeamId(nextId);
      if (nextId) {
        localStorage.setItem(ACTIVE_TEAM_KEY, nextId);
        const team = list.find(t => t.id === nextId);
        if (team?.workspaceId) {
          const data = await listWorkspaceItems(team.workspaceId);
          setItems(data);
        } else {
          setItems([]);
        }
      } else {
        setItems([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  async function selectTeam(id: string) {
    setActiveTeamId(id);
    localStorage.setItem(ACTIVE_TEAM_KEY, id);
    setShowMembers(false);
    setShowInvite(false);
    setLoading(true);
    try {
      const team = teams.find(t => t.id === id);
      if (team?.workspaceId) {
        setItems(await listWorkspaceItems(team.workspaceId));
      } else {
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateTeam() {
    const name = teamName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createTeam(name);
      await loadTeams(result.teamId);
      setShowCreate(false);
      setTeamName('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create team');
    } finally {
      setCreating(false);
    }
  }

  async function handleInvite() {
    if (!activeTeam || !inviteEmail.trim()) return;
    setInviteLoading(true);
    setError(null);
    setInviteUrl(null);
    try {
      const invite = await createTeamInvite(activeTeam.id, inviteEmail.trim(), inviteRole);
      setInviteUrl(invite.url);
      await loadTeams(activeTeam.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create invite');
    } finally {
      setInviteLoading(false);
    }
  }

  async function copyInviteUrl() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading && teams.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
        <Loader2 size={18} className="animate-spin" />
        <span className="text-sm font-mono">Loading shared workspace…</span>
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <div className="max-w-lg mx-auto py-16 px-4">
        <div className="veracity-card p-8 flex flex-col gap-4 text-center">
          <Users size={32} className="mx-auto text-accent" />
          <h2 className="font-serif text-xl font-semibold" style={{ color: text }}>
            Shared workspace
          </h2>
          <p className="text-sm text-muted-foreground">
            Create a team to collaborate on artifacts, notes, and AI threads with your colleagues.
          </p>
          {showCreate ? (
            <div className="flex flex-col gap-3 mt-2">
              <input
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
                placeholder="Team name (e.g. Growth Squad)"
                className="w-full h-11 px-4 bg-muted border border-border rounded-xl text-sm outline-none focus:ring-2 focus:ring-accent/20"
              />
              <div className="flex gap-2 justify-center">
                <button
                  type="button"
                  onClick={() => { setShowCreate(false); setTeamName(''); }}
                  className="px-4 py-2 text-sm rounded-xl border border-border"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={creating || !teamName.trim()}
                  onClick={() => void handleCreateTeam()}
                  className="px-4 py-2 text-sm rounded-xl bg-gradient-signature text-white disabled:opacity-50"
                >
                  {creating ? 'Creating…' : 'Create team'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="mt-2 mx-auto flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-signature text-white text-sm font-medium"
            >
              <Plus size={16} /> Create team
            </button>
          )}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 max-w-6xl mx-auto w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {teams.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => void selectTeam(t.id)}
              className="text-xs font-mono uppercase tracking-wider px-3 py-1.5 rounded-full transition-colors"
              style={{
                color: t.id === activeTeamId ? '#0052FF' : textMuted,
                background: t.id === activeTeamId ? 'rgba(0,82,255,0.08)' : 'transparent',
                border: `1px solid ${t.id === activeTeamId ? 'rgba(0,82,255,0.25)' : border}`,
              }}
            >
              {t.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="p-1.5 rounded-full border border-border"
            title="New team"
          >
            <Plus size={14} style={{ color: textMuted }} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {activeTeam ? (
            <span
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded"
              style={{ color: textMuted, border: `1px solid ${border}` }}
            >
              {activeTeam.myRole}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void loadTeams(activeTeamId)}
            className="p-2 rounded-lg border border-border"
            title="Refresh"
          >
            <RefreshCw size={14} style={{ color: textMuted }} />
          </button>
          {isOwner ? (
            <>
              <button
                type="button"
                onClick={() => { setShowInvite(true); setShowMembers(false); setInviteUrl(null); }}
                className="flex items-center gap-1.5 text-xs font-mono uppercase px-3 py-1.5 rounded-lg bg-gradient-signature text-white"
              >
                <UserPlus size={12} /> Invite
              </button>
              <button
                type="button"
                onClick={() => { setShowMembers(true); setShowInvite(false); }}
                className="flex items-center gap-1.5 text-xs font-mono uppercase px-3 py-1.5 rounded-lg border border-border"
                style={{ color: textMuted }}
              >
                <Users size={12} /> Members
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => { setShowMembers(true); setShowInvite(false); }}
              className="flex items-center gap-1.5 text-xs font-mono uppercase px-3 py-1.5 rounded-lg border border-border"
              style={{ color: textMuted }}
            >
              <Users size={12} /> Members
            </button>
          )}
        </div>
      </div>

      {showCreate ? (
        <div className="veracity-card p-4 flex flex-wrap items-center gap-2">
          <input
            value={teamName}
            onChange={e => setTeamName(e.target.value)}
            placeholder="New team name"
            className="flex-1 min-w-[200px] h-10 px-3 rounded-lg border border-border bg-muted text-sm"
          />
          <button type="button" onClick={() => void handleCreateTeam()} disabled={creating} className="px-4 py-2 rounded-lg bg-gradient-signature text-white text-sm">
            Create
          </button>
          <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg border border-border text-sm">
            Cancel
          </button>
        </div>
      ) : null}

      {showInvite && isOwner && activeTeam ? (
        <div className="veracity-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Invite member</span>
            <button type="button" onClick={() => setShowInvite(false)}><X size={14} /></button>
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="flex-1 min-w-[200px] h-10 px-3 rounded-lg border border-border bg-muted text-sm"
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as InviteRole)}
              className="h-10 px-3 rounded-lg border border-border bg-muted text-sm font-mono"
            >
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button
              type="button"
              disabled={inviteLoading || !inviteEmail.trim()}
              onClick={() => void handleInvite()}
              className="px-4 py-2 rounded-lg bg-gradient-signature text-white text-sm disabled:opacity-50"
            >
              {inviteLoading ? 'Generating…' : 'Generate link'}
            </button>
          </div>
          {inviteUrl ? (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted border border-border">
              <code className="text-xs flex-1 truncate font-mono">{inviteUrl}</code>
              <button type="button" onClick={() => void copyInviteUrl()} className="flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border border-border">
                <Copy size={12} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {showMembers && activeTeam ? (
        <div className="veracity-card p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              {activeTeam.members.length} member{activeTeam.members.length === 1 ? '' : 's'}
            </span>
            <button type="button" onClick={() => setShowMembers(false)}><X size={14} /></button>
          </div>
          <ul className="flex flex-col gap-2">
            {activeTeam.members.map(m => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="font-mono truncate" style={{ color: text }}>
                  {m.email ?? `${m.userId.slice(0, 8)}…`}
                </span>
                {isOwner && m.role !== 'owner' ? (
                  <div className="flex items-center gap-2">
                    <select
                      value={m.role}
                      onChange={e => void updateMemberRole(activeTeam.id, m.userId, e.target.value as TeamRole).then(() => loadTeams(activeTeam.id))}
                      className="text-[10px] font-mono px-2 py-1 rounded border border-border bg-muted"
                    >
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void removeMember(activeTeam.id, m.userId).then(() => loadTeams(activeTeam.id))}
                      className="text-[10px] font-mono text-red-600"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded border border-border" style={{ color: textMuted }}>
                    {m.role}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600 font-mono">{error}</p> : null}

      {readOnly ? (
        <p className="text-xs font-mono text-muted-foreground px-1">
          View-only access — you can read artifacts and threads but cannot edit or pin.
        </p>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : items.length === 0 ? (
        <div className="veracity-card p-12 text-center" style={{ background: surface, border: `1px solid ${border}` }}>
          <p className="text-sm text-muted-foreground">
            No artifacts pinned yet. Editors can pin findings from Intelligence using &quot;Add to workspace&quot;.
          </p>
        </div>
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))' }}
        >
          {items.map(item => (
            <WorkspaceCard
              key={item.id}
              item={item}
              readOnly={readOnly}
              onChange={updated => setItems(prev => prev.map(i => (i.id === updated.id ? updated : i)))}
              onDelete={id => setItems(prev => prev.filter(i => i.id !== id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
