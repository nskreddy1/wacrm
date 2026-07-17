import { supabaseAdmin } from '@/lib/ai/admin-client'

// ============================================================
// Super admin — platform-level operator identity.
//
// Two sources of truth, checked in order:
//
//   1. `profiles.platform_role = 'super_admin'` — the DB-backed role
//      seeded by migration 045 (admin@wacrm.app) and the foundation
//      for the future multi-role platform-admin phase.
//   2. SUPER_ADMIN_EMAILS env allowlist — an operational escape hatch
//      ("break glass") that works even if the DB row is wrong:
//
//        SUPER_ADMIN_EMAILS="ops@example.com, cto@example.com"
//
// Comparison is case-insensitive and whitespace-tolerant. No DB row
// and no allowlist match means NOT a super admin — the admin surfaces
// simply return 403 / redirect.
// ============================================================

export type SuperAdminUser = {
  id: string
  email?: string | null
}

/** Parse the allowlist from env: comma-separated, trimmed, lowercased. */
function allowlist(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0)
}

/** Env-only check — sync, no DB. Exposed for tests and cheap paths. */
export function isAllowlistedSuperAdmin(
  email: string | null | undefined,
): boolean {
  const normalized = email?.trim().toLowerCase()
  if (!normalized) return false
  return allowlist().includes(normalized)
}

/**
 * Is this authenticated user a platform super admin?
 *
 * Env allowlist wins first (no query needed); otherwise the profile's
 * `platform_role` decides. A DB error fails CLOSED (returns false) —
 * an outage must never widen access to platform-wide switches.
 */
export async function isSuperAdmin(
  user: SuperAdminUser | null | undefined,
): Promise<boolean> {
  if (!user?.id) return false
  if (isAllowlistedSuperAdmin(user.email)) return true

  try {
    const { data, error } = await supabaseAdmin()
      .from('profiles')
      .select('platform_role')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) {
      console.error('[auth/super-admin] role read failed:', error.message)
      return false
    }
    return data?.platform_role === 'super_admin'
  } catch (err) {
    console.error('[auth/super-admin] role read threw:', err)
    return false
  }
}
