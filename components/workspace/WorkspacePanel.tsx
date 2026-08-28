'use client';

import React, { useEffect, useState } from 'react';
import { Bookmark, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useTheme } from '@/lib/theme-provider';
import {
  createWorkspace,
  deleteWorkspace,
  ensureDefaultWorkspace,
  listWorkspaceItems,
  listWorkspaces,
  nextWorkspaceName,
  renameWorkspace,
  type Workspace,
  type WorkspaceItem,
} from '@/lib/workspace';
import { WorkspaceCard } from '@/components/workspace/WorkspaceCard';

const ACTIVE_KEY = 'veracity-active-workspace';

export function WorkspacePanel() {
  const { surface, border, text, textMuted, textSubtle, isDark } = useTheme();
  const [boards, setBoards] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [confirmDeleteBoard, setConfirmDeleteBoard] = useState(false);

  const active = boards.find(b => b.id === activeId) ?? boards[0] ?? null;

  async function loadBoards(preferId?: string | null) {
    setLoading(true);
    setError(null);
    try {
      let list = await listWorkspaces();
      if (list.length === 0) {
        const created = await ensureDefaultWorkspace();
        list = created ? [created] : [];
      }
      setBoards(list);

      const stored = typeof window !== 'undefined' ? localStorage.getItem(ACTIVE_KEY) : null;
      const nextId =
        (preferId && list.some(b => b.id === preferId) ? preferId : null)
        ?? (stored && list.some(b => b.id === stored) ? stored : null)
        ?? list[0]?.id
        ?? null;

      setActiveId(nextId);
      if (nextId) {
        localStorage.setItem(ACTIVE_KEY, nextId);
        const data = await listWorkspaceItems(nextId);
        setItems(data);
      } else {
        setItems([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace');
    } finally {
      setLoading(false);
    }
  }

  async function selectBoard(id: string) {
    setActiveId(id);
    localStorage.setItem(ACTIVE_KEY, id);
    setConfirmDeleteBoard(false);
    setRenaming(false);
    setLoading(true);
    try {
      const data = await listWorkspaceItems(id);
      setItems(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBoards();
  }, []);

  useEffect(() => {
    if (active) setNameDraft(active.name);
  }, [active?.id, active?.name]);

  async function handleCreateBoard() {
    if (creating) return;
    setCreating(true);
    try {
      const name = await nextWorkspaceName();
      const board = await createWorkspace(name);
      if (!board) return;
      setBoards(prev => [...prev, board]);
      await selectBoard(board.id);
      setRenaming(true);
    } finally {
      setCreating(false);
    }
  }

  async function handleRename() {
    if (!active) return;
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === active.name) {
      setRenaming(false);
      setNameDraft(active.name);
      return;
    }
    await renameWorkspace(active.id, trimmed);
    setBoards(prev => prev.map(b => (b.id === active.id ? { ...b, name: trimmed } : b)));
    setRenaming(false);
  }

  async function handleDeleteBoard() {
    if (!active) return;
    const id = active.id;
    await deleteWorkspace(id);
    setConfirmDeleteBoard(false);
    const remaining = boards.filter(b => b.id !== id);
    setBoards(remaining);
    if (remaining.length === 0) {
      await loadBoards();
    } else {
      await selectBoard(remaining[0].id);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bookmark size={16} style={{ color: '#0052FF' }} />
            <h2 className="text-lg font-semibold tracking-tight" style={{ color: text }}>
              Workspace
            </h2>
          </div>
          <p className="text-[13px]" style={{ color: textMuted }}>
            Organize pinned artifacts into named workspaces. Switch chart views and ask AI to explain them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCreateBoard}
            disabled={creating}
            className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg text-white bg-gradient-signature disabled:opacity-50"
          >
            <Plus size={12} />
            {creating ? 'Creating…' : 'New workspace'}
          </button>
          <button
            type="button"
            onClick={() => loadBoards(activeId)}
            className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider px-3 py-1.5 rounded-lg"
            style={{
              color: textMuted,
              border: `1px solid ${border}`,
              background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            }}
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Board tabs */}
      {boards.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {boards.map(board => {
              const selected = board.id === active?.id;
              return (
                <button
                  key={board.id}
                  type="button"
                  onClick={() => selectBoard(board.id)}
                  className="text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors"
                  style={{
                    color: selected ? '#0052FF' : textMuted,
                    background: selected
                      ? (isDark ? 'rgba(0,82,255,0.12)' : 'rgba(0,82,255,0.08)')
                      : 'transparent',
                    border: selected ? '1px solid rgba(0,82,255,0.25)' : `1px solid ${border}`,
                  }}
                >
                  {board.name}
                </button>
              );
            })}
          </div>

          {active && (
            <div className="flex items-center gap-2 flex-wrap">
              {renaming ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={e => setNameDraft(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={e => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      setRenaming(false);
                      setNameDraft(active.name);
                    }
                  }}
                  className="text-[14px] font-semibold px-2 py-1 rounded-lg outline-none min-w-[160px]"
                  style={{ background: surface, border: `1px solid ${border}`, color: text }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setRenaming(true)}
                  className="text-[14px] font-semibold"
                  style={{ color: text }}
                  title="Rename workspace"
                >
                  {active.name}
                </button>
              )}

              {confirmDeleteBoard ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleDeleteBoard}
                    className="text-[10px] font-mono uppercase px-2 py-1 rounded"
                    style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
                  >
                    Delete board
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteBoard(false)}
                    className="text-[10px] font-mono uppercase px-2 py-1 rounded"
                    style={{ color: textMuted, border: `1px solid ${border}` }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteBoard(true)}
                  className="p-1.5 rounded-lg"
                  style={{ color: textMuted }}
                  title="Delete this workspace"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {loading && items.length === 0 && (
        <div className="flex items-center justify-center gap-2 py-20" style={{ color: textMuted }}>
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm font-mono">Loading workspace…</span>
        </div>
      )}

      {error && (
        <div
          className="rounded-xl p-4 text-sm"
          style={{ border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', background: surface }}
        >
          {error}
          <span className="block mt-1 text-[12px]" style={{ color: textSubtle }}>
            If this is a fresh setup, run supabase/migrations/005_workspace.sql and 006_workspace_boards.sql in the Supabase SQL editor.
          </span>
        </div>
      )}

      {!loading && !error && active && items.length === 0 && (
        <div
          className="flex flex-col items-center justify-center text-center gap-3 py-20 rounded-xl"
          style={{ border: `1px dashed ${border}`, background: surface }}
        >
          <Bookmark size={28} style={{ color: textSubtle }} />
          <p className="text-[15px] font-semibold" style={{ color: text }}>
            {active.name} is empty
          </p>
          <p className="text-[13px] max-w-md" style={{ color: textMuted }}>
            Open the Intelligence tab, expand an artifact, and choose{' '}
            <span className="font-mono" style={{ color: '#0052FF' }}>Add to workspace</span>
            {' '}→ {active.name}.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))' }}
        >
          {items.map(item => (
            <WorkspaceCard
              key={item.id}
              item={item}
              onChange={next => setItems(prev => prev.map(i => (i.id === next.id ? next : i)))}
              onDelete={id => setItems(prev => prev.filter(i => i.id !== id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
