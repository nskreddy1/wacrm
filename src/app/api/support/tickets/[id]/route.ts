// ============================================================
// /api/support/tickets/[id] — user side, single ticket.
//
//   GET   — ticket + full message thread. Any account member
//           (RLS scopes reads to the caller's account).
//   PATCH — creator-only status change; the ONLY transition a
//           user may make is closing their own ticket. All other
//           transitions belong to the admin surface.
//
// Author names: messages are decorated with the author's profile
// name where the caller's RLS can see it (same-account members).
// Admin replies deliberately resolve to null — the UI renders
// them as "Support team" rather than leaking operator identities.
// ============================================================

import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  toErrorResponse,
} from '@/features/auth/lib/account';
import type { SupportTicketMessage } from '@/features/support/lib/tickets';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const { data: ticket, error: ticketErr } = await ctx.supabase
      .from('support_tickets')
      .select(
        'id, subject, category, priority, status, created_by, created_at, updated_at'
      )
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (ticketErr) {
      console.error('[GET /api/support/tickets/:id] fetch error:', ticketErr);
      return NextResponse.json(
        { error: 'Failed to load ticket' },
        { status: 500 }
      );
    }
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const { data: messages, error: msgErr } = await ctx.supabase
      .from('support_ticket_messages')
      .select('id, ticket_id, author_id, is_admin_reply, body, created_at')
      .eq('ticket_id', id)
      .order('created_at', { ascending: true });

    if (msgErr) {
      console.error('[GET /api/support/tickets/:id] messages error:', msgErr);
      return NextResponse.json(
        { error: 'Failed to load messages' },
        { status: 500 }
      );
    }

    // Resolve same-account author names in one query. Admin-reply
    // authors are intentionally excluded (see module comment).
    const userAuthorIds = [
      ...new Set(
        (messages ?? [])
          .filter((m) => !m.is_admin_reply)
          .map((m) => m.author_id)
      ),
    ];
    const names = new Map<string, string | null>();
    if (userAuthorIds.length > 0) {
      const { data: profiles } = await ctx.supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', userAuthorIds);
      for (const p of profiles ?? []) {
        names.set(p.user_id, p.full_name || p.email || null);
      }
    }

    const thread: SupportTicketMessage[] = (messages ?? []).map((m) => ({
      ...m,
      author_name: m.is_admin_reply ? null : (names.get(m.author_id) ?? null),
    }));

    return NextResponse.json({ ticket, messages: thread });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as {
      status?: unknown;
    } | null;

    // The only user-side transition is closing your own ticket.
    if (body?.status !== 'closed') {
      return NextResponse.json(
        { error: "Only 'closed' is allowed here" },
        { status: 400 }
      );
    }

    // Layer-1 guard: creator-only (RLS repeats this check as layer 2).
    const { data: updated, error } = await ctx.supabase
      .from('support_tickets')
      .update({ status: 'closed' })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .eq('created_by', ctx.userId)
      .select('id, status, updated_at')
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/support/tickets/:id] update error:', error);
      return NextResponse.json(
        { error: 'Failed to update ticket' },
        { status: 500 }
      );
    }
    if (!updated) {
      return NextResponse.json(
        { error: 'Ticket not found or not yours to close' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ticket: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
