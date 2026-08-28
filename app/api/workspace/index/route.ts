import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import type { AgentOutput } from '@/lib/agents/types';
import {
  countWorkspaceChunks,
  indexWorkspaceArtifact,
} from '@/lib/workspace/index-artifact';
import { isWorkspaceRagEnabled } from '@/lib/workspace/rag-config';
import { canWriteWorkspaceRole, getWorkspaceAccessRole } from '@/lib/workspace/access';

export const runtime = 'nodejs';
export const maxDuration = 60;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST(req: NextRequest) {
  if (!isWorkspaceRagEnabled()) {
    return new Response(JSON.stringify({ indexed: false, chunkCount: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonError('Not authenticated', 401);
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const { workspaceIndexBodySchema, formatZodError } = await import('@/lib/validation/schemas');
  const parsed = workspaceIndexBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(formatZodError(parsed.error), 400);
  }

  const itemId = parsed.data.itemId;

  const { data: item, error: itemError } = await supabase
    .from('workspace_items')
    .select('*')
    .eq('id', itemId)
    .single();

  if (itemError || !item) {
    return jsonError('Workspace item not found', 404);
  }

  const workspaceId = item.workspace_id as string | null;
  const accessRole = await getWorkspaceAccessRole(supabase, workspaceId);
  if (!accessRole) {
    return jsonError('Workspace item not found', 404);
  }
  if (!canWriteWorkspaceRole(accessRole)) {
    return jsonError('View-only access — cannot index this artifact', 403);
  }

  const result = await indexWorkspaceArtifact(supabase, {
    userId: user.id,
    workspaceItemId: item.id,
    workspaceId: item.workspace_id as string | null,
    title: String(item.title),
    artifactType: String(item.artifact_type),
    product: String(item.product ?? ''),
    payload: item.payload as AgentOutput,
    notes: item.notes as string | null,
  });

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return jsonError('Not authenticated', 401);
  }

  const itemId = req.nextUrl.searchParams.get('itemId')?.trim();
  if (!itemId) return jsonError('itemId is required', 400);

  const count = await countWorkspaceChunks(supabase, itemId);
  return new Response(JSON.stringify({ chunkCount: count }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
