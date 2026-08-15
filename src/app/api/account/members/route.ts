// ============================================================
// GET /api/account/members
//
// Lists members of the caller's account. Any member can call it
// (the Users tab is shown to managers, but read-only members see
// a roster too).
//
// Query params (all optional — omitting them preserves the legacy
// full-list response shape used by the automation builder and
// settings overview):
//
//   status  — active | inactive | deleted  (default: active)
//   q       — case-insensitive search across full_name / email.
//   limit   — page size (1..100). Presence of `limit` or `q` or
//             `cursor` switches to paginated mode.
//   cursor  — keyset cursor: `<created_at>|<user_id>` of the last
//             row of the previous page.
//
// Paginated responses include:
//   next_cursor — pass back as `cursor` for the next page; null
//                 when this is the last page.
//   summary     — { active, inactive, deleted, invited } counts
//                 for the whole account (independent of q/paging),
//                 computed by indexed head-count queries — never
//                 by shipping every row to the client.
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller
//   holds members:manage. Others see name + avatar + role info.
// ============================================================

import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  toErrorResponse,
} from '@/features/auth/lib/account';
import type { AccountMember } from '@/types';

/** One row as returned by the `list_account_members` RPC. */
interface MemberRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
  status: string | null;
  workspace_profile_id: string | null;
  workspace_profile_name: string | null;
  workspace_role_id: string | null;
  workspace_role_name: string | null;
  is_owner: boolean;
}

const MEMBER_STATUSES = ['active', 'inactive', 'deleted'] as const;
type MemberStatus = (typeof MEMBER_STATUSES)[number];

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LEN = 120;

/** Parse `<created_at>|<user_id>` keyset cursors. Returns null on garbage. */
function parseCursor(
  raw: string | null
): { createdAt: string; userId: string } | null {
  if (!raw) return null;
  const idx = raw.lastIndexOf('|');
  if (idx <= 0 || idx === raw.length - 1) return null;
  const createdAt = raw.slice(0, idx);
  const userId = raw.slice(idx + 1);
  if (Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, userId };
}

// The PostgREST `or=` escaper that used to live here is gone: search
// is now a bound `p_q` parameter inside list_account_members, so the
// term never reaches a filter grammar that needs escaping.

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const url = new URL(request.url);

    const qRaw = url.searchParams.get('q')?.trim().slice(0, MAX_SEARCH_LEN);
    const limitRaw = url.searchParams.get('limit');
    const cursorRaw = url.searchParams.get('cursor');
    const statusRaw = url.searchParams.get('status');
    const paginated =
      qRaw !== undefined ||
      limitRaw !== null ||
      cursorRaw !== null ||
      statusRaw !== null;

    const status: MemberStatus = MEMBER_STATUSES.includes(
      statusRaw as MemberStatus
    )
      ? (statusRaw as MemberStatus)
      : 'active';

    const canSeeEmails = ctx.capabilities.canManageMembers;
    const ownerUserId = await getOwnerUserId(ctx.supabase, ctx.accountId);

    const toMember = (row: MemberRow): AccountMember => ({
      user_id: row.user_id,
      full_name: row.full_name ?? '',
      email: canSeeEmails ? row.email : null,
      avatar_url: row.avatar_url,
      // Deprecated enum kept for legacy consumers (automation
      // builder assignee pickers etc.) until they migrate.
      role: (row.account_role as AccountMember['role']) ?? 'viewer',
      joined_at: row.created_at,
      status: (row.status as AccountMember['status']) ?? 'active',
      // The RPC derives this from account_members.role, but the
      // accounts.owner_user_id lookup stays authoritative.
      is_owner: row.is_owner || row.user_id === ownerUserId,
      workspace_profile:
        row.workspace_profile_id && row.workspace_profile_name
          ? {
              id: row.workspace_profile_id,
              name: row.workspace_profile_name,
            }
          : null,
      workspace_role:
        row.workspace_role_id && row.workspace_role_name
          ? { id: row.workspace_role_id, name: row.workspace_role_name }
          : null,
    });

    // ---------- Legacy mode: full list, unchanged shape ----------
    if (!paginated) {
      const { data, error } = await ctx.supabase.rpc('list_account_members', {
        p_status: 'active',
        p_q: null,
        p_limit: MAX_PAGE_SIZE,
        p_cursor_created: null,
        p_cursor_user: null,
      });

      if (error) {
        console.error('[GET /api/account/members] fetch error:', error);
        return NextResponse.json(
          { error: 'Failed to load members' },
          { status: 500 }
        );
      }

      const members = ((data ?? []) as MemberRow[]).map(toMember);
      return NextResponse.json({ members });
    }

    // ---------- Paginated mode ----------
    const limit = Math.min(
      Math.max(Number.parseInt(limitRaw ?? '', 10) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE
    );
    const cursor = parseCursor(cursorRaw);

    // Both the page and the counts now come from `account_members`,
    // the authoritative per-account grant. Listing from `profiles`
    // (as this route used to) reported each user's GLOBAL status and
    // their role in whatever workspace they had last switched to, so
    // deactivating somebody here never changed what this endpoint
    // returned. See 20260814100000_account_members_listing.sql.
    const [pageResult, countsResult] = await Promise.all([
      ctx.supabase.rpc('list_account_members', {
        p_status: status,
        p_q: qRaw ?? null,
        // Over-fetch by one row to know whether a next page exists
        // without a second count round trip.
        p_limit: limit + 1,
        p_cursor_created: cursor?.createdAt ?? null,
        p_cursor_user: cursor?.userId ?? null,
      }),
      ctx.supabase.rpc('count_account_members'),
    ]);

    const { data, error } = pageResult;
    if (error) {
      console.error('[GET /api/account/members] page fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load members' },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as MemberRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];

    if (countsResult.error) {
      console.error(
        '[GET /api/account/members] count error:',
        countsResult.error
      );
    }
    // `count_account_members` returns a single row; it already excludes
    // invitations belonging to people who have since joined, so an
    // accepted invite stops inflating the "Invited" pill.
    const counts = (
      (countsResult.data ?? []) as {
        active: number;
        inactive: number;
        deleted: number;
        invited: number;
      }[]
    )[0];
    const summary: Record<string, number> = {
      active: Number(counts?.active ?? 0),
      inactive: Number(counts?.inactive ?? 0),
      deleted: Number(counts?.deleted ?? 0),
      invited: Number(counts?.invited ?? 0),
    };

    return NextResponse.json({
      members: pageRows.map(toMember),
      next_cursor:
        hasMore && last ? `${last.created_at}|${last.user_id}` : null,
      summary,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// Small cached-per-request helper: the owner flag drives the
// "Super Admin" profile column, so every list needs it once.
async function getOwnerUserId(
  supabase: Awaited<ReturnType<typeof getCurrentAccount>>['supabase'],
  accountId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .maybeSingle();
  return data?.owner_user_id ?? null;
}
