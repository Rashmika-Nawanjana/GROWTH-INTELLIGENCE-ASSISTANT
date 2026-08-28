-- Run after 007_evidence_rag.sql
-- Workspace artifact RAG: semantic chunks for pinned artifacts + board-wide search

create table if not exists workspace_artifact_chunks (
  id                uuid default gen_random_uuid() primary key,
  user_id           uuid references auth.users not null,
  workspace_item_id uuid references workspace_items on delete cascade not null,
  workspace_id      uuid references workspaces on delete cascade,
  section           text not null check (section in ('facts', 'interpretation', 'domain', 'notes', 'sources', 'evidence')),
  chunk_index       int not null,
  content           text not null,
  content_hash      text not null,
  embedding         vector(768) not null,
  created_at        timestamptz default now()
);

create index if not exists workspace_artifact_chunks_user_item_idx
  on workspace_artifact_chunks (user_id, workspace_item_id);

create index if not exists workspace_artifact_chunks_user_workspace_idx
  on workspace_artifact_chunks (user_id, workspace_id);

create index if not exists workspace_artifact_chunks_item_id_idx
  on workspace_artifact_chunks (workspace_item_id);

-- HNSW preferred; use ivfflat if your Supabase tier lacks HNSW support
create index if not exists workspace_artifact_chunks_embedding_idx
  on workspace_artifact_chunks
  using hnsw (embedding vector_cosine_ops);

alter table workspace_artifact_chunks enable row level security;

create policy "Users own their workspace artifact chunks"
  on workspace_artifact_chunks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function match_workspace_chunks(
  p_user_id uuid,
  p_query_embedding vector(768),
  p_match_count int default 8,
  p_workspace_item_id uuid default null,
  p_workspace_id uuid default null,
  p_product text default null
)
returns table (
  id uuid,
  workspace_item_id uuid,
  section text,
  chunk_index int,
  content text,
  similarity float,
  item_title text,
  artifact_type text
)
language sql stable
as $$
  select
    c.id,
    c.workspace_item_id,
    c.section,
    c.chunk_index,
    c.content,
    1 - (c.embedding <=> p_query_embedding) as similarity,
    i.title as item_title,
    i.artifact_type
  from workspace_artifact_chunks c
  join workspace_items i on i.id = c.workspace_item_id
  where c.user_id = p_user_id
    and (p_workspace_item_id is null or c.workspace_item_id = p_workspace_item_id)
    and (p_workspace_id is null or c.workspace_id = p_workspace_id)
    and (p_product is null or p_product = '' or i.product ilike '%' || p_product || '%')
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 20));
$$;
