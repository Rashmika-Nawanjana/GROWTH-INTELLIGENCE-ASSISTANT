-- Run this in your Supabase project SQL editor
-- Dashboard → SQL Editor → New query → paste → Run
-- Personal Artifact Workspace: pinned artifacts + per-item AI threads

-- ── Tables ────────────────────────────────────────────────────────────────────

create table if not exists workspace_items (
  id                uuid default gen_random_uuid() primary key,
  user_id           uuid references auth.users not null,
  title             text not null,
  artifact_type     text not null,
  product           text default '',
  competitor        text,
  payload           jsonb not null,
  view_config       jsonb default '{}',
  notes             text,
  position          int default 0,
  source_session_id uuid references chat_sessions on delete set null,
  source_message_id uuid references chat_messages on delete set null,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create table if not exists workspace_item_messages (
  id         uuid default gen_random_uuid() primary key,
  item_id    uuid references workspace_items on delete cascade not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz default now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

create index if not exists workspace_items_user_id_idx on workspace_items(user_id);
create index if not exists workspace_items_position_idx on workspace_items(user_id, position);
create index if not exists workspace_item_messages_item_id_idx on workspace_item_messages(item_id);

-- ── Row Level Security ────────────────────────────────────────────────────────

alter table workspace_items enable row level security;
alter table workspace_item_messages enable row level security;

create policy "Users own their workspace items"
  on workspace_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users own their workspace item messages"
  on workspace_item_messages for all
  using (
    item_id in (select id from workspace_items where user_id = auth.uid())
  )
  with check (
    item_id in (select id from workspace_items where user_id = auth.uid())
  );
