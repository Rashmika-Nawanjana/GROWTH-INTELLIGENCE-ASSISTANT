-- Per-run usage ledger for API monitor history (migration 009)
CREATE TABLE IF NOT EXISTS run_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text,
  query_preview text,
  latency_ms integer NOT NULL DEFAULT 0,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  cost_basis text NOT NULL DEFAULT 'estimated',
  tool_calls jsonb NOT NULL DEFAULT '{}'::jsonb,
  llm_by_stage jsonb NOT NULL DEFAULT '{}'::jsonb,
  trace_id text,
  trace_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS run_usage_user_created_idx
  ON run_usage (user_id, created_at DESC);

ALTER TABLE run_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY run_usage_select_own ON run_usage
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY run_usage_insert_own ON run_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);
