-- Run this in your Supabase project SQL editor after 001_chat_sessions.sql
-- Dashboard → SQL Editor → New query → paste → Run

-- ── pgvector extension ────────────────────────────────────────────────────────
create extension if not exists vector;

-- ── Embeddings table ──────────────────────────────────────────────────────────
-- One row per chat message. Embeddings are session-scoped — recall NEVER crosses
-- session boundaries. This is the fix for the cross-chat context bleed.

create table if not exists chat_embeddings (
  id          uuid default gen_random_uuid() primary key,
  session_id  uuid references chat_sessions on delete cascade not null,
  message_id  uuid references chat_messages on delete cascade,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  embedding   vector(768) not null,  -- gemini text-embedding-004 → 768 dims
  created_at  timestamptz default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
create index if not exists chat_embeddings_session_id_idx on chat_embeddings(session_id);

-- ivfflat index for fast cosine similarity search
-- lists=100 is a reasonable default for small-to-medium tables
create index if not exists chat_embeddings_embedding_idx
  on chat_embeddings
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table chat_embeddings enable row level security;

create policy "Users own their embeddings"
  on chat_embeddings for all
  using (
    session_id in (select id from chat_sessions where user_id = auth.uid())
  )
  with check (
    session_id in (select id from chat_sessions where user_id = auth.uid())
  );

-- ── Recall function ───────────────────────────────────────────────────────────
-- Returns top-K semantically similar messages from a SINGLE session only.
-- Cross-session leakage is prevented by the session_id filter.

create or replace function match_chat_embeddings(
  p_session_id uuid,
  p_query_embedding vector(768),
  p_match_count int default 5
)
returns table (
  id uuid,
  message_id uuid,
  role text,
  content text,
  similarity float,
  created_at timestamptz
)
language sql stable
as $$
  select
    e.id,
    e.message_id,
    e.role,
    e.content,
    1 - (e.embedding <=> p_query_embedding) as similarity,
    e.created_at
  from chat_embeddings e
  where e.session_id = p_session_id
  order by e.embedding <=> p_query_embedding
  limit p_match_count;
$$;
