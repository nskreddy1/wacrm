// ============================================================
// POST /api/inbox/conversations — open the thread for a contact.
//
// The inbox's "New conversation" flow (ADR-006 D13/D14). The agent picks
// a contact and lands in a real thread; they then compose from the
// thread itself, where the composer already derives the 24-hour service
// window from `conversations.last_inbound_at` and refuses free-form on a
// cold thread.
//
// Deliberately does NOT send anything. Sending stays behind the single
// guarded choke point (`/api/whatsapp/send` → `sendChannelMessage` →
// `evaluateOutboundWindow`), so this route cannot become a second way to
// reach Meta. All it does is resolve a row id.
//
// Gated on `messages:send`: opening a thread writes a `conversations`
// row and surfaces it in every teammate's inbox, so a viewer must not be
// able to do it. `conversations_insert` RLS enforces the same thing one
// layer down — this check exists to return a clean 403 instead of an
// opaque database error.
// ============================================================

import { NextResponse } from 'next/server';

import {
  requirePermission,
  toErrorResponse,
} from '@/features/auth/lib/account';
import { ensureConversationForContact } from '@/features/inbox/lib/ensure-conversation';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission('messages:send');

    // Own bucket, separate from `send:` — opening a thread is cheap but
    // it is still an INSERT driven straight off a click, so a stuck
    // picker must not be able to spray rows.
    const limit = await checkRateLimit(
      `inboxConversation:${ctx.userId}`,
      RATE_LIMITS.send
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      contact_id?: unknown;
    } | null;

    const contactId =
      typeof body?.contact_id === 'string' && body.contact_id.trim()
        ? body.contact_id.trim()
        : null;

    if (!contactId) {
      return NextResponse.json(
        { error: "'contact_id' is required" },
        { status: 400 }
      );
    }

    const result = await ensureConversationForContact(
      ctx.supabase,
      ctx.accountId,
      ctx.userId,
      contactId
    );

    if (!result.ok) {
      return result.reason === 'contact_not_found'
        ? NextResponse.json({ error: 'Contact not found' }, { status: 404 })
        : NextResponse.json(
            { error: 'Failed to open a conversation for this contact' },
            { status: 500 }
          );
    }

    return NextResponse.json({
      conversation_id: result.conversationId,
      created: result.created,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
