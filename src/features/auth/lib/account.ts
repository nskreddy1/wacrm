// ============================================================
// Server-side account context — for API routes and server
// components. Reads the caller's profile + account in one round
// trip and verifies role on demand.
//
// IMPORTANT: this module is server-only. It imports the Supabase
// SSR client (`@/lib/supabase/server`), which reads `next/headers`
// cookies. Importing it from a client component will fail at
// build time with the standard Next.js "You're importing a
// component that needs `next/headers`" error — that's the
// boundary check; we don't need the `server-only` package.
//
// Calling convention
// ------------------
// API routes don't need to redo `supabase.auth.getUser()` — they
// receive a fully-loaded context from `requireRole`:
//
//   try {
//     const ctx = await requireRole("admin");
//     // ctx.supabase — the SSR client (RLS scoped to this user)
//     // ctx.userId  — auth.uid()
//     // ctx.accountId / ctx.role / ctx.account
//   } catch (err) {
//     return errorResponse(err); // see toErrorResponse() below
//   }
// ============================================================

import { cache } from "react";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { isAccountRole, type AccountRole } from "./roles";
import {
  deriveCapabilities,
  hasPermission,
  type MemberCapabilities,
  type PermissionSlug,
} from "./permissions";

// ------------------------------------------------------------
// Errors
//
// Custom classes so API routes can map a single `catch` to the
// right HTTP status without sprinkling 401/403 strings everywhere.
// ------------------------------------------------------------

export class UnauthorizedError extends Error {
  readonly status = 401 as const;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  readonly status = 403 as const;
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Convert one of the typed errors above (or anything else) into a
 * `NextResponse`. Routes can do:
 *
 *   } catch (err) {
 *     return toErrorResponse(err);
 *   }
 *
 * Unknown errors collapse to 500 with the generic message — we
 * never leak `err.message` for non-classified errors to keep
 * server internals out of the wire.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error("[toErrorResponse] uncategorized error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

// ------------------------------------------------------------
// Account context
// ------------------------------------------------------------

export interface AccountContext {
  /** Supabase SSR client, RLS scoped to the calling user. */
  supabase: SupabaseClient;
  /** `auth.uid()` for the caller. Always defined when this resolves. */
  userId: string;
  /** Caller's account_id from their profile row. */
  accountId: string;
  /** Caller's role within their account. */
  role: AccountRole;
  /** Lightweight account meta — id + name. */
  account: { id: string; name: string };
  /** Permission slugs from the member's workspace profile. */
  permissions: readonly string[];
  /** Workspace owner — the "Super Admin"; implicitly holds every permission. */
  isOwner: boolean;
  /** Membership status — always 'active' when this resolves. */
  status: string;
  /** Assigned workspace profile (permission set), if any. */
  workspaceProfile: { id: string; name: string } | null;
  /** Derived capability flags for existing call sites. */
  capabilities: MemberCapabilities;
}

/**
 * Resolve the caller's user + account + role in one round trip.
 *
 * Throws `UnauthorizedError` if there's no Supabase session.
 * Throws `ForbiddenError` if the profile is missing account
 * fields (shouldn't happen post-017 migration; defensive guard
 * against profile rows that pre-date the backfill or were
 * inserted by hand).
 *
 * Use `requireRole(min)` instead when the route also needs a
 * minimum-role check — it's a thin wrapper over this.
 *
 * PERF: two optimizations keep this to a single network round trip:
 *
 *   1. `getClaims()` verifies the caller's JWT locally (signature +
 *      `exp` expiration against the project's public signing keys)
 *      instead of `getUser()`'s network call to the Auth server.
 *      Expired/tampered tokens fail verification -> Unauthorized.
 *   2. The `get_account_context()` RPC (migration 053) joins
 *      profiles + accounts in one query — replacing the previous
 *      two sequential PostgREST round-trips. It is SECURITY
 *      INVOKER, so profiles/accounts RLS still applies.
 *
 * Additionally wrapped in React `cache()` so the whole resolution
 * runs AT MOST ONCE per request, no matter how many route handlers,
 * server components, or helpers call it during the same render. The
 * cache is request-scoped — never shared across users or requests —
 * so this is safe for auth data.
 */
export const getCurrentAccount = cache(async (): Promise<AccountContext> => {
  const supabase = await createClient();

  const { data: claimsData, error: claimsErr } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims.sub;
  if (claimsErr || !userId) {
    throw new UnauthorizedError();
  }

  const { data: rows, error } = await supabase.rpc("get_account_context");

  if (error) {
    // PGRST202: function not in PostgREST's schema cache — occurs when
    // migration 053 hasn't been applied yet or the cache is stale right
    // after applying it. Fall back to the legacy two-query path so auth
    // keeps working during rollout.
    if (error.code === "PGRST202") {
      return getCurrentAccountLegacy(supabase, userId);
    }
    console.error("[getCurrentAccount] context RPC error:", error);
    throw new ForbiddenError("Could not load account context");
  }

  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || !row.account_id || !row.account_role) {
    // Pre-migration profile, or a manual insert that skipped the
    // signup trigger. The user is authenticated but the app has
    // no way to scope their queries — treat as forbidden.
    throw new ForbiddenError("Profile is not linked to an account");
  }
  if (!isAccountRole(row.account_role)) {
    // The DB enum should make this impossible, but a future
    // migration that broadens the enum without updating TS would
    // hit this — surface it rather than silently widening.
    throw new ForbiddenError(`Unknown account role: ${row.account_role}`);
  }

  // Membership status gate: deactivated or soft-deleted members are
  // authenticated but must not reach any workspace data. RLS blocks
  // them at the database too (is_account_member checks status);
  // this throw gives them a clean 403 instead of empty responses.
  const status = typeof row.status === "string" ? row.status : "active";
  if (status !== "active") {
    throw new ForbiddenError("This user account has been deactivated");
  }

  const permissions: string[] = Array.isArray(row.permissions) ? row.permissions : [];
  const isOwner = row.is_owner === true;

  return {
    supabase,
    userId,
    accountId: row.account_id,
    role: row.account_role,
    account: { id: row.account_id, name: row.account_name },
    permissions,
    isOwner,
    status,
    workspaceProfile:
      row.workspace_profile_id && row.workspace_profile_name
        ? { id: row.workspace_profile_id, name: row.workspace_profile_name }
        : null,
    capabilities: deriveCapabilities(permissions, isOwner),
  };
});

/**
 * Legacy two-query context resolution. Only used as a fallback when
 * the `get_account_context()` RPC is unavailable (see PGRST202 note
 * above). Same RLS scoping and error semantics as the RPC path.
 */
async function getCurrentAccountLegacy(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccountContext> {
  const { data, error } = await supabase
    .from("profiles")
    .select("account_id, account_role, status, workspace_profile_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[getCurrentAccount] profile fetch error:", error);
    throw new ForbiddenError("Could not load account context");
  }
  if (!data || !data.account_id || !data.account_role) {
    throw new ForbiddenError("Profile is not linked to an account");
  }
  if (!isAccountRole(data.account_role)) {
    throw new ForbiddenError(`Unknown account role: ${data.account_role}`);
  }

  // Plain point lookup by id rather than an embedded FK join — embeds
  // depend on PostgREST's relationship schema cache, which can be stale
  // right after migrations (PGRST200, issue #294). A lookup by id needs
  // no relationship inference and is gated by the same accounts RLS.
  const { data: account, error: accountErr } = await supabase
    .from("accounts")
    .select("id, name, owner_user_id")
    .eq("id", data.account_id)
    .maybeSingle();

  if (accountErr) {
    console.error("[getCurrentAccount] account fetch error:", accountErr);
    throw new ForbiddenError("Could not load account context");
  }
  if (!account) {
    throw new ForbiddenError("Profile is not linked to an account");
  }

  const status = typeof data.status === "string" ? data.status : "active";
  if (status !== "active") {
    throw new ForbiddenError("This user account has been deactivated");
  }

  const isOwner = account.owner_user_id === userId;

  // Load the assigned workspace profile (permission set), if any.
  // Pre-migration databases won't have the table — treat errors as
  // "no profile" so the fallback stays functional during rollout.
  let workspaceProfile: { id: string; name: string } | null = null;
  let permissions: string[] = [];
  if (data.workspace_profile_id) {
    const { data: wp } = await supabase
      .from("workspace_profiles")
      .select("id, name, permissions")
      .eq("id", data.workspace_profile_id)
      .maybeSingle();
    if (wp) {
      workspaceProfile = { id: wp.id, name: wp.name };
      permissions = Array.isArray(wp.permissions) ? wp.permissions : [];
    }
  }

  return {
    supabase,
    userId,
    accountId: data.account_id,
    role: data.account_role,
    account: { id: account.id, name: account.name },
    permissions,
    isOwner,
    status,
    workspaceProfile,
    capabilities: deriveCapabilities(permissions, isOwner),
  };
}

/**
 * Resolve the caller's account context and enforce a minimum role.
 *
 * Throws `UnauthorizedError` / `ForbiddenError` as documented on
 * `getCurrentAccount`, plus `ForbiddenError("Insufficient role")`
 * when the caller is below `min`.
 */
export async function requireRole(min: AccountRole): Promise<AccountContext> {
  const ctx = await getCurrentAccount();

  // Permission-model bridge: legacy min-role checks map onto the
  // caller's derived capabilities (owner keeps everything). This
  // mirrors the CASE mapping inside the redefined SQL
  // `is_account_member(account_id, min_role)` shim, so TS guards
  // and RLS agree.
  const ok =
    min === "viewer"
      ? true
      : min === "agent"
        ? ctx.capabilities.canSendMessages
        : min === "admin"
          ? ctx.capabilities.canEditSettings
          : ctx.isOwner;

  if (!ok) {
    throw new ForbiddenError(
      `This action requires the '${min}' role or higher`,
    );
  }
  return ctx;
}

/**
 * Resolve the caller's account context and enforce a specific
 * permission slug. Preferred over `requireRole` for new routes:
 *
 *   const ctx = await requirePermission("broadcasts:send");
 *
 * Owners implicitly pass every check (Super Admin semantics).
 */
export async function requirePermission(
  slug: PermissionSlug,
): Promise<AccountContext> {
  const ctx = await getCurrentAccount();
  if (!hasPermission(ctx.permissions, slug, ctx.isOwner)) {
    throw new ForbiddenError(`This action requires the '${slug}' permission`);
  }
  return ctx;
}
