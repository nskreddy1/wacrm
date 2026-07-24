// ============================================================
// /api/admin/audit — read side of the platform audit trail.
//
// GET — recent `platform_audit_log` entries (insert-only table;
// this is the ONLY read surface). Keyset-paginated on created_at,
// decorated with actor + account display names in batch queries.
// Service-role reads behind requireSuperAdmin(); the table itself
// has no SELECT policy, so nothing leaks outside this gate.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/features/auth/lib/account";
import { requireSuperAdmin } from "@/features/auth/lib/super-admin";
import { platformAdmin } from "@/features/admin/lib/platform/admin-client";

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  try {
    await requireSuperAdmin();
    const admin = platformAdmin();

    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor"); // created_at keyset
    const accountId = url.searchParams.get("account_id");

    let query = admin
      .from("platform_audit_log")
      .select("id, actor_id, account_id, action, entity, before, after, created_at")
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (accountId) query = query.eq("account_id", accountId);
    if (cursor) query = query.lt("created_at", cursor);

    const { data: rows, error } = await query;
    if (error) {
      console.error("[GET /api/admin/audit] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load audit log" },
        { status: 500 },
      );
    }

    const page = (rows ?? []).slice(0, PAGE_SIZE);
    const nextCursor =
      (rows ?? []).length > PAGE_SIZE
        ? (page[page.length - 1]?.created_at ?? null)
        : null;

    // Decorate with actor + account names in two batch queries.
    const actorIds = [...new Set(page.map((r) => r.actor_id).filter(Boolean))];
    const accountIds = [
      ...new Set(page.map((r) => r.account_id).filter(Boolean)),
    ];

    const [actorsRes, accountsRes] = await Promise.all([
      actorIds.length
        ? admin
            .from("profiles")
            .select("user_id, full_name, email")
            .in("user_id", actorIds)
        : Promise.resolve({ data: [], error: null }),
      accountIds.length
        ? admin.from("accounts").select("id, name").in("id", accountIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const actorNames = new Map<string, string | null>(
      (actorsRes.data ?? []).map((p) => [
        p.user_id,
        p.full_name || p.email || null,
      ]),
    );
    const accountNames = new Map<string, string>(
      (accountsRes.data ?? []).map((a) => [a.id, a.name]),
    );

    return NextResponse.json({
      entries: page.map((r) => ({
        ...r,
        actor_name: actorNames.get(r.actor_id) ?? null,
        account_name: r.account_id
          ? (accountNames.get(r.account_id) ?? "Unknown workspace")
          : null,
      })),
      next_cursor: nextCursor,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
