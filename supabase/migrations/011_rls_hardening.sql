-- RLS hardening: signal_cache, legacy conversations, vector RPC auth checks (011)

-- ── signal_cache: revoke world-writable policies ─────────────────────────────
DROP POLICY IF EXISTS "Anyone can read signal_cache" ON signal_cache;
DROP POLICY IF EXISTS "Anyone can insert signal_cache" ON signal_cache;
DROP POLICY IF EXISTS "Anyone can update signal_cache" ON signal_cache;

-- Ensure RLS is on; no policies for anon/authenticated → denied for those roles.
-- Service-role client (lib/supabase-admin.ts) bypasses RLS for tool cache.
ALTER TABLE signal_cache ENABLE ROW LEVEL SECURITY;

-- ── legacy conversations: lock to owner-like session ownership ───────────────
-- Prefer deny-all for authenticated if table is unused; keep minimal policy
-- that requires authentication but does not allow cross-user reads via
-- restricting to rows where session_id is null (effectively empty) OR
-- simply revoke broad ALL and add no select for authenticated.
DROP POLICY IF EXISTS "Authenticated users can manage conversations" ON conversations;

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated/anon → only service role can access.
-- Application code uses chat_sessions / chat_messages instead.

-- ── vector RPCs: assert p_user_id = auth.uid() ───────────────────────────────
CREATE OR REPLACE FUNCTION match_evidence_chunks(
  p_user_id uuid,
  p_query_embedding vector(768),
  p_match_count int default 8,
  p_product text default null,
  p_domain text default null,
  p_max_age_days int default 30
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  kind text,
  chunk_index int,
  content text,
  similarity float,
  url text,
  title text,
  source_tool text,
  domain text,
  product text,
  fetched_at timestamptz,
  age_days int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    c.id,
    c.document_id,
    c.kind,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> p_query_embedding) AS similarity,
    d.url,
    d.title,
    d.source_tool,
    d.domain,
    d.product,
    d.fetched_at,
    greatest(0, (extract(epoch from (now() - d.fetched_at)) / 86400)::int) AS age_days
  FROM evidence_chunks c
  JOIN evidence_documents d ON d.id = c.document_id
  WHERE c.user_id = p_user_id
    AND p_user_id = auth.uid()
    AND d.fetched_at >= now() - make_interval(days => greatest(1, p_max_age_days))
    AND (p_product IS NULL OR p_product = '' OR d.product ILIKE '%' || p_product || '%')
    AND (p_domain IS NULL OR p_domain = '' OR d.domain = p_domain)
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT greatest(1, least(p_match_count, 20));
$$;

CREATE OR REPLACE FUNCTION match_workspace_chunks(
  p_user_id uuid,
  p_query_embedding vector(768),
  p_match_count int default 8,
  p_workspace_item_id uuid default null,
  p_workspace_id uuid default null,
  p_product text default null
)
RETURNS TABLE (
  id uuid,
  workspace_item_id uuid,
  section text,
  chunk_index int,
  content text,
  similarity float,
  item_title text,
  artifact_type text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    c.id,
    c.workspace_item_id,
    c.section,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> p_query_embedding) AS similarity,
    i.title AS item_title,
    i.artifact_type
  FROM workspace_artifact_chunks c
  JOIN workspace_items i ON i.id = c.workspace_item_id
  WHERE c.user_id = p_user_id
    AND p_user_id = auth.uid()
    AND (p_workspace_item_id IS NULL OR c.workspace_item_id = p_workspace_item_id)
    AND (p_workspace_id IS NULL OR c.workspace_id = p_workspace_id)
    AND (p_product IS NULL OR p_product = '' OR i.product ILIKE '%' || p_product || '%')
  ORDER BY c.embedding <=> p_query_embedding
  LIMIT greatest(1, least(p_match_count, 20));
$$;
