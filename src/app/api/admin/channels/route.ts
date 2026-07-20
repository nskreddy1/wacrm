// ============================================================
// /api/admin/channels — per-tenant channel provider credentials.
//
//   GET  ?account_id=…  — configuration status for one workspace
//                         (masked previews only, NEVER ciphertext).
//   PUT                 — upsert a channel config. Credentials are
//                         AES-256-GCM encrypted server-side before
//                         they touch the database; the response
//                         echoes only the masked preview.
//   PATCH               — flip is_active / run a decrypt round-trip
//                         "test" without resupplying secrets.
//
// Every mutation writes platform_audit_log (no secret material in
// the before/after payloads — masked previews only).
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { logPlatformAudit } from "@/lib/platform/audit";
import { platformAdmin } from "@/lib/platform/admin-client";
import {
  decryptCredentials,
  encryptCredentials,
  hasCredentialsKey,
  maskPreview,
} from "@/lib/platform/channel-crypto";

const CHANNELS = ["whatsapp", "sms", "email", "voice"] as const;
type Channel = (typeof CHANNELS)[number];

function isChannel(v: unknown): v is Channel {
  return typeof v === "string" && (CHANNELS as readonly string[]).includes(v);
}

const SAFE_COLUMNS =
  "id, account_id, channel, provider, masked_preview, is_active, verified_at, updated_at";

export async function GET(request: Request) {
  try {
    await requireSuperAdmin();
    const admin = platformAdmin();

    const accountId = new URL(request.url).searchParams.get("account_id");
    if (!accountId) {
      return NextResponse.json(
        { error: "account_id is required" },
        { status: 400 },
      );
    }

    const { data, error } = await admin
      .from("channel_configurations")
      .select(SAFE_COLUMNS)
      .eq("account_id", accountId);

    if (error) {
      console.error("[GET /api/admin/channels] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load channel configurations" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      channels: data ?? [],
      encryption_ready: hasCredentialsKey(),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireSuperAdmin();
    const admin = platformAdmin();

    const body = (await request.json().catch(() => null)) as {
      account_id?: unknown;
      channel?: unknown;
      provider?: unknown;
      credentials?: unknown; // Record<string, string> of secret fields
    } | null;

    const accountId =
      typeof body?.account_id === "string" ? body.account_id : "";
    const provider =
      typeof body?.provider === "string" ? body.provider.trim() : "";

    if (!accountId || !isChannel(body?.channel) || !provider) {
      return NextResponse.json(
        { error: "account_id, channel and provider are required" },
        { status: 400 },
      );
    }
    const channel = body.channel;

    const credentials =
      body?.credentials && typeof body.credentials === "object"
        ? (body.credentials as Record<string, unknown>)
        : null;
    const entries = Object.entries(credentials ?? {}).filter(
      (e): e is [string, string] =>
        typeof e[1] === "string" && e[1].trim().length > 0,
    );
    if (entries.length === 0) {
      return NextResponse.json(
        { error: "At least one credential field is required" },
        { status: 400 },
      );
    }
    if (!hasCredentialsKey()) {
      return NextResponse.json(
        {
          error:
            "CHANNEL_CREDENTIALS_KEY is not configured on the server — set it before storing credentials",
        },
        { status: 503 },
      );
    }

    // Mask off the FIRST credential value (conventionally the account
    // SID / API key id) — a recognisable, non-secret hint.
    const masked = maskPreview(entries[0][1]);
    const ciphertext = encryptCredentials(
      JSON.stringify(Object.fromEntries(entries)),
    );

    const { data: before } = await admin
      .from("channel_configurations")
      .select("id, provider, masked_preview, is_active")
      .eq("account_id", accountId)
      .eq("channel", channel)
      .maybeSingle();

    const { data: saved, error } = await admin
      .from("channel_configurations")
      .upsert(
        {
          account_id: accountId,
          channel,
          provider,
          encrypted_credentials: ciphertext,
          masked_preview: masked,
          configured_by: ctx.userId,
          verified_at: null, // new secrets are unverified until tested
        },
        { onConflict: "account_id,channel" },
      )
      .select(SAFE_COLUMNS)
      .single();

    if (error || !saved) {
      console.error("[PUT /api/admin/channels] upsert error:", error);
      return NextResponse.json(
        { error: "Failed to save channel configuration" },
        { status: 500 },
      );
    }

    await logPlatformAudit(admin, {
      actorId: ctx.userId,
      accountId,
      action: before
        ? "channel.credentials_rotated"
        : "channel.credentials_configured",
      entity: `channel_configuration:${saved.id}`,
      before: before
        ? {
            provider: before.provider,
            masked_preview: before.masked_preview,
            is_active: before.is_active,
          }
        : null,
      after: { provider, masked_preview: masked },
    });

    return NextResponse.json({ channel: saved });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireSuperAdmin();
    const admin = platformAdmin();

    const body = (await request.json().catch(() => null)) as {
      account_id?: unknown;
      channel?: unknown;
      is_active?: unknown;
      action?: unknown; // 'test'
    } | null;

    const accountId =
      typeof body?.account_id === "string" ? body.account_id : "";
    if (!accountId || !isChannel(body?.channel)) {
      return NextResponse.json(
        { error: "account_id and channel are required" },
        { status: 400 },
      );
    }
    const channel = body.channel;

    // --- Test connection: decrypt round-trip + shape validation. ---
    if (body?.action === "test") {
      const { data: row } = await admin
        .from("channel_configurations")
        .select("id, encrypted_credentials")
        .eq("account_id", accountId)
        .eq("channel", channel)
        .maybeSingle();

      if (!row?.encrypted_credentials) {
        return NextResponse.json(
          { error: "No credentials stored for this channel" },
          { status: 404 },
        );
      }
      try {
        const json = decryptCredentials(String(row.encrypted_credentials));
        const parsed = JSON.parse(json) as Record<string, unknown>;
        if (Object.keys(parsed).length === 0) throw new Error("empty");
      } catch {
        return NextResponse.json(
          { error: "Stored credentials failed integrity verification" },
          { status: 422 },
        );
      }

      const { data: verified } = await admin
        .from("channel_configurations")
        .update({ verified_at: new Date().toISOString() })
        .eq("id", row.id)
        .select(SAFE_COLUMNS)
        .single();

      return NextResponse.json({ ok: true, channel: verified });
    }

    // --- Activation toggle. ---
    if (typeof body?.is_active !== "boolean") {
      return NextResponse.json(
        { error: "is_active boolean or action:'test' is required" },
        { status: 400 },
      );
    }

    const { data: before } = await admin
      .from("channel_configurations")
      .select("id, is_active")
      .eq("account_id", accountId)
      .eq("channel", channel)
      .maybeSingle();
    if (!before) {
      return NextResponse.json(
        { error: "Channel is not configured yet" },
        { status: 404 },
      );
    }

    const { data: updated, error } = await admin
      .from("channel_configurations")
      .update({ is_active: body.is_active })
      .eq("id", before.id)
      .select(SAFE_COLUMNS)
      .single();

    if (error || !updated) {
      console.error("[PATCH /api/admin/channels] toggle error:", error);
      return NextResponse.json(
        { error: "Failed to update channel" },
        { status: 500 },
      );
    }

    await logPlatformAudit(admin, {
      actorId: ctx.userId,
      accountId,
      action: body.is_active ? "channel.activated" : "channel.deactivated",
      entity: `channel_configuration:${before.id}`,
      before: { is_active: before.is_active },
      after: { is_active: updated.is_active },
    });

    return NextResponse.json({ channel: updated });
  } catch (err) {
    return toErrorResponse(err);
  }
}
