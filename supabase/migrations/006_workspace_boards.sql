-- Named workspace collections (boards) + link items to a board
-- Run in Supabase SQL editor after 005_workspace.sql

-- ── Workspaces (boards) ───────────────────────────────────────────────────────

create table if not exists workspaces (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users not null,
  name        text not null,
  position    int default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists workspaces_user_id_idx on workspaces(user_id);
create index if not exists workspaces_position_idx on workspaces(user_id, position);

alter table workspaces enable row level security;

create policy "Users own their workspaces"
  on workspaces for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Link items to a workspace ─────────────────────────────────────────────────

alter table workspace_items
  add column if not exists workspace_id uuid references workspaces on delete cascade;

create index if not exists workspace_items_workspace_id_idx on workspace_items(workspace_id);

-- Backfill: one default board per user that already has orphan items
do $$
declare
  r record;
  new_id uuid;
begin
  for r in
    select distinct user_id
    from workspace_items
    where workspace_id is null
  loop
    insert into workspaces (user_id, name, position)
    values (r.user_id, 'Workspace 1', 0)
    returning id into new_id;

    update workspace_items
    set workspace_id = new_id
    where user_id = r.user_id
      and workspace_id is null;
  end loop;
end $$;
