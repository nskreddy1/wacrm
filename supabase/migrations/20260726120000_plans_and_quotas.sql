-- Phase 0.2: Plan tiers + quota enforcement foundation.
--
-- Design decisions (locked in .agents/IMPLEMENTATION-PLAN.md Phase 0.2):
--  * Tenancy key is accounts.id ("account_id" everywhere, NOT workspace_id).
--  * Limits live in a seeded reference table, not in code, so support can
--    adjust a single tenant without a deploy (account_limit_overrides).
--  * Point-in-time metrics (contacts, active flows, members, channels) are
--    counted live from their source tables — no counter drift possible.
--  * Flow metrics (messages sent, broadcasts, AI replies) use a monthly
--    counter table keyed on (account_id, metric, period_start).
--  * All quota writes happen through SECURITY-DEFINER-free service-role
--    code paths; RLS here only grants READ so tenants can see their usage.

-- ---------------------------------------------------------------------------
-- 1. Plans reference table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,               -- 'free' | 'pro' | 'ultra'
  display_name TEXT NOT NULL,
  -- NULL = unlimited. Point-in-time limits:
  max_contacts INTEGER,
  max_active_flows INTEGER,
  max_members INTEGER,
  max_channels INTEGER,
  -- Monthly flow limits (reset each calendar month, UTC):
  monthly_messages INTEGER,
  monthly_broadcast_recipients INTEGER,
  monthly_ai_replies INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO plans (
  id, display_name,
  max_contacts, max_active_flows, max_members, max_channels,
  monthly_messages, monthly_broadcast_recipients, monthly_ai_replies
) VALUES
  ('free',  'Free',  500,   3,    2,  1, 1000,   500,   50),
  ('pro',   'Pro',   10000, 25,   10, 3, 20000,  10000, 1000),
  ('ultra', 'Ultra', NULL,  NULL, 25, 10, 100000, 50000, 10000)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Account -> plan assignment
-- ---------------------------------------------------------------------------
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS plan_id TEXT NOT NULL DEFAULT 'free' REFERENCES plans(id);

-- Per-tenant limit overrides (support tool; row absent = use plan value).
CREATE TABLE IF NOT EXISTS account_limit_overrides (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  max_contacts INTEGER,
  max_active_flows INTEGER,
  max_members INTEGER,
  max_channels INTEGER,
  monthly_messages INTEGER,
  monthly_broadcast_recipients INTEGER,
  monthly_ai_replies INTEGER,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. Monthly usage counters (flow metrics only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS usage_counters (
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  metric TEXT NOT NULL CHECK (metric IN (
    'messages_sent', 'broadcast_recipients', 'ai_replies'
  )),
  period_start DATE NOT NULL,        -- first day of month, UTC
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (account_id, metric, period_start)
);

-- Atomic increment used by service-role code. Plain SECURITY INVOKER:
-- only the service role (which bypasses RLS anyway) calls this; keeping
-- it INVOKER means it grants nothing extra if ever exposed.
CREATE OR REPLACE FUNCTION increment_usage(
  p_account_id UUID,
  p_metric TEXT,
  p_amount INTEGER DEFAULT 1
) RETURNS INTEGER
LANGUAGE sql
AS $$
  INSERT INTO usage_counters (account_id, metric, period_start, used)
  VALUES (p_account_id, p_metric, date_trunc('month', now() AT TIME ZONE 'utc')::date, p_amount)
  ON CONFLICT (account_id, metric, period_start)
  DO UPDATE SET used = usage_counters.used + p_amount, updated_at = now()
  RETURNING used;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on new functions. This
-- function writes counters, so restrict it to the service role only.
REVOKE EXECUTE ON FUNCTION increment_usage(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION increment_usage(UUID, TEXT, INTEGER) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS — tenants can READ their plan/usage; only service role writes
-- ---------------------------------------------------------------------------
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_limit_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

-- Plans are public reference data for signed-in users (pricing UI).
DROP POLICY IF EXISTS plans_read ON plans;
CREATE POLICY plans_read ON plans FOR SELECT
  TO authenticated
  USING (true);

-- A member may read their own account's override row.
DROP POLICY IF EXISTS overrides_read_own ON account_limit_overrides;
CREATE POLICY overrides_read_own ON account_limit_overrides FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT p.account_id FROM profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.status = 'active'
    )
  );

-- A member may read their own account's usage.
DROP POLICY IF EXISTS usage_read_own ON usage_counters;
CREATE POLICY usage_read_own ON usage_counters FOR SELECT
  TO authenticated
  USING (
    account_id IN (
      SELECT p.account_id FROM profiles p
      WHERE p.id = (SELECT auth.uid()) AND p.status = 'active'
    )
  );

-- No INSERT/UPDATE/DELETE policies: with RLS enabled and no policy for
-- those commands, authenticated/anon writes are denied. The service
-- role bypasses RLS and is the only writer.

-- Expose read access via the Data API (RLS still gates rows).
GRANT SELECT ON plans TO authenticated;
GRANT SELECT ON account_limit_overrides TO authenticated;
GRANT SELECT ON usage_counters TO authenticated;
