import { createClient } from '@/lib/supabase-browser';
import type { AgentOutput, ArtifactType } from '@/lib/agents/types';
import type { ChartType } from '@/lib/workspace/chart-adapters';

export type WorkspaceWidth = 'half' | 'full';

export interface ViewConfig {
  chartType?: ChartType;
  width?: WorkspaceWidth;
  sortBy?: string;
}

export interface Workspace {
  id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceItem {
  id: string;
  workspace_id: string | null;
  title: string;
  artifact_type: ArtifactType;
  product: string;
  competitor: string | null;
  payload: AgentOutput;
  view_config: ViewConfig;
  notes: string | null;
  position: number;
  source_session_id: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceItemMessage {
  id: string;
  item_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface AddToWorkspaceInput {
  workspaceId: string;
  title: string;
  artifactType: ArtifactType;
  product?: string;
  competitor?: string | null;
  payload: AgentOutput;
  sourceSessionId?: string | null;
  sourceMessageId?: string | null;
  viewConfig?: ViewConfig;
}

function mapWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: row.id as string,
    name: row.name as string,
    position: (row.position as number) ?? 0,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function mapRow(row: Record<string, unknown>): WorkspaceItem {
  return {
    id: row.id as string,
    workspace_id: (row.workspace_id as string | null) ?? null,
    title: row.title as string,
    artifact_type: row.artifact_type as ArtifactType,
    product: (row.product as string) ?? '',
    competitor: (row.competitor as string | null) ?? null,
    payload: row.payload as AgentOutput,
    view_config: (row.view_config as ViewConfig) ?? {},
    notes: (row.notes as string | null) ?? null,
    position: (row.position as number) ?? 0,
    source_session_id: (row.source_session_id as string | null) ?? null,
    source_message_id: (row.source_message_id as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function workspaceItemKey(
  sessionId: string | null | undefined,
  messageId: string | null | undefined,
  artifactType: string,
  workspaceId?: string | null,
): string {
  return `${sessionId ?? ''}:${messageId ?? ''}:${artifactType}:${workspaceId ?? ''}`;
}

// ── Workspaces (boards) ───────────────────────────────────────────────────────

export async function listWorkspaces(): Promise<Workspace[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('user_id', user.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    console.error('listWorkspaces:', error.message);
    return [];
  }
  return (data ?? []).map(row => mapWorkspace(row as Record<string, unknown>));
}

export async function createWorkspace(name: string): Promise<Workspace | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const trimmed = name.trim() || 'Untitled workspace';

  const { data: existing } = await supabase
    .from('workspaces')
    .select('position')
    .eq('user_id', user.id)
    .order('position', { ascending: false })
    .limit(1);

  const nextPosition = ((existing?.[0]?.position as number | undefined) ?? -1) + 1;

  const { data, error } = await supabase
    .from('workspaces')
    .insert({
      user_id: user.id,
      name: trimmed,
      position: nextPosition,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('createWorkspace:', error.message);
    return null;
  }
  return mapWorkspace(data as Record<string, unknown>);
}

/** Ensure the user has at least one board; create "Workspace 1" if none. */
export async function ensureDefaultWorkspace(): Promise<Workspace | null> {
  const existing = await listWorkspaces();
  if (existing.length > 0) return existing[0];
  return createWorkspace('Workspace 1');
}

export async function renameWorkspace(id: string, name: string): Promise<void> {
  const supabase = createClient();
  const trimmed = name.trim();
  if (!trimmed) return;
  const { error } = await supabase
    .from('workspaces')
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error('renameWorkspace:', error.message);
}

export async function deleteWorkspace(id: string): Promise<void> {
  const supabase = createClient();
  // Items cascade via FK when workspace_id is set
  const { error } = await supabase.from('workspaces').delete().eq('id', id);
  if (error) console.error('deleteWorkspace:', error.message);
}

export async function nextWorkspaceName(): Promise<string> {
  const boards = await listWorkspaces();
  let n = boards.length + 1;
  const names = new Set(boards.map(b => b.name.toLowerCase()));
  while (names.has(`workspace ${n}`)) n += 1;
  return `Workspace ${n}`;
}

// ── Items ─────────────────────────────────────────────────────────────────────

export async function addToWorkspace(input: AddToWorkspaceInput): Promise<WorkspaceItem | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: existing } = await supabase
    .from('workspace_items')
    .select('position')
    .eq('user_id', user.id)
    .eq('workspace_id', input.workspaceId)
    .order('position', { ascending: false })
    .limit(1);

  const nextPosition = ((existing?.[0]?.position as number | undefined) ?? -1) + 1;

  const { data, error } = await supabase
    .from('workspace_items')
    .insert({
      user_id: user.id,
      workspace_id: input.workspaceId,
      title: input.title,
      artifact_type: input.artifactType,
      product: input.product ?? '',
      competitor: input.competitor ?? null,
      payload: input.payload,
      view_config: input.viewConfig ?? { chartType: 'native', width: 'half' },
      position: nextPosition,
      source_session_id: input.sourceSessionId ?? null,
      source_message_id: input.sourceMessageId ?? null,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error('addToWorkspace:', error.message);
    return null;
  }

  await supabase
    .from('workspaces')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', input.workspaceId);

  const item = mapRow(data as Record<string, unknown>);

  void fetch('/api/workspace/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId: item.id }),
  }).catch(() => {});

  return item;
}

export async function listWorkspaceItems(workspaceId?: string | null): Promise<WorkspaceItem[]> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  let query = supabase
    .from('workspace_items')
    .select('*')
    .eq('user_id', user.id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: false });

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('listWorkspaceItems:', error.message);
    return [];
  }
  return (data ?? []).map(row => mapRow(row as Record<string, unknown>));
}

/** Fire-and-forget re-index after notes or payload metadata change. */
export function requestWorkspaceIndex(itemId: string): void {
  void fetch('/api/workspace/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId }),
  }).catch(() => {});
}

export async function updateWorkspaceItem(
  id: string,
  patch: Partial<Pick<WorkspaceItem, 'title' | 'view_config' | 'notes' | 'position'>>,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('workspace_items')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) console.error('updateWorkspaceItem:', error.message);
}

export async function deleteWorkspaceItem(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('workspace_items').delete().eq('id', id);
  if (error) console.error('deleteWorkspaceItem:', error.message);
}

export async function listItemMessages(itemId: string): Promise<WorkspaceItemMessage[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('workspace_item_messages')
    .select('*')
    .eq('item_id', itemId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('listItemMessages:', error.message);
    return [];
  }
  return (data ?? []) as WorkspaceItemMessage[];
}

export async function saveItemMessage(
  itemId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<WorkspaceItemMessage | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('workspace_item_messages')
    .insert({ item_id: itemId, role, content })
    .select()
    .single();

  if (error) {
    console.error('saveItemMessage:', error.message);
    return null;
  }
  return data as WorkspaceItemMessage;
}
