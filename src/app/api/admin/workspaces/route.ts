// ============================================================
// /api/admin/workspaces — platform workspace directory.
//
// GET — paginated, searchable list of every tenant account with
// member counts and channel-configured flags. Service-role reads
// behind requireSuperAdmin(); rows are decorated in batch queries,
// never N+1.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/features/auth/lib/account';
import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { platformAdmin } from '@/features/admin/lib/platform/admin-client';

const PAGE_SIZE = 25;
const MAX_SEARCH_LEN = 120;

export async function GET(request: Request) {
  try {
    await requireSuperAdmin();
    const admin = platformAdmin();

    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').slice(0, MAX_SEARCH_LEN).trim();
    const cursor = url.searchParams.get('cursor'); // created_at keyset

    let query = admin
      .from('accounts')
      .select('id, name, owner_user_id, created_at')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (q) {
      const escaped = q
        .replace(/[%_]/g, '\\$&')
        .replace(/[(),.]/g, ' ')
        .trim();
      if (escaped) query = query.ilike('name', `%${escaped}%`);
    }
    if (cursor) query = query.lt('created_at', cursor);

    const { data: rows, error } = await query;
    if (error) {
      console.error('[GET /api/admin/workspaces] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load workspaces' },
        { status: 500 }
      );
    }

    const page = (rows ?? []).slice(0, PAGE_SIZE);
    const nextCursor =
      (rows ?? []).length > PAGE_SIZE
        ? (page[page.length - 1]?.created_at ?? null)
        : null;

    const accountIds = page.map((a) => a.id);
    const ownerIds = [...new Set(page.map((a) => a.owner_user_id))];

    const [membersRes, ownersRes, channelsRes] = await Promise.all([
      accountIds.length
        ? admin
            .from('profiles')
            .select('account_id')
            .in('account_id', accountIds)
        : Promise.resolve({ data: [], error: null }),
      ownerIds.length
        ? admin
            .from('profiles')
            .select('user_id, full_name, email')
            .in('user_id', ownerIds)
        : Promise.resolve({ data: [], error: null }),
      accountIds.length
        ? admin
            .from('channel_configurations')
            .select('account_id, channel, is_active')
            .in('account_id', accountIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const memberCounts = new Map<string, number>();
    for (const p of membersRes.data ?? []) {
      memberCounts.set(p.account_id, (memberCounts.get(p.account_id) ?? 0) + 1);
    }
    const ownerNames = new Map<string, string | null>(
      (ownersRes.data ?? []).map((p) => [
        p.user_id,
        p.full_name || p.email || null,
      ])
    );
    const activeChannels = new Map<string, string[]>();
    for (const c of channelsRes.data ?? []) {
      if (!c.is_active) continue;
      const list = activeChannels.get(c.account_id) ?? [];
      list.push(c.channel);
      activeChannels.set(c.account_id, list);
    }

    return NextResponse.json({
      workspaces: page.map((a) => ({
        id: a.id,
        name: a.name,
        created_at: a.created_at,
        owner_name: ownerNames.get(a.owner_user_id) ?? null,
        member_count: memberCounts.get(a.id) ?? 0,
        active_channels: activeChannels.get(a.id) ?? [],
      })),
      next_cursor: nextCursor,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
