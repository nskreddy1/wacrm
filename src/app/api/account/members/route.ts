// ============================================================
// GET /api/account/members
//
// Lists members of the caller's account. Any member can call it
// (the Members tab is shown to admins+, but agents/viewers see a
// read-only roster too).
//
// Query params (all optional — omitting them preserves the legacy
// full-list response shape used by the automation builder and
// settings overview):
//
//   q       — case-insensitive search across full_name / email.
//   limit   — page size (1..100). Presence of `limit` or `q` or
//             `cursor` switches to paginated mode.
//   cursor  — keyset cursor: `<created_at>|<user_id>` of the last
//             row of the previous page. Keyset (not OFFSET) so
//             page N+1 stays O(page) at hundreds of members.
//
// Paginated responses include:
//   next_cursor — pass back as `cursor` for the next page; null
//                 when this is the last page.
//   summary     — { total, owner, admin, agent, viewer } counts
//                 for the whole account (independent of q/paging),
//                 computed by indexed head-count queries — never
//                 by shipping every row to the client.
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import {
  ACCOUNT_ROLES,
  canManageMembers,
  isAccountRole,
  type AccountRole,
} from "@/lib/auth/roles";
import type { AccountMember } from "@/types";

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
}

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LEN = 120;

/** Parse `<created_at>|<user_id>` keyset cursors. Returns null on garbage. */
function parseCursor(
  raw: string | null,
): { createdAt: string; userId: string } | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf("|");
  if (idx <= 0 || idx === raw.length - 1) return null;
  const createdAt = raw.slice(0, idx);
  const userId = raw.slice(idx + 1);
  if (Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, userId };
}

/**
 * Escape PostgREST `or=` filter syntax inside a user-supplied search
 * term: commas/parens are structural in the filter grammar, and `%`
 * and `_` are LIKE wildcards.
 */
function escapeSearchTerm(q: string): string {
  return q.replace(/[%_]/g, "\\$&").replace(/[(),.]/g, " ").trim();
}

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const url = new URL(request.url);

    const qRaw = url.searchParams.get("q")?.trim().slice(0, MAX_SEARCH_LEN);
    const limitRaw = url.searchParams.get("limit");
    const cursorRaw = url.searchParams.get("cursor");
    const paginated = qRaw !== undefined || limitRaw !== null || cursorRaw !== null;

    const canSeeEmails = canManageMembers(ctx.role);

    const toMember = (row: ProfileRow): AccountMember[] => {
      // Defensive: the DB enum should never let an unknown role
      // through, but if a migration ever broadens the enum without
      // updating TS, skip the row rather than crash the page.
      if (!isAccountRole(row.account_role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.account_role,
          joined_at: row.created_at,
        },
      ];
    };

    // ---------- Legacy mode: full list, unchanged shape ----------
    if (!paginated) {
      const { data, error } = await ctx.supabase
        .from("profiles")
        .select(
          "user_id, full_name, email, avatar_url, account_role, created_at",
        )
        .eq("account_id", ctx.accountId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("[GET /api/account/members] fetch error:", error);
        return NextResponse.json(
          { error: "Failed to load members" },
          { status: 500 },
        );
      }

      const members = (data as ProfileRow[]).flatMap(toMember);
      return NextResponse.json({ members });
    }

    // ---------- Paginated mode ----------
    const limit = Math.min(
      Math.max(Number.parseInt(limitRaw ?? "", 10) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const cursor = parseCursor(cursorRaw);

    let query = ctx.supabase
      .from("profiles")
      .select("user_id, full_name, email, avatar_url, account_role, created_at")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true })
      .order("user_id", { ascending: true })
      // Over-fetch by one row to know whether a next page exists
      // without a second count round trip.
      .limit(limit + 1);

    if (qRaw) {
      const term = escapeSearchTerm(qRaw);
      if (term) {
        query = query.or(`full_name.ilike.%${term}%,email.ilike.%${term}%`);
      }
    }
    if (cursor) {
      // Keyset: strictly after (created_at, user_id) of the previous
      // page's last row. Two-clause OR expresses the tuple compare.
      query = query.or(
        `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},user_id.gt.${cursor.userId})`,
      );
    }

    // Role summary — four indexed head-counts in parallel with the
    // page query. Head counts return no row payload, so this stays
    // cheap regardless of roster size.
    const summaryPromises = ACCOUNT_ROLES.map((role) =>
      ctx.supabase
        .from("profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("account_id", ctx.accountId)
        .eq("account_role", role),
    );

    const [pageResult, ...summaryResults] = await Promise.all([
      query,
      ...summaryPromises,
    ]);

    const { data, error } = pageResult;
    if (error) {
      console.error("[GET /api/account/members] page fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    const rows = (data ?? []) as ProfileRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];

    const summary: Record<AccountRole, number> & { total: number } = {
      total: 0,
      owner: 0,
      admin: 0,
      agent: 0,
      viewer: 0,
    };
    ACCOUNT_ROLES.forEach((role, i) => {
      const count = summaryResults[i]?.count ?? 0;
      summary[role] = count;
      summary.total += count;
    });

    return NextResponse.json({
      members: pageRows.flatMap(toMember),
      next_cursor:
        hasMore && last ? `${last.created_at}|${last.user_id}` : null,
      summary,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
