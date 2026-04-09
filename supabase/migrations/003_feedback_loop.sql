-- Run this in your Supabase project SQL editor after 002_chat_embeddings.sql
-- Dashboard → SQL Editor → New query → paste → Run
--
-- Outcome tables — close the research → execute → feedback → refine loop.
-- These tables persist real campaign outcomes, recommendation acceptance,
-- and variant performance so the refiner can learn across runs.
--
-- Every table is session-scoped AND user-scoped and RLS guards against
-- cross-user reads/writes the same way chat_messages does.

-- ── recommendation_feedback ─────────────────────────────────────────────────
-- Thumbs up / thumbs down (and optional freeform note) per Strategic
-- Recommendation surfaced by the orchestrator.

create table if not exists recommendation_feedback (
  id                 uuid default gen_random_uuid() primary key,
  user_id            uuid references auth.users not null,
  session_id         uuid references chat_sessions on delete cascade not null,
  message_id         uuid references chat_messages on delete cascade,
  recommendation_key text not null,                      -- hash(title + rationale) so we can match across refines
  title              text not null,
  rating             text not null check (rating in ('up', 'down', 'neutral')),
  note               text,
  created_at         timestamptz default now()
);

create index if not exists recommendation_feedback_user_idx on recommendation_feedback(user_id);
create index if not exists recommendation_feedback_session_idx on recommendation_feedback(session_id);
create index if not exists recommendation_feedback_key_idx on recommendation_feedback(recommendation_key);

alter table recommendation_feedback enable row level security;

create policy "Users own their recommendation feedback"
  on recommendation_feedback for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── recommendation_actions ──────────────────────────────────────────────────
-- Records when the user "accepts" a recommendation (clicks Apply / Refine /
-- Copy). Lets us surface most-accepted recommendation patterns back into the
-- refiner context.

create table if not exists recommendation_actions (
  id                 uuid default gen_random_uuid() primary key,
  user_id            uuid references auth.users not null,
  session_id         uuid references chat_sessions on delete cascade not null,
  message_id         uuid references chat_messages on delete cascade,
  recommendation_key text not null,
  title              text not null,
  action             text not null check (action in ('accepted', 'rejected', 'refined', 'copied')),
  metadata           jsonb default '{}',
  created_at         timestamptz default now()
);

create index if not exists recommendation_actions_user_idx on recommendation_actions(user_id);
create index if not exists recommendation_actions_session_idx on recommendation_actions(session_id);
create index if not exists recommendation_actions_key_idx on recommendation_actions(recommendation_key);

alter table recommendation_actions enable row level security;

create policy "Users own their recommendation actions"
  on recommendation_actions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── variant_results ─────────────────────────────────────────────────────────
-- Real campaign performance numbers the user pastes in after running a
-- variant. Keyed on (session_id, variant_id) so refine can look up prior
-- outcomes for a variant family and adjust subsequent hypotheses.

create table if not exists variant_results (
  id                 uuid default gen_random_uuid() primary key,
  user_id            uuid references auth.users not null,
  session_id         uuid references chat_sessions on delete cascade not null,
  message_id         uuid references chat_messages on delete cascade,
  variant_id         text not null,                      -- matches CampaignVariant.id (e.g. "V1-ROI")
  variant_angle      text,
  hypothesis         text,
  success_metric     text,
  -- Outcome numbers (all optional — user fills what they have)
  sent_count         integer,
  open_rate          numeric(5, 2),                      -- stored as percent, e.g. 42.10
  reply_rate         numeric(5, 2),
  click_rate         numeric(5, 2),
  meetings_booked    integer,
  hypothesis_confirmed text check (hypothesis_confirmed in ('yes', 'no', 'unclear')),
  notes              text,
  created_at         timestamptz default now()
);

create index if not exists variant_results_user_idx on variant_results(user_id);
create index if not exists variant_results_session_idx on variant_results(session_id);
create index if not exists variant_results_variant_idx on variant_results(variant_id);

alter table variant_results enable row level security;

create policy "Users own their variant results"
  on variant_results for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
