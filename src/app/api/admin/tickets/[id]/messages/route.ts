// ============================================================
// /api/admin/tickets/[id]/messages — platform-operator reply.
//
// POST — append an admin reply (is_admin_reply = true). Unless the
// operator says otherwise, replying flips the ticket to
// `waiting_on_user` (ball is in the user's court) and implicitly
// assigns the ticket to the replying admin if unassigned. Audited.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/features/auth/lib/account';
import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { logPlatformAudit } from '@/features/admin/lib/platform/audit';
import { platformAdmin } from '@/features/admin/lib/platform/admin-client';
import { BODY_MAX, isTicketStatus } from '@/features/support/lib/tickets';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requireSuperAdmin();
    const admin = platformAdmin();
    const { id } = await params;

    const limit = checkRateLimit(
      `support:adminReply:${ctx.userId}`,
      RATE_LIMITS.supportReply
    );
    if (!limit.success) return rateLimitResponse(limit);

    const payload = (await request.json().catch(() => null)) as {
      body?: unknown;
      status?: unknown;
    } | null;

    const body = typeof payload?.body === 'string' ? payload.body.trim() : '';
    if (body.length < 1 || body.length > BODY_MAX) {
      return NextResponse.json(
        { error: `Message must be 1–${BODY_MAX} characters` },
        { status: 400 }
      );
    }
    // Optional status override alongside the reply (e.g. reply +
    // resolve in one action). Defaults to waiting_on_user.
    const nextStatus = isTicketStatus(payload?.status)
      ? payload.status
      : 'waiting_on_user';

    const { data: ticket, error: ticketErr } = await admin
      .from('support_tickets')
      .select('id, account_id, status, assigned_admin')
      .eq('id', id)
      .maybeSingle();

    if (ticketErr) {
      console.error(
        '[POST /api/admin/tickets/:id/messages] ticket error:',
        ticketErr
      );
      return NextResponse.json(
        { error: 'Failed to send reply' },
        { status: 500 }
      );
    }
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const { data: message, error: msgErr } = await admin
      .from('support_ticket_messages')
      .insert({
        ticket_id: id,
        author_id: ctx.userId,
        is_admin_reply: true,
        body,
      })
      .select('id, ticket_id, author_id, is_admin_reply, body, created_at')
      .single();

    if (msgErr || !message) {
      console.error(
        '[POST /api/admin/tickets/:id/messages] insert error:',
        msgErr
      );
      return NextResponse.json(
        { error: 'Failed to send reply' },
        { status: 500 }
      );
    }

    const { data: updated } = await admin
      .from('support_tickets')
      .update({
        status: nextStatus,
        // First responder claims the ticket automatically.
        assigned_admin: ticket.assigned_admin ?? ctx.userId,
      })
      .eq('id', id)
      .select('id, status, assigned_admin, updated_at')
      .single();

    await logPlatformAudit(admin, {
      actorId: ctx.userId,
      accountId: ticket.account_id,
      action: 'ticket.admin_replied',
      entity: `support_ticket:${id}`,
      before: { status: ticket.status, assigned_admin: ticket.assigned_admin },
      after: {
        status: updated?.status ?? nextStatus,
        assigned_admin: updated?.assigned_admin ?? ctx.userId,
      },
    });

    return NextResponse.json(
      { message, ticket: updated ?? null },
      { status: 201 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
