// ============================================================
// /api/support/tickets — user side of the two-way ticketing.
//
//   GET  — list the caller's account's tickets (any member role;
//          RLS also scopes to the account, this is layer 1 of the
//          defense-in-depth stack).
//   POST — create a ticket + its opening message atomically-ish
//          (ticket first, then message; a failed message insert
//          rolls the ticket back so no empty threads exist).
//
// Super admins triage from /api/admin/tickets — deliberately a
// separate surface so cross-tenant reads never share code paths
// with tenant-scoped ones.
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/features/auth/lib/account";
import { platformAdmin } from "@/features/admin/lib/platform/admin-client";
import {
  BODY_MAX,
  SUBJECT_MAX,
  SUBJECT_MIN,
  isTicketCategory,
  isTicketPriority,
} from "@/features/support/lib/tickets";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data, error } = await ctx.supabase
      .from("support_tickets")
      .select(
        "id, subject, category, priority, status, created_by, created_at, updated_at",
      )
      .eq("account_id", ctx.accountId)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error("[GET /api/support/tickets] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load tickets" },
        { status: 500 },
      );
    }

    return NextResponse.json({ tickets: data ?? [] });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const limit = checkRateLimit(
      `support:create:${ctx.userId}`,
      RATE_LIMITS.supportTicketCreate,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as {
      subject?: unknown;
      category?: unknown;
      priority?: unknown;
      description?: unknown;
    } | null;

    const subject =
      typeof body?.subject === "string" ? body.subject.trim() : "";
    if (subject.length < SUBJECT_MIN || subject.length > SUBJECT_MAX) {
      return NextResponse.json(
        {
          error: `Subject must be between ${SUBJECT_MIN} and ${SUBJECT_MAX} characters`,
        },
        { status: 400 },
      );
    }

    const description =
      typeof body?.description === "string" ? body.description.trim() : "";
    if (description.length < 1 || description.length > BODY_MAX) {
      return NextResponse.json(
        { error: `Description must be 1–${BODY_MAX} characters` },
        { status: 400 },
      );
    }

    const category = isTicketCategory(body?.category) ? body.category : "other";
    const priority = isTicketPriority(body?.priority)
      ? body.priority
      : "normal";

    const { data: ticket, error: ticketErr } = await ctx.supabase
      .from("support_tickets")
      .insert({
        account_id: ctx.accountId,
        created_by: ctx.userId,
        subject,
        category,
        priority,
      })
      .select(
        "id, subject, category, priority, status, created_by, created_at, updated_at",
      )
      .single();

    if (ticketErr || !ticket) {
      console.error("[POST /api/support/tickets] insert error:", ticketErr);
      return NextResponse.json(
        { error: "Failed to create ticket" },
        { status: 500 },
      );
    }

    const { error: msgErr } = await ctx.supabase
      .from("support_ticket_messages")
      .insert({
        ticket_id: ticket.id,
        author_id: ctx.userId,
        is_admin_reply: false,
        body: description,
      });

    if (msgErr) {
      // No empty threads: roll the ticket back so the user can retry
      // cleanly instead of ending up with a subject-only shell. RLS
      // deliberately grants nobody DELETE on tickets, so this
      // server-internal compensation uses the service-role client —
      // scoped to the exact row we just created in this request.
      console.error("[POST /api/support/tickets] message error:", msgErr);
      await platformAdmin()
        .from("support_tickets")
        .delete()
        .eq("id", ticket.id);
      return NextResponse.json(
        { error: "Failed to create ticket" },
        { status: 500 },
      );
    }

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (err) {
    return toErrorResponse(err);
  }
}
