/**
 * src/lib/auth-provider/index.ts
 *
 * Session facade (ADR-002 §3.2): backed by Supabase Auth today, swappable
 * later. New code MUST use this module for session identity and membership
 * gating; calling `supabase.auth.*` directly outside `src/lib/` is a
 * boundary violation (enforced by scripts/check-boundaries.mjs).
 *
 * Facade pattern (plan addendum §B): the rest of the app knows two verbs —
 * "who is the caller" and "is the caller a member of this account" — and
 * never a vendor name.
 */
import 'server-only';

import { createClient, hasSupabaseConfig } from '@/lib/supabase/server';

export type SessionUser = { id: string; email: string | null };

export class UnauthenticatedError extends Error {
  readonly status = 401;
  constructor() {
    super('Not authenticated');
    this.name = 'UnauthenticatedError';
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor() {
    super('Not a member of this account');
    this.name = 'ForbiddenError';
  }
}

/** The caller's session identity, or null when unauthenticated. */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!hasSupabaseConfig()) return null;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}

/** getSessionUser that throws a typed 401 instead of returning null. */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

export type AccountRole = 'viewer' | 'agent' | 'admin' | 'owner';

/**
 * Assert the caller is an active member of `accountId` (optionally at
 * `minRole`). Delegates the decision to the database's
 * `is_account_member()` — the same function every RLS policy uses — so the
 * application and the row-level layer can never disagree.
 */
export async function requireAccountMember(
  accountId: string,
  minRole: AccountRole = 'viewer'
): Promise<SessionUser> {
  const user = await requireSessionUser();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('is_account_member', {
    target_account_id: accountId,
    min_role: minRole,
  });
  if (error || data !== true) throw new ForbiddenError();
  return user;
}
