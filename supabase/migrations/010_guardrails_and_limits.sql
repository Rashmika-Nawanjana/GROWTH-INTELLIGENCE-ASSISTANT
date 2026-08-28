-- Guardrail events + rate limits + run_usage safety columns (migration 010)

-- ── guardrail_events ─────────────────────────────────────────────────────────
-- Stores finding CATEGORIES only — never raw user text or PII.
CREATE TABLE IF NOT EXISTS guardrail_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route text NOT NULL,
  risk text NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
  blocked boolean NOT NULL DEFAULT false,
  finding_categories text[] NOT NULL DEFAULT '{}',
  finding_labels text[] NOT NULL DEFAULT '{}',
  judged boolean NOT NULL DEFAULT false,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guardrail_events_user_created_idx
  ON guardrail_events (user_id, created_at DESC);

ALTER TABLE guardrail_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY guardrail_events_select_own ON guardrail_events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY guardrail_events_insert_own ON guardrail_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── rate_limits ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limits (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  route text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, route, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limits_lookup_idx
  ON rate_limits (user_id, route, window_start DESC);

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- No direct client access — only via RPC with auth.uid()
CREATE POLICY rate_limits_no_direct ON rate_limits
  FOR ALL USING (false) WITH CHECK (false);

-- Atomic sliding-window check: increments count for the current window bucket.
-- Returns allowed=true when under limit.
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_user_id uuid,
  p_route text,
  p_limit integer,
  p_window_seconds integer DEFAULT 60
)
RETURNS TABLE (allowed boolean, current_count integer, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket timestamptz;
  v_count integer;
  v_uid uuid;
BEGIN
  -- Only allow callers to rate-limit themselves
  v_uid := auth.uid();
  IF v_uid IS NULL OR v_uid <> p_user_id THEN
    RETURN QUERY SELECT false, 0, p_window_seconds;
    RETURN;
  END IF;

  v_bucket := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO rate_limits (user_id, route, window_start, request_count)
  VALUES (p_user_id, p_route, v_bucket, 1)
  ON CONFLICT (user_id, route, window_start)
  DO UPDATE SET request_count = rate_limits.request_count + 1
  RETURNING rate_limits.request_count INTO v_count;

  IF v_count <= p_limit THEN
    RETURN QUERY SELECT true, v_count, 0;
  ELSE
    RETURN QUERY SELECT
      false,
      v_count,
      greatest(1, (p_window_seconds - (extract(epoch from now())::int % p_window_seconds))::int);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION check_rate_limit(uuid, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_rate_limit(uuid, text, integer, integer) TO authenticated;

-- ── run_usage safety columns ─────────────────────────────────────────────────
ALTER TABLE run_usage
  ADD COLUMN IF NOT EXISTS safety_score numeric(4, 3),
  ADD COLUMN IF NOT EXISTS guardrail_risk text;
