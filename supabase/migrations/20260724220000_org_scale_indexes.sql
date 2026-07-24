-- Hot-path indexes for enterprise-scale org operations.

-- Role tree traversal (recursive CTEs in visibility checks walk
-- parent_role_id; without this it's a seq scan per level).
CREATE INDEX IF NOT EXISTS idx_workspace_roles_parent
  ON workspace_roles (parent_role_id)
  WHERE parent_role_id IS NOT NULL;

-- JIT domain-capture lookup runs on EVERY signup: match the email
-- domain against verified, auto-join domains only.
CREATE INDEX IF NOT EXISTS idx_account_domains_verified
  ON account_domains (domain)
  WHERE verified_at IS NOT NULL AND auto_join_enabled;

-- Members-per-role fan-out in the roles UI and visibility checks.
CREATE INDEX IF NOT EXISTS idx_profiles_workspace_profile
  ON profiles (workspace_profile_id)
  WHERE workspace_profile_id IS NOT NULL;
