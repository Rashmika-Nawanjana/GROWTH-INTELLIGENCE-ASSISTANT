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

-- Enable Row Level Security (open for hackathon)
alter table signal_cache enable row level security;
alter table conversations enable row level security;

-- Allow all operations (tighten post-hackathon)
create policy "Allow all on signal_cache" on signal_cache for all using (true) with check (true);
create policy "Allow all on conversations" on conversations for all using (true) with check (true);
