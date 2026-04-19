-- Run this in your Supabase project SQL editor after 003_feedback_loop.sql
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Tightens RLS policies for production readiness.
-- Previously, schema.sql used "using (true)" on all tables.
-- This migration drops the wide-open policies and replaces them with
-- scoped alternatives.
--
-- NOTE: Run this AFTER the initial schema.sql has been applied.
-- If the old policies don't exist yet, the DROP will fail silently (IF EXISTS).

-- ── Drop overly permissive legacy policies ──────────────────────────────────

drop policy if exists "Allow all on signal_cache" on signal_cache;
drop policy if exists "Allow all on conversations" on conversations;

-- ── signal_cache: non-PII shared cache ──────────────────────────────────────
-- Allow read/write for any role (anon or authenticated) since this is
-- server-side tool result caching with no user data. Block deletes.

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'signal_cache' and policyname = 'Anyone can read signal_cache'
  ) then
    create policy "Anyone can read signal_cache"
      on signal_cache for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'signal_cache' and policyname = 'Anyone can insert signal_cache'
  ) then
    create policy "Anyone can insert signal_cache"
      on signal_cache for insert with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'signal_cache' and policyname = 'Anyone can update signal_cache'
  ) then
    create policy "Anyone can update signal_cache"
      on signal_cache for update using (true) with check (true);
  end if;
end $$;

-- ── conversations (legacy): restrict to authenticated ───────────────────────
-- This table is superseded by chat_sessions + chat_messages (migration 001).
-- If it's still in use, at least require an auth session.

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'conversations' and policyname = 'Authenticated users can access conversations'
  ) then
    create policy "Authenticated users can access conversations"
      on conversations for all
      using (auth.role() = 'authenticated')
      with check (auth.role() = 'authenticated');
  end if;
end $$;

-- ── Verify: all user-data tables have user_id-scoped RLS ───────────────────
-- chat_sessions, chat_messages, chat_embeddings, user_memory,
-- recommendation_feedback, recommendation_actions, variant_results
-- All already have auth.uid() = user_id policies from their migrations.
-- This is a sanity check — if any table is missing RLS, enable it.

alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;
alter table chat_embeddings enable row level security;
alter table user_memory enable row level security;
alter table recommendation_feedback enable row level security;
alter table recommendation_actions enable row level security;
alter table variant_results enable row level security;
