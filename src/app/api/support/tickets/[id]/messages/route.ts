// ============================================================
// /api/support/tickets/[id]/messages — user-side reply.
//
// POST — append a user message to the thread. Any account member
// may reply on their account's tickets (a colleague can pick up a
// teammate's ticket). Replying to a ticket the platform marked
// `waiting_on_user` flips it back to `open` so the admin queue's
// "needs attention" sort stays honest. Replies to resolved/closed
// tickets are rejected — reopening is an explicit admin action.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/features/auth/lib/account";
import { BODY_MAX } from "@/features/support/lib/tickets";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    const { id } = await params;

    const limit = checkRateLimit(
      `support:reply:${ctx.userId}`,
      RATE_LIMITS.supportReply,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const payload = (await request.json().catch(() => null)) as {
      body?: unknown;
    } | null;
    const body =
      typeof payload?.body === "string" ? payload.body.trim() : "";
    if (body.length < 1 || body.length > BODY_MAX) {
      return NextResponse.json(
        { error: `Message must be 1–${BODY_MAX} characters` },
        { status: 400 },
      );
    }

    // Confirm the ticket belongs to the caller's account and is
    // still conversational (layer 1; RLS re-checks membership).
    const { data: ticket, error: ticketErr } = await ctx.supabase
      .from("support_tickets")
      .select("id, status, created_by")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (ticketErr) {
      console.error(
        "[POST /api/support/tickets/:id/messages] ticket error:",
        ticketErr,
      );
      return NextResponse.json(
        { error: "Failed to send message" },
        { status: 500 },
      );
    }
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    if (ticket.status === "resolved" || ticket.status === "closed") {
      return NextResponse.json(
        { error: "This ticket is closed. Open a new ticket instead." },
        { status: 409 },
      );
    }

    const { data: message, error: msgErr } = await ctx.supabase
      .from("support_ticket_messages")
      .insert({
        ticket_id: id,
        author_id: ctx.userId,
        is_admin_reply: false,
        body,
      })
      .select("id, ticket_id, author_id, is_admin_reply, body, created_at")
      .single();

    if (msgErr || !message) {
      console.error(
        "[POST /api/support/tickets/:id/messages] insert error:",
        msgErr,
      );
      return NextResponse.json(
        { error: "Failed to send message" },
        { status: 500 },
      );
    }

    // A user reply on a waiting_on_user ticket puts the ball back in
    // the platform's court. The RLS update policy is creator-only, so
    // only the creator's replies flip the status — a teammate's reply
    // still lands in the thread (best-effort; ignore a policy miss).
    if (ticket.status === "waiting_on_user") {
      await ctx.supabase
        .from("support_tickets")
        .update({ status: "open" })
        .eq("id", id)
        .eq("created_by", ctx.userId);
    } else {
      // Bump updated_at so the queue sorts by real activity.
      await ctx.supabase
        .from("support_tickets")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("created_by", ctx.userId);
    }

    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
