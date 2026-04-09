-- Run this in Supabase SQL Editor to set up the schema

-- Signal cache: stores tool results to avoid rate limits during demo
create table if not exists signal_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null,
  tool text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(cache_key, tool)
);

-- Index for fast lookups
create index if not exists signal_cache_lookup
  on signal_cache (cache_key, tool, created_at desc);

-- Conversations: stores chat history per session
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  messages jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_session
  on conversations (session_id);

-- Enable Row Level Security
alter table signal_cache enable row level security;
alter table conversations enable row level security;

-- signal_cache: shared, non-user-specific tool result cache.
-- Contains no PII — only cached Google/Reddit/HN search results.
-- Allow reads and upserts for all roles (including anon) since the
-- cache is populated server-side by the orchestrator (which uses the
-- anon key, not a user session). Deletes are restricted.
create policy "Anyone can read signal_cache"
  on signal_cache for select
  using (true);

create policy "Anyone can insert signal_cache"
  on signal_cache for insert
  with check (true);

create policy "Anyone can update signal_cache"
  on signal_cache for update
  using (true)
  with check (true);

-- conversations: legacy table superseded by chat_sessions + chat_messages.
-- If still in use, restrict to authenticated. New code should use the
-- migration-001 tables which have proper user_id scoping.
create policy "Authenticated users can access conversations"
  on conversations for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
