export function isWorkspaceRagEnabled(): boolean {
  return process.env.WORKSPACE_RAG_ENABLED === 'true';
}

export function workspaceRagItemTopK(): number {
  const raw = parseInt(process.env.WORKSPACE_RAG_ITEM_TOP_K ?? '6', 10);
  if (!Number.isFinite(raw)) return 6;
  return Math.max(1, Math.min(raw, 12));
}

export function workspaceRagBoardTopK(): number {
  const raw = parseInt(process.env.WORKSPACE_RAG_BOARD_TOP_K ?? '4', 10);
  if (!Number.isFinite(raw)) return 4;
  return Math.max(1, Math.min(raw, 12));
}

export const WORKSPACE_RETRIEVE_TIMEOUT_MS = 1_200;
export const WORKSPACE_INDEX_CONCURRENCY = 3;
