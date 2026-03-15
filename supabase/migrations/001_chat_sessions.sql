-- Run this in your Supabase project SQL editor
-- Dashboard → SQL Editor → New query → paste → Run

-- ── Tables ────────────────────────────────────────────────────────────────────

create table if not exists chat_sessions (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users not null,
  title       text not null default 'New Query',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists chat_messages (
  id          uuid default gen_random_uuid() primary key,
  session_id  uuid references chat_sessions on delete cascade not null,
  role        text not null check (role in ('user', 'assistant')),
  content     text not null,
  metadata    jsonb default '{}',
  created_at  timestamptz default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

create index if not exists chat_sessions_user_id_idx on chat_sessions(user_id);
create index if not exists chat_sessions_updated_at_idx on chat_sessions(updated_at desc);
create index if not exists chat_messages_session_id_idx on chat_messages(session_id);

-- ── Row Level Security ────────────────────────────────────────────────────────

alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;

create policy "Users own their sessions"
  on chat_sessions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users own their messages"
  on chat_messages for all
  using (
    session_id in (select id from chat_sessions where user_id = auth.uid())
  )
  with check (
    session_id in (select id from chat_sessions where user_id = auth.uid())
  );

-- ── User Memory ───────────────────────────────────────────────────────────────
-- One row per user. Stores extracted facts about who they are and what they
-- research, built up across all sessions automatically.

create table if not exists user_memory (
  id           uuid default gen_random_uuid() primary key,
  user_id      uuid references auth.users not null unique,
  -- Structured fields updated by the memory extractor
  role         text,                        -- e.g. "Product Manager at Vector Agents"
  company      text,                        -- e.g. "Vector Agents"
  products     text[]  default '{}',        -- products they analyse regularly
  competitors  text[]  default '{}',        -- competitors they track
  interests    text[]  default '{}',        -- domains they focus on
  facts        jsonb   default '[]',        -- array of { fact, source_session, created_at }
  raw_summary  text,                        -- plain-English summary of who this user is
  updated_at   timestamptz default now()
);

create index if not exists user_memory_user_id_idx on user_memory(user_id);

alter table user_memory enable row level security;

create policy "Users own their memory"
  on user_memory for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
