import type { SupabaseClient } from '@supabase/supabase-js';

export type WorkspaceAccessRole = 'owner' | 'editor' | 'viewer' | null;

export async function getWorkspaceAccessRole(
  supabase: SupabaseClient,
  workspaceId: string | null,
): Promise<WorkspaceAccessRole> {
  if (!workspaceId) return null;
  const { data, error } = await supabase.rpc('workspace_access_role', {
    p_workspace_id: workspaceId,
  });
  if (error) {
    console.error('workspace_access_role:', error.message);
    return null;
  }
  const role = data as string | null;
  if (role === 'owner' || role === 'editor' || role === 'viewer') return role;
  return null;
}

export function canWriteWorkspaceRole(role: WorkspaceAccessRole): boolean {
  return role === 'owner' || role === 'editor';
}
