'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Check, ChevronDown, Loader2, Plus } from 'lucide-react';
import { useTheme } from '@/lib/theme-provider';
import type { AgentOutput } from '@/lib/agents/types';
import {
  addToWorkspace,
  createWorkspace,
  listWorkspaces,
  nextWorkspaceName,
  workspaceItemKey,
  type Workspace,
} from '@/lib/workspace';

interface Props {
  output: AgentOutput;
  product: string;
  competitor?: string | null;
  title: string;
  sessionId?: string | null;
  messageId?: string | null;
  savedKeys: Set<string>;
  onSaved: (key: string) => void;
}

export function AddToWorkspaceButton({
  output,
  product,
  competitor,
  title,
  sessionId,
  messageId,
  savedKeys,
  onSaved,
}: Props) {
  const { isDark, surface, border, text, textMuted, textSubtle } = useTheme();
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState<Workspace[]>([]);
  const [loadingBoards, setLoadingBoards] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [lastSavedName, setLastSavedName] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const anySaved = Array.from(savedKeys).some(k =>
    k.startsWith(`${sessionId ?? ''}:${messageId ?? ''}:${output.artifactType}:`),
  );

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowCreate(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  async function openMenu() {
    setOpen(o => !o);
    if (open) return;
    setLoadingBoards(true);
    setShowCreate(false);
    try {
      const list = await listWorkspaces();
      setBoards(list);
      if (list.length === 0) {
        const suggested = await nextWorkspaceName();
        setNewName(suggested);
        setShowCreate(true);
      }
    } finally {
      setLoadingBoards(false);
    }
  }

  async function saveTo(board: Workspace) {
    const key = workspaceItemKey(sessionId, messageId, output.artifactType, board.id);
    if (savedKeys.has(key) || savingId) return;
    setSavingId(board.id);
    try {
      const item = await addToWorkspace({
        workspaceId: board.id,
        title,
        artifactType: output.artifactType,
        product,
        competitor,
        payload: output,
        sourceSessionId: sessionId,
        sourceMessageId: messageId,
      });
      if (item) {
        onSaved(key);
        setLastSavedName(board.name);
        setOpen(false);
        setShowCreate(false);
      }
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const name = newName.trim() || (await nextWorkspaceName());
      const board = await createWorkspace(name);
      if (!board) return;
      setBoards(prev => [...prev, board]);
      await saveTo(board);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={openMenu}
        className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2.5 py-1.5 rounded-lg transition-colors"
        style={{
          color: anySaved ? '#10b981' : textMuted,
          background: anySaved
            ? (isDark ? 'rgba(16,185,129,0.1)' : 'rgba(16,185,129,0.08)')
            : (isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'),
          border: `1px solid ${anySaved ? 'rgba(16,185,129,0.3)' : border}`,
        }}
        title={lastSavedName ? `Saved to ${lastSavedName}` : 'Add to a workspace'}
      >
        {anySaved ? <Check size={11} /> : <BookmarkPlus size={11} />}
        {anySaved ? (lastSavedName ? `In ${lastSavedName}` : 'In workspace') : 'Add to workspace'}
        <ChevronDown size={10} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-xl shadow-lg overflow-hidden"
          style={{ background: surface, border: `1px solid ${border}` }}
        >
          <div className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider" style={{ color: textSubtle, borderBottom: `1px solid ${border}` }}>
            Save to…
          </div>

          {loadingBoards ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[12px]" style={{ color: textMuted }}>
              <Loader2 size={12} className="animate-spin" /> Loading…
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto py-1">
              {boards.map(board => {
                const key = workspaceItemKey(sessionId, messageId, output.artifactType, board.id);
                const already = savedKeys.has(key);
                const busy = savingId === board.id;
                return (
                  <button
                    key={board.id}
                    type="button"
                    disabled={already || !!savingId}
                    onClick={() => saveTo(board)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left text-[12.5px] transition-colors disabled:opacity-60"
                    style={{ color: text }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
                  >
                    <span className="truncate">{board.name}</span>
                    {busy ? (
                      <Loader2 size={12} className="animate-spin shrink-0" style={{ color: textMuted }} />
                    ) : already ? (
                      <Check size={12} className="shrink-0" style={{ color: '#10b981' }} />
                    ) : null}
                  </button>
                );
              })}
              {boards.length === 0 && !showCreate && (
                <p className="px-3 py-2 text-[12px]" style={{ color: textMuted }}>No workspaces yet</p>
              )}
            </div>
          )}

          <div style={{ borderTop: `1px solid ${border}` }} className="p-2">
            {showCreate ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={e => {
                  e.preventDefault();
                  handleCreate();
                }}
              >
                <input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="Workspace name"
                  className="w-full text-[12.5px] px-2.5 py-1.5 rounded-lg outline-none"
                  style={{ background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)', border: `1px solid ${border}`, color: text }}
                />
                <div className="flex gap-1.5">
                  <button
                    type="submit"
                    disabled={creating}
                    className="flex-1 text-[10px] font-mono uppercase tracking-wider py-1.5 rounded-lg text-white bg-gradient-signature disabled:opacity-50"
                  >
                    {creating ? 'Creating…' : 'Create & save'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="text-[10px] font-mono uppercase px-2 py-1.5 rounded-lg"
                    style={{ color: textMuted, border: `1px solid ${border}` }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <button
                type="button"
                onClick={async () => {
                  setNewName(await nextWorkspaceName());
                  setShowCreate(true);
                }}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[12px] font-medium"
                style={{ color: '#0052FF' }}
              >
                <Plus size={13} /> Create new workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
