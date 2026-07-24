// ============================================================
// /api/account/profiles
//
//   GET  — list this workspace's profiles (permission sets).
//   POST — create a custom profile.
//
// Profiles are the Bigin/Zoho "what can you DO" axis. The two
// system profiles (Administrator, Standard) are seeded per
// account by migration and cannot be renamed or deleted; custom
// profiles are fully editable by members:manage holders.
//
// GET is open to every active member (the invite sheet and the
// Users table need profile names), while mutations require
// members:manage. RLS enforces the same split at the DB.
// ============================================================

import { NextResponse } from "next/server";

import {
  getCurrentAccount,
  requirePermission,
  toErrorResponse,
} from "@/features/auth/lib/account";
import { isPermissionSlug } from "@/features/auth/lib/permissions";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

const MAX_NAME_LEN = 80;
const MAX_DESCRIPTION_LEN = 500;
// Steady-state cap; matches Zoho's default profile ceiling and
// keeps a compromised admin session from flooding the table.
const MAX_PROFILES_PER_ACCOUNT = 25;

const PROFILE_SELECT =
  "id, name, description, permissions, is_system, created_at, updated_at, updated_by_user_id, created_by_user_id";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from("workspace_profiles")
      .select(PROFILE_SELECT)
      .eq("account_id", ctx.accountId)
      .order("is_system", { ascending: false })
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/account/profiles] error:", error);
      return NextResponse.json(
        { error: "Failed to load profiles" },
        { status: 500 },
      );
    }

    // Member counts per profile — drives the "N users" column.
    const { data: counts } = await ctx.supabase
      .from("profiles")
      .select("workspace_profile_id")
      .eq("account_id", ctx.accountId)
      .neq("status", "deleted")
      .not("workspace_profile_id", "is", null);

    const countByProfile = new Map<string, number>();
    for (const row of counts ?? []) {
      const id = row.workspace_profile_id as string;
      countByProfile.set(id, (countByProfile.get(id) ?? 0) + 1);
    }

    return NextResponse.json({
      data: (data ?? []).map((p) => ({
        ...p,
        member_count: countByProfile.get(p.id) ?? 0,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("members:manage");

    const limit = checkRateLimit(
      `admin:profileCreate:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      description?: unknown;
      permissions?: unknown;
    } | null;

    const nameRaw = typeof body?.name === "string" ? body.name.trim() : "";
    if (nameRaw === "" || nameRaw.length > MAX_NAME_LEN) {
      return NextResponse.json(
        { error: `'name' is required (max ${MAX_NAME_LEN} characters)` },
        { status: 400 },
      );
    }

    let description: string | null = null;
    if (typeof body?.description === "string") {
      const trimmed = body.description.trim();
      if (trimmed.length > MAX_DESCRIPTION_LEN) {
        return NextResponse.json(
          {
            error: `'description' must be ${MAX_DESCRIPTION_LEN} characters or fewer`,
          },
          { status: 400 },
        );
      }
      description = trimmed === "" ? null : trimmed;
    }

    // Permissions: every entry must be a known slug. Unknown slugs
    // are rejected (not silently dropped) so a stale client fails
    // loudly instead of creating a profile that silently lacks the
    // permission the admin thought they granted.
    if (!Array.isArray(body?.permissions)) {
      return NextResponse.json(
        { error: "'permissions' must be an array of permission slugs" },
        { status: 400 },
      );
    }
    const permissions = [...new Set(body.permissions)];
    for (const slug of permissions) {
      if (typeof slug !== "string" || !isPermissionSlug(slug)) {
        return NextResponse.json(
          { error: `Unknown permission slug: ${String(slug)}` },
          { status: 400 },
        );
      }
    }

    const { count } = await ctx.supabase
      .from("workspace_profiles")
      .select("id", { count: "exact", head: true })
      .eq("account_id", ctx.accountId);
    if ((count ?? 0) >= MAX_PROFILES_PER_ACCOUNT) {
      return NextResponse.json(
        {
          error: `This workspace already has ${MAX_PROFILES_PER_ACCOUNT} profiles. Delete unused profiles first.`,
        },
        { status: 409 },
      );
    }

    const { data, error } = await ctx.supabase
      .from("workspace_profiles")
      .insert({
        account_id: ctx.accountId,
        name: nameRaw,
        description,
        permissions,
        is_system: false,
        created_by_user_id: ctx.userId,
        updated_by_user_id: ctx.userId,
      })
      .select(PROFILE_SELECT)
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: `A profile named "${nameRaw}" already exists` },
          { status: 409 },
        );
      }
      console.error("[POST /api/account/profiles] error:", error);
      return NextResponse.json(
        { error: "Failed to create profile" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { data: { ...data, member_count: 0 } },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
