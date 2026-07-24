// ============================================================
// POST /api/admin/workspaces/[id]/provision-agent
//
// Super-admin agent provisioning: creates an auth user with a
// one-time temporary password and moves them into the target
// workspace with the `agent` role.
//
// Flow (mirrors redeem_invitation's move semantics):
//   1. auth.admin.createUser  — the signup trigger auto-creates a
//      personal account + owner profile for the new user.
//   2. UPDATE profiles        — repoint to the target account as
//      'agent' (move BEFORE deleting so no cascade fires).
//   3. DELETE orphan account  — the empty personal account.
//   4. platform_audit_log     — who provisioned whom, where.
//
// The temporary password is returned ONCE in the response for the
// operator to hand over; it is never stored or logged. The user
// should change it via the normal reset flow.
// ============================================================

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

import { toErrorResponse } from "@/features/auth/lib/account";
import { requireSuperAdmin } from "@/features/auth/lib/super-admin";
import { logPlatformAudit } from "@/features/admin/lib/platform/audit";
import { platformAdmin } from "@/features/admin/lib/platform/admin-client";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** URL-safe temp password: 3 groups of 6, e.g. "kD9mQ2-xW4pL7-nB5cF8". */
function tempPassword(): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(18);
  let out = "";
  for (let i = 0; i < 18; i++) {
    if (i > 0 && i % 6 === 0) out += "-";
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireSuperAdmin();
    const admin = platformAdmin();
    const { id: accountId } = await params;

    const body = (await request.json().catch(() => null)) as {
      email?: unknown;
      full_name?: unknown;
    } | null;

    const email =
      typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const fullName =
      typeof body?.full_name === "string" ? body.full_name.trim() : "";

    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "A valid email is required" },
        { status: 400 },
      );
    }
    if (!fullName || fullName.length > 120) {
      return NextResponse.json(
        { error: "A name (max 120 chars) is required" },
        { status: 400 },
      );
    }

    // Target workspace must exist.
    const { data: account } = await admin
      .from("accounts")
      .select("id, name")
      .eq("id", accountId)
      .maybeSingle();
    if (!account) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    // Refuse duplicate identities up front (clearer than auth's error).
    const { data: existing } = await admin
      .from("profiles")
      .select("user_id")
      .eq("email", email)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 },
      );
    }

    const password = tempPassword();
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });

    if (createErr || !created?.user) {
      console.error("[provision-agent] createUser failed:", createErr);
      return NextResponse.json(
        { error: "Failed to create the user" },
        { status: 500 },
      );
    }
    const userId = created.user.id;

    // The signup trigger gave them a personal account; capture it,
    // move the profile into the target workspace, then clean up.
    const { data: profile } = await admin
      .from("profiles")
      .select("account_id")
      .eq("user_id", userId)
      .maybeSingle();
    const orphanAccountId = profile?.account_id ?? null;

    const { error: moveErr } = await admin
      .from("profiles")
      .update({ account_id: accountId, account_role: "agent" })
      .eq("user_id", userId);

    if (moveErr) {
      console.error("[provision-agent] profile move failed:", moveErr);
      // Compensate: remove the half-provisioned auth user.
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
      return NextResponse.json(
        { error: "Failed to attach the agent to the workspace" },
        { status: 500 },
      );
    }

    if (orphanAccountId && orphanAccountId !== accountId) {
      await admin.from("accounts").delete().eq("id", orphanAccountId);
    }

    await logPlatformAudit(admin, {
      actorId: ctx.userId,
      accountId,
      action: "workspace.agent_provisioned",
      entity: `user:${userId}`,
      after: { email, full_name: fullName, role: "agent" },
    });

    return NextResponse.json(
      {
        agent: { user_id: userId, email, full_name: fullName, role: "agent" },
        // One-time reveal — the operator hands this to the agent, who
        // should immediately change it via the reset-password flow.
        temporary_password: password,
      },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
