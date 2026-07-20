// ============================================================
// /api/admin/workspaces/[id] — single-tenant detail for the
// super-admin console: account row + full member roster + channel
// configuration status (masked previews only — never ciphertext).
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { platformAdmin } from "@/lib/platform/admin-client";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSuperAdmin();
    const admin = platformAdmin();
    const { id } = await params;

    const { data: account, error: accountErr } = await admin
      .from("accounts")
      .select("id, name, owner_user_id, created_at")
      .eq("id", id)
      .maybeSingle();

    if (accountErr) {
      console.error("[GET /api/admin/workspaces/:id] fetch error:", accountErr);
      return NextResponse.json(
        { error: "Failed to load workspace" },
        { status: 500 },
      );
    }
    if (!account) {
      return NextResponse.json(
        { error: "Workspace not found" },
        { status: 404 },
      );
    }

    const [membersRes, channelsRes] = await Promise.all([
      admin
        .from("profiles")
        .select("user_id, full_name, email, account_role, created_at")
        .eq("account_id", id)
        .order("created_at", { ascending: true }),
      admin
        .from("channel_configurations")
        .select(
          "channel, provider, masked_preview, is_active, verified_at, updated_at",
        )
        .eq("account_id", id),
    ]);

    if (membersRes.error) {
      console.error(
        "[GET /api/admin/workspaces/:id] members error:",
        membersRes.error,
      );
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      workspace: account,
      members: membersRes.data ?? [],
      channels: channelsRes.data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
