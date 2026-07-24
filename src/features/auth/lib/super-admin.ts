// ============================================================
// Super admin — platform-level operator identity.
//
// Since migration 055 the source of truth is the database flag
// `profiles.is_super_admin` (RLS policies key on the same flag via
// the `is_platform_super_admin()` SQL helper, so TypeScript guards
// and database policies always agree). The `SUPER_ADMIN_EMAILS` env
// allowlist is retained as a transition-period fallback OR-check:
//
//   SUPER_ADMIN_EMAILS="ops@example.com, cto@example.com"
//
// Comparison is case-insensitive and whitespace-tolerant. An unset /
// empty var simply means the env fallback grants nobody.
//
// The platform role is ORTHOGONAL to workspace roles (owner/admin/
// agent/viewer): being a super admin never implicitly joins the
// caller to any workspace. Cross-account reads happen only through
// dedicated service-role queries behind `requireSuperAdmin()`.
//
// Calling convention (mirrors requireRole in ./account.ts):
//
//   try {
//     const ctx = await requireSuperAdmin();
//     // ctx.supabase — SSR client (RLS scoped; super-admin policies apply)
//     // ctx.userId / ctx.email
//   } catch (err) {
//     return toErrorResponse(err); // 401 / 403
//   }
// ============================================================

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import {
  ForbiddenError,
  UnauthorizedError,
} from "./account";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Parse the allowlist from env: comma-separated, trimmed, lowercased. */
function allowlist(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * Env-allowlist check only — pure, no I/O. Kept exported (under its
 * historical name) for the transition-period OR-check and any caller
 * that only has an email in hand.
 */
export function isSuperAdmin(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return allowlist().includes(normalized);
}

export interface SuperAdminContext {
  /** Supabase SSR client for the caller (super-admin RLS policies apply). */
  supabase: SupabaseClient;
  /** `auth.uid()` of the platform operator. */
  userId: string;
  /** Operator's email (from their profile row). */
  email: string | null;
}

/**
 * Resolve and enforce platform super-admin access.
 *
 * Grants access when EITHER:
 *   1. `profiles.is_super_admin` is true for the caller (DB flag,
 *      the post-055 source of truth), OR
 *   2. the caller's email is on the `SUPER_ADMIN_EMAILS` env
 *      allowlist (transition fallback).
 *
 * Throws `UnauthorizedError` (401) with no session and
 * `ForbiddenError` (403) for authenticated non-operators — the same
 * typed errors `toErrorResponse()` already maps, so admin routes can
 * share the exact error-handling shape of workspace routes.
 *
 * Wrapped in React `cache()` so layouts + nested route handlers in
 * the same request resolve the gate at most once.
 */
export const requireSuperAdmin = cache(
  async (): Promise<SuperAdminContext> => {
    const supabase = await createClient();

    const { data: claimsData, error: claimsErr } =
      await supabase.auth.getClaims();
    const userId = claimsData?.claims.sub;
    if (claimsErr || !userId) {
      throw new UnauthorizedError();
    }

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("email, is_super_admin")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("[requireSuperAdmin] profile fetch error:", error);
      throw new ForbiddenError("Could not verify platform access");
    }

    const email = profile?.email ?? null;
    const isOperator = profile?.is_super_admin === true || isSuperAdmin(email);
    if (!isOperator) {
      throw new ForbiddenError("Super admin access required");
    }

    return { supabase, userId, email };
  },
);
