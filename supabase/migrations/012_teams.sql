-- Shared workspace teams: membership, invites, team-linked boards
-- Run after 008_workspace_artifact_rag.sql

-- ── Extensions ────────────────────────────────────────────────────────────────

create extension if not exists citext;
create extension if not exists pgcrypto;

-- ── Teams ─────────────────────────────────────────────────────────────────────

create table if not exists teams (
  id          uuid default gen_random_uuid() primary key,
  name        text not null,
  created_by  uuid references auth.users not null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists teams_created_by_idx on teams(created_by);

-- ── Team members ──────────────────────────────────────────────────────────────

create table if not exists team_members (
  id         uuid default gen_random_uuid() primary key,
  team_id    uuid references teams on delete cascade not null,
  user_id    uuid references auth.users not null,
  role       text not null check (role in ('owner', 'editor', 'viewer')),
  created_at timestamptz default now(),
  unique (team_id, user_id)
);

create index if not exists team_members_user_id_idx on team_members(user_id);
create index if not exists team_members_team_id_idx on team_members(team_id);

-- ── Team invites ──────────────────────────────────────────────────────────────

create table if not exists team_invites (
  id          uuid default gen_random_uuid() primary key,
  team_id     uuid references teams on delete cascade not null,
  email       citext not null,
  role        text not null check (role in ('editor', 'viewer')),
  token_hash  text not null unique,
  invited_by  uuid references auth.users not null,
  expires_at  timestamptz not null,
  accepted_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz default now()
);

create index if not exists team_invites_team_id_idx on team_invites(team_id);
create index if not exists team_invites_email_idx on team_invites(email);

-- ── Link workspaces to teams ──────────────────────────────────────────────────

alter table workspaces
  add column if not exists team_id uuid references teams on delete cascade;

create unique index if not exists workspaces_one_per_team_idx
  on workspaces(team_id)
  where team_id is not null;

create index if not exists workspaces_team_id_idx on workspaces(team_id);

-- ── Helper functions (security definer) ───────────────────────────────────────

create or replace function is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

create or replace function team_role(p_team_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from team_members
  where team_id = p_team_id and user_id = auth.uid()
  limit 1;
$$;

create or replace function is_team_owner(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select team_role(p_team_id) = 'owner';
$$;

create or replace function can_write_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select team_role(p_team_id) in ('owner', 'editor');
$$;

create or replace function is_workspace_readable(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspaces w
    where w.id = p_workspace_id
      and (
        (w.team_id is null and w.user_id = auth.uid())
        or (w.team_id is not null and is_team_member(w.team_id))
      )
  );
$$;

create or replace function is_workspace_writable(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspaces w
    where w.id = p_workspace_id
      and (
        (w.team_id is null and w.user_id = auth.uid())
        or (w.team_id is not null and can_write_team(w.team_id))
      )
  );
$$;

create or replace function workspace_access_role(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when w.team_id is null and w.user_id = auth.uid() then 'owner'
    when w.team_id is not null then team_role(w.team_id)
    else null
  end
  from workspaces w
  where w.id = p_workspace_id
  limit 1;
$$;

-- Create team + owner membership + shared board (one transaction)
create or replace function create_team_with_board(p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_team_id uuid;
  v_workspace_id uuid;
  v_trimmed text := trim(p_name);
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if v_trimmed = '' then
    raise exception 'Team name is required';
  end if;

  insert into teams (name, created_by, updated_at)
  values (v_trimmed, v_uid, now())
  returning id into v_team_id;

  insert into team_members (team_id, user_id, role)
  values (v_team_id, v_uid, 'owner');

  insert into workspaces (user_id, name, position, team_id, updated_at)
  values (v_uid, v_trimmed || ' board', 0, v_team_id, now())
  returning id into v_workspace_id;

  return jsonb_build_object(
    'teamId', v_team_id,
    'workspaceId', v_workspace_id,
    'name', v_trimmed
  );
end;
$$;

-- Accept invite by raw token (hashed server-side in function)
create or replace function accept_team_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_hash text;
  v_invite team_invites%rowtype;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select email into v_email from auth.users where id = v_uid;
  if v_email is null then
    raise exception 'User email not found';
  end if;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  select * into v_invite
  from team_invites
  where token_hash = v_hash
    and revoked_at is null
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if v_invite.id is null then
    raise exception 'Invite not found or expired';
  end if;

  if lower(v_email) <> lower(v_invite.email::text) then
    raise exception 'EMAIL_MISMATCH:%', v_invite.email::text;
  end if;

  select id into v_existing
  from team_members
  where team_id = v_invite.team_id and user_id = v_uid;

  if v_existing is null then
    insert into team_members (team_id, user_id, role)
    values (v_invite.team_id, v_uid, v_invite.role);
  end if;

  update team_invites set accepted_at = now() where id = v_invite.id;

  return jsonb_build_object(
    'teamId', v_invite.team_id,
    'role', v_invite.role
  );
end;
$$;

-- Peek invite metadata (no auth required for public invite page)
create or replace function peek_team_invite(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_invite team_invites%rowtype;
  v_team_name text;
begin
  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  select * into v_invite
  from team_invites
  where token_hash = v_hash
    and revoked_at is null
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if v_invite.id is null then
    return null;
  end if;

  select name into v_team_name from teams where id = v_invite.team_id;

  return jsonb_build_object(
    'teamId', v_invite.team_id,
    'teamName', v_team_name,
    'email', v_invite.email::text,
    'role', v_invite.role,
    'expiresAt', v_invite.expires_at
  );
end;
$$;

grant execute on function create_team_with_board(text) to authenticated;
grant execute on function accept_team_invite(text) to authenticated;
grant execute on function peek_team_invite(text) to anon, authenticated;

-- Emails for teammates only (same team as caller)
create or replace function get_user_emails_for_teams(p_user_ids uuid[])
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.id, u.email::text
  from auth.users u
  where u.id = any(p_user_ids)
    and exists (
      select 1
      from team_members tm_self
      join team_members tm_other on tm_self.team_id = tm_other.team_id
      where tm_self.user_id = auth.uid()
        and tm_other.user_id = u.id
    );
$$;

grant execute on function get_user_emails_for_teams(uuid[]) to authenticated;

-- ── RLS: teams ────────────────────────────────────────────────────────────────

alter table teams enable row level security;

drop policy if exists "Members can read teams" on teams;
create policy "Members can read teams"
  on teams for select
  using (is_team_member(id));

drop policy if exists "Users can create teams" on teams;
create policy "Users can create teams"
  on teams for insert
  with check (created_by = auth.uid());

drop policy if exists "Owners can update teams" on teams;
create policy "Owners can update teams"
  on teams for update
  using (is_team_owner(id))
  with check (is_team_owner(id));

-- ── RLS: team_members ─────────────────────────────────────────────────────────

alter table team_members enable row level security;

drop policy if exists "Members can read team members" on team_members;
create policy "Members can read team members"
  on team_members for select
  using (is_team_member(team_id));

drop policy if exists "Owners can insert team members" on team_members;
create policy "Owners can insert team members"
  on team_members for insert
  with check (is_team_owner(team_id));

drop policy if exists "Owners can update team members" on team_members;
create policy "Owners can update team members"
  on team_members for update
  using (is_team_owner(team_id))
  with check (is_team_owner(team_id));

drop policy if exists "Owners can delete team members" on team_members;
create policy "Owners can delete team members"
  on team_members for delete
  using (is_team_owner(team_id) or user_id = auth.uid());

-- ── RLS: team_invites ─────────────────────────────────────────────────────────

alter table team_invites enable row level security;

drop policy if exists "Owners can read team invites" on team_invites;
create policy "Owners can read team invites"
  on team_invites for select
  using (is_team_owner(team_id));

drop policy if exists "Owners can insert team invites" on team_invites;
create policy "Owners can insert team invites"
  on team_invites for insert
  with check (is_team_owner(team_id) and invited_by = auth.uid());

drop policy if exists "Owners can update team invites" on team_invites;
create policy "Owners can update team invites"
  on team_invites for update
  using (is_team_owner(team_id))
  with check (is_team_owner(team_id));

-- ── RLS: workspaces (replace owner-only) ────────────────────────────────────

drop policy if exists "Users own their workspaces" on workspaces;

drop policy if exists "Users read accessible workspaces" on workspaces;
create policy "Users read accessible workspaces"
  on workspaces for select
  using (
    (team_id is null and user_id = auth.uid())
    or (team_id is not null and is_team_member(team_id))
  );

drop policy if exists "Users insert personal workspaces" on workspaces;
create policy "Users insert personal workspaces"
  on workspaces for insert
  with check (
    user_id = auth.uid()
    and team_id is null
  );

drop policy if exists "Users update accessible workspaces" on workspaces;
create policy "Users update accessible workspaces"
  on workspaces for update
  using (
    (team_id is null and user_id = auth.uid())
    or (team_id is not null and is_team_owner(team_id))
  )
  with check (
    (team_id is null and user_id = auth.uid())
    or (team_id is not null and is_team_owner(team_id))
  );

drop policy if exists "Users delete accessible workspaces" on workspaces;
create policy "Users delete accessible workspaces"
  on workspaces for delete
  using (
    (team_id is null and user_id = auth.uid())
    or (team_id is not null and is_team_owner(team_id))
  );

-- ── RLS: workspace_items ──────────────────────────────────────────────────────

drop policy if exists "Users own their workspace items" on workspace_items;

drop policy if exists "Users read accessible workspace items" on workspace_items;
create policy "Users read accessible workspace items"
  on workspace_items for select
  using (
    (workspace_id is not null and is_workspace_readable(workspace_id))
    or (workspace_id is null and user_id = auth.uid())
  );

drop policy if exists "Users insert writable workspace items" on workspace_items;
create policy "Users insert writable workspace items"
  on workspace_items for insert
  with check (
    user_id = auth.uid()
    and workspace_id is not null
    and is_workspace_writable(workspace_id)
  );

drop policy if exists "Users update writable workspace items" on workspace_items;
create policy "Users update writable workspace items"
  on workspace_items for update
  using (workspace_id is not null and is_workspace_writable(workspace_id))
  with check (workspace_id is not null and is_workspace_writable(workspace_id));

drop policy if exists "Users delete writable workspace items" on workspace_items;
create policy "Users delete writable workspace items"
  on workspace_items for delete
  using (workspace_id is not null and is_workspace_writable(workspace_id));

-- ── RLS: workspace_item_messages ──────────────────────────────────────────────

drop policy if exists "Users own their workspace item messages" on workspace_item_messages;

drop policy if exists "Users read accessible item messages" on workspace_item_messages;
create policy "Users read accessible item messages"
  on workspace_item_messages for select
  using (
    exists (
      select 1 from workspace_items i
      where i.id = item_id and is_workspace_readable(i.workspace_id)
    )
  );

drop policy if exists "Users insert writable item messages" on workspace_item_messages;
create policy "Users insert writable item messages"
  on workspace_item_messages for insert
  with check (
    exists (
      select 1 from workspace_items i
      where i.id = item_id and is_workspace_writable(i.workspace_id)
    )
  );

drop policy if exists "Users delete writable item messages" on workspace_item_messages;
create policy "Users delete writable item messages"
  on workspace_item_messages for delete
  using (
    exists (
      select 1 from workspace_items i
      where i.id = item_id and is_workspace_writable(i.workspace_id)
    )
  );

-- ── RLS: workspace_artifact_chunks ────────────────────────────────────────────

drop policy if exists "Users own their workspace artifact chunks" on workspace_artifact_chunks;

drop policy if exists "Users read accessible workspace chunks" on workspace_artifact_chunks;
create policy "Users read accessible workspace chunks"
  on workspace_artifact_chunks for select
  using (
    workspace_id is not null and is_workspace_readable(workspace_id)
  );

drop policy if exists "Users write accessible workspace chunks" on workspace_artifact_chunks;
create policy "Users write accessible workspace chunks"
  on workspace_artifact_chunks for insert
  with check (
    workspace_id is not null and is_workspace_writable(workspace_id)
  );

drop policy if exists "Users update accessible workspace chunks" on workspace_artifact_chunks;
create policy "Users update accessible workspace chunks"
  on workspace_artifact_chunks for update
  using (workspace_id is not null and is_workspace_writable(workspace_id))
  with check (workspace_id is not null and is_workspace_writable(workspace_id));

drop policy if exists "Users delete accessible workspace chunks" on workspace_artifact_chunks;
create policy "Users delete accessible workspace chunks"
  on workspace_artifact_chunks for delete
  using (workspace_id is not null and is_workspace_writable(workspace_id));

-- ── RAG: match by workspace membership (includes auth.uid() check from 011) ──

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
language sql
stable
security invoker
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
  join workspaces w on w.id = c.workspace_id
  where p_user_id = auth.uid()
    and (
      (w.team_id is null and w.user_id = p_user_id)
      or (w.team_id is not null and exists (
        select 1 from team_members tm
        where tm.team_id = w.team_id and tm.user_id = p_user_id
      ))
    )
    and (p_workspace_item_id is null or c.workspace_item_id = p_workspace_item_id)
    and (p_workspace_id is null or c.workspace_id = p_workspace_id)
    and (p_product is null or p_product = '' or i.product ilike '%' || p_product || '%')
  order by c.embedding <=> p_query_embedding
  limit greatest(1, least(p_match_count, 20));
$$;
