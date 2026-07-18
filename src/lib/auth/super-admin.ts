// ============================================================
// Super admin — platform-level operator identity.
//
// There is no super-admin role in the database (yet); operators are
// identified by an env allowlist so platform-wide switches (like the
// AI engine flag) can ship before the full super-admin UI phase.
//
//   SUPER_ADMIN_EMAILS="ops@example.com, cto@example.com"
//
// Comparison is case-insensitive and whitespace-tolerant. An unset /
// empty var means NOBODY is a super admin — the platform-settings
// API simply returns 403 for everyone.
// ============================================================

// TEMPORARY (dev only): hardcoded test operator so the multi-bot /
// AI-requests feature can be exercised end-to-end before the real
// super-admin phase ships. Never applied in production builds.
// TODO: remove once the feature is verified and SUPER_ADMIN_EMAILS
// is configured for real operators.
const DEV_TEST_OPERATORS =
  process.env.NODE_ENV !== 'production' ? ['ai-tester@wacrm.test'] : []

/** Parse the allowlist from env: comma-separated, trimmed, lowercased. */
function allowlist(): string[] {
  const fromEnv = (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0)
  return [...fromEnv, ...DEV_TEST_OPERATORS]
}

/**
 * Is this email a platform super admin? `null`/`undefined`/empty
 * emails are never super admins.
 */
export function isSuperAdmin(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return false
  return allowlist().includes(normalized)
}
