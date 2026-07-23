// ============================================================
// /api/account/members/[userId]
//
//   PATCH  — change a member's workspace profile (permission set)
//            and/or status (active | inactive | deleted).
//            Requires members:manage.
//   DELETE — remove a member entirely.  Requires members:manage.
//
// All mutations delegate to SECURITY DEFINER RPCs:
//   - set_member_profile(p_user_id, p_profile_id)   (migration 2026-07-24)
//   - set_member_status(p_user_id, p_status)        (migration 2026-07-24)
//   - remove_account_member(p_user_id)              (migration 018)
//
// The RPCs do the *real* authorisation work — caller must hold
// members:manage in the same account, target can't be the owner,
// can't be self (status). The TS layer forwards the call and maps
// Postgres SQLSTATEs back to HTTP statuses.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requirePermission, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const MEMBER_STATUSES = ["active", "inactive", "deleted"] as const;

// Map known SQLSTATEs from the RPCs onto HTTP statuses. The
// `error.code` field is the SQLSTATE; the `message` is the
// human-readable RAISE message from the migration.
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update member" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requirePermission("members:manage");

    const limit = checkRateLimit(
      `admin:memberUpdate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { profile_id?: unknown; status?: unknown }
      | null;

    const profileId =
      typeof body?.profile_id === "string" ? body.profile_id : undefined;
    const status =
      typeof body?.status === "string" &&
      (MEMBER_STATUSES as readonly string[]).includes(body.status)
        ? body.status
        : undefined;

    if (!profileId && !status) {
      return NextResponse.json(
        {
          error:
            "Provide 'profile_id' (workspace profile) and/or 'status' (active | inactive | deleted)",
        },
        { status: 400 },
      );
    }

    if (profileId) {
      const { error } = await ctx.supabase.rpc("set_member_profile", {
        p_user_id: userId,
        p_profile_id: profileId,
      });
      if (error) return rpcErrorToResponse(error);
    }

    if (status) {
      const { error } = await ctx.supabase.rpc("set_member_status", {
        p_user_id: userId,
        p_status: status,
      });
      if (error) return rpcErrorToResponse(error);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requirePermission("members:manage");

    const limit = checkRateLimit(
      `admin:memberRemove:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const { data, error } = await ctx.supabase.rpc("remove_account_member", {
      p_user_id: userId,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true, newPersonalAccountId: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
