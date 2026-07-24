// ============================================================
// /api/admin/tickets — platform-operator ticket queue.
//
// GET — all-tenant ticket list with filters (status / priority /
// category / free-text account search). Sits behind
// requireSuperAdmin() (layer 1); reads go through the service
// role because the queue needs cross-tenant joins (account name,
// creator profile) that per-tenant RLS on `accounts`/`profiles`
// would blank out. Every row returned is decorated, never raw.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/features/auth/lib/account';
import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { platformAdmin } from '@/features/admin/lib/platform/admin-client';
import {
  isTicketCategory,
  isTicketPriority,
  isTicketStatus,
} from '@/features/support/lib/tickets';

const PAGE_SIZE = 50;

export async function GET(request: Request) {
  try {
    await requireSuperAdmin();
    const admin = platformAdmin();

    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const priority = url.searchParams.get('priority');
    const category = url.searchParams.get('category');
    const accountId = url.searchParams.get('account_id');
    const cursor = url.searchParams.get('cursor'); // updated_at keyset

    let query = admin
      .from('support_tickets')
      .select(
        'id, account_id, subject, category, priority, status, assigned_admin, created_by, created_at, updated_at'
      )
      .order('updated_at', { ascending: false })
      .limit(PAGE_SIZE + 1);

    if (isTicketStatus(status)) query = query.eq('status', status);
    if (isTicketPriority(priority)) query = query.eq('priority', priority);
    if (isTicketCategory(category)) query = query.eq('category', category);
    if (accountId) query = query.eq('account_id', accountId);
    if (cursor) query = query.lt('updated_at', cursor);

    const { data: rows, error } = await query;
    if (error) {
      console.error('[GET /api/admin/tickets] fetch error:', error);
      return NextResponse.json(
        { error: 'Failed to load tickets' },
        { status: 500 }
      );
    }

    const page = (rows ?? []).slice(0, PAGE_SIZE);
    const nextCursor =
      (rows ?? []).length > PAGE_SIZE
        ? (page[page.length - 1]?.updated_at ?? null)
        : null;

    // Decorate with account names + creator names in two batch
    // queries (never N+1).
    const accountIds = [...new Set(page.map((t) => t.account_id))];
    const creatorIds = [...new Set(page.map((t) => t.created_by))];

    const [accountsRes, profilesRes, lastUserMsgRes] = await Promise.all([
      accountIds.length
        ? admin.from('accounts').select('id, name').in('id', accountIds)
        : Promise.resolve({ data: [], error: null }),
      creatorIds.length
        ? admin
            .from('profiles')
            .select('user_id, full_name, email')
            .in('user_id', creatorIds)
        : Promise.resolve({ data: [], error: null }),
      // SLA hint: latest USER message per listed ticket. One query,
      // reduced in JS (first hit per ticket wins — rows are sorted
      // newest-first).
      page.length
        ? admin
            .from('support_ticket_messages')
            .select('ticket_id, created_at')
            .in(
              'ticket_id',
              page.map((t) => t.id)
            )
            .eq('is_admin_reply', false)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    const accountNames = new Map<string, string>(
      (accountsRes.data ?? []).map((a) => [a.id, a.name])
    );
    const creatorNames = new Map<string, string | null>(
      (profilesRes.data ?? []).map((p) => [
        p.user_id,
        p.full_name || p.email || null,
      ])
    );
    const lastUserMessageAt = new Map<string, string>();
    for (const m of lastUserMsgRes.data ?? []) {
      if (!lastUserMessageAt.has(m.ticket_id)) {
        lastUserMessageAt.set(m.ticket_id, m.created_at);
      }
    }

    return NextResponse.json({
      tickets: page.map((t) => ({
        ...t,
        account_name: accountNames.get(t.account_id) ?? 'Unknown workspace',
        created_by_name: creatorNames.get(t.created_by) ?? null,
        last_user_message_at: lastUserMessageAt.get(t.id) ?? null,
      })),
      next_cursor: nextCursor,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
