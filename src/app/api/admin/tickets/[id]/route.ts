// ============================================================
// /api/admin/tickets/[id] — platform-operator single ticket.
//
//   GET   — ticket + thread + account/author decoration.
//   PATCH — assignment ({ assign: "me" | null }) and status
//           transitions ({ status }). Every mutation writes a
//           platform_audit_log entry (immutable, insert-only).
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { logPlatformAudit } from "@/lib/platform/audit";
import { platformAdmin } from "@/lib/platform/admin-client";
import { isTicketStatus } from "@/lib/support/tickets";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin();
    const admin = platformAdmin();
    const { id } = await params;

    const { data: ticket, error: ticketErr } = await admin
      .from("support_tickets")
      .select(
        "id, account_id, subject, category, priority, status, assigned_admin, created_by, created_at, updated_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (ticketErr) {
      console.error("[GET /api/admin/tickets/:id] fetch error:", ticketErr);
      return NextResponse.json(
        { error: "Failed to load ticket" },
        { status: 500 },
      );
    }
    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const { data: messages, error: msgErr } = await admin
      .from("support_ticket_messages")
      .select("id, ticket_id, author_id, is_admin_reply, body, created_at")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true });

    if (msgErr) {
      console.error("[GET /api/admin/tickets/:id] messages error:", msgErr);
      return NextResponse.json(
        { error: "Failed to load messages" },
        { status: 500 },
      );
    }

    const authorIds = [...new Set((messages ?? []).map((m) => m.author_id))];
    const [accountRes, profilesRes] = await Promise.all([
      admin
        .from("accounts")
        .select("id, name")
        .eq("id", ticket.account_id)
        .maybeSingle(),
      authorIds.length
        ? admin
            .from("profiles")
            .select("user_id, full_name, email")
            .in("user_id", authorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const names = new Map<string, string | null>(
      (profilesRes.data ?? []).map((p) => [
        p.user_id,
        p.full_name || p.email || null,
      ]),
    );

    return NextResponse.json({
      ticket: {
        ...ticket,
        account_name: accountRes.data?.name ?? "Unknown workspace",
        created_by_name: names.get(ticket.created_by) ?? null,
      },
      messages: (messages ?? []).map((m) => ({
        ...m,
        author_name: names.get(m.author_id) ?? null,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireSuperAdmin();
    const admin = platformAdmin();
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as {
      status?: unknown;
      assign?: unknown;
    } | null;

    const patch: Record<string, unknown> = {};
    if (body?.status !== undefined) {
      if (!isTicketStatus(body.status)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      }
      patch.status = body.status;
    }
    if (body?.assign !== undefined) {
      if (body.assign === "me") patch.assigned_admin = ctx.userId;
      else if (body.assign === null) patch.assigned_admin = null;
      else {
        return NextResponse.json(
          { error: "'assign' must be \"me\" or null" },
          { status: 400 },
        );
      }
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    // Snapshot for the audit before/after diff.
    const { data: before, error: beforeErr } = await admin
      .from("support_tickets")
      .select("id, account_id, status, assigned_admin")
      .eq("id", id)
      .maybeSingle();

    if (beforeErr || !before) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const { data: updated, error } = await admin
      .from("support_tickets")
      .update(patch)
      .eq("id", id)
      .select(
        "id, account_id, subject, category, priority, status, assigned_admin, created_by, created_at, updated_at",
      )
      .single();

    if (error || !updated) {
      console.error("[PATCH /api/admin/tickets/:id] update error:", error);
      return NextResponse.json(
        { error: "Failed to update ticket" },
        { status: 500 },
      );
    }

    await logPlatformAudit(admin, {
      actorId: ctx.userId,
      accountId: before.account_id,
      action:
        patch.status !== undefined ? "ticket.status_changed" : "ticket.assigned",
      entity: `support_ticket:${id}`,
      before: { status: before.status, assigned_admin: before.assigned_admin },
      after: {
        status: updated.status,
        assigned_admin: updated.assigned_admin,
      },
    });

    return NextResponse.json({ ticket: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
