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

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  created_at: string;
  status: string | null;
  workspace_profile_id: string | null;
  workspace_profiles: { id: string; name: string } | null;
  workspace_role: { id: string; name: string } | null;
}

const MEMBER_STATUSES = ['active', 'inactive', 'deleted'] as const;
type MemberStatus = (typeof MEMBER_STATUSES)[number];

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LEN = 120;

const SELECT_COLUMNS =
  'user_id, full_name, email, avatar_url, account_role, created_at, status, workspace_profile_id, workspace_profiles(id, name), workspace_role:workspace_roles(id, name)';

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

/**
 * Escape PostgREST `or=` filter syntax inside a user-supplied search
 * term: commas/parens are structural in the filter grammar, and `%`
 * and `_` are LIKE wildcards.
 */
function escapeSearchTerm(q: string): string {
  return q
    .replace(/[%_]/g, '\\$&')
    .replace(/[(),.]/g, ' ')
    .trim();
}

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

    const toMember = (row: ProfileRow): AccountMember => ({
      user_id: row.user_id,
      full_name: row.full_name ?? '',
      email: canSeeEmails ? row.email : null,
      avatar_url: row.avatar_url,
      // Deprecated enum kept for legacy consumers (automation
      // builder assignee pickers etc.) until they migrate.
      role: (row.account_role as AccountMember['role']) ?? 'viewer',
      joined_at: row.created_at,
      status: (row.status as AccountMember['status']) ?? 'active',
      is_owner: row.user_id === ownerUserId,
      workspace_profile: row.workspace_profiles
        ? { id: row.workspace_profiles.id, name: row.workspace_profiles.name }
        : null,
      workspace_role: row.workspace_role
        ? { id: row.workspace_role.id, name: row.workspace_role.name }
        : null,
    });

    // ---------- Legacy mode: full list, unchanged shape ----------
    if (!paginated) {
      const { data, error } = await ctx.supabase
        .from('profiles')
        .select(SELECT_COLUMNS)
        .eq('account_id', ctx.accountId)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[GET /api/account/members] fetch error:', error);
        return NextResponse.json(
          { error: 'Failed to load members' },
          { status: 500 }
        );
      }

      const members = (data as unknown as ProfileRow[]).map(toMember);
      return NextResponse.json({ members });
    }

    // ---------- Paginated mode ----------
    const limit = Math.min(
      Math.max(Number.parseInt(limitRaw ?? '', 10) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE
    );
    const cursor = parseCursor(cursorRaw);

    let query = ctx.supabase
      .from('profiles')
      .select(SELECT_COLUMNS)
      .eq('account_id', ctx.accountId)
      .eq('status', status)
      .order('created_at', { ascending: true })
      .order('user_id', { ascending: true })
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
        `created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},user_id.gt.${cursor.userId})`
      );
    }

    // Status summary — indexed head-counts in parallel with the page
    // query (plus pending invitations for the "Invited" pill). Head
    // counts return no row payload, so this stays cheap at scale.
    const statusCountPromises = MEMBER_STATUSES.map((s) =>
      ctx.supabase
        .from('profiles')
        .select('user_id', { count: 'exact', head: true })
        .eq('account_id', ctx.accountId)
        .eq('status', s)
    );
    const invitedCountPromise = ctx.supabase
      .from('account_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .is('accepted_at', null)
      .gt('expires_at', new Date().toISOString());

    const [pageResult, invitedResult, ...statusResults] = await Promise.all([
      query,
      invitedCountPromise,
      ...statusCountPromises,
    ]);

    const { data, error } = pageResult;
    if (error) {
      console.error('[GET /api/account/members] page fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load members' },
        { status: 500 }
      );
    }

    const rows = (data ?? []) as unknown as ProfileRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];

    const summary: Record<string, number> = {
      invited: invitedResult.count ?? 0,
    };
    MEMBER_STATUSES.forEach((s, i) => {
      summary[s] = statusResults[i]?.count ?? 0;
    });

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
