-- Phase 0.2b: explicit "unlimited" semantics for per-account overrides.
--
-- Before this migration an override column had only two states:
--   NULL  = no override (fall back to plan value)
--   N >= 0 = hard cap of N
-- There was NO way to grant unlimited access to a single feature,
-- because NULL was already taken by "no override".
--
-- New model (used by src/lib/quotas resolveLimit):
--   unlimited_all = true  -> every limit resolves to unlimited
--   column = -1           -> THAT feature resolves to unlimited
--   column = NULL         -> no override, use plan value
--   column = N >= 0       -> hard cap of N
ALTER TABLE account_limit_overrides
  ADD COLUMN IF NOT EXISTS unlimited_all BOOLEAN NOT NULL DEFAULT false;

-- Guard the sentinel: -1 is the only negative value with meaning.
ALTER TABLE account_limit_overrides
  DROP CONSTRAINT IF EXISTS alo_sentinel_range;
ALTER TABLE account_limit_overrides
  ADD CONSTRAINT alo_sentinel_range CHECK (
    COALESCE(max_contacts, 0) >= -1 AND
    COALESCE(max_active_flows, 0) >= -1 AND
    COALESCE(max_members, 0) >= -1 AND
    COALESCE(max_channels, 0) >= -1 AND
    COALESCE(monthly_messages, 0) >= -1 AND
    COALESCE(monthly_broadcast_recipients, 0) >= -1 AND
    COALESCE(monthly_ai_replies, 0) >= -1
  );

COMMENT ON COLUMN account_limit_overrides.unlimited_all IS
  'true = this account bypasses ALL plan limits (VIP/internal). Set by platform admins only.';
