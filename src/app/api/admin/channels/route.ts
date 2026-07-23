// ============================================================
// /api/admin/channels — platform (founder/support) console for
// client channel connections. Operates on the SAME
// channel_connections table the client's Settings → WhatsApp/SMS
// pages use, so what support provisions here is exactly what the
// client sees and what message sending uses. No parallel tables.
//
//   GET    ?account_id=…   — all connections for one workspace.
//   PUT                    — provision a new platform-managed
//                            connection OR update any existing one
//                            (client- or platform-managed): support
//                            can fix a client's broken config.
//   PATCH                  — enable/disable, or action:'test' → runs
//                            the real provider adapter health check.
//   DELETE ?id=…&account_id=… — remove a connection.
//
// Rules of engagement:
//   • New rows provisioned here get managed_by='platform' — clients
//     can enable/disable them but not edit credentials (enforced in
//     /api/settings/channels).
//   • Editing an existing client row keeps managed_by='workspace'
//     unless takeover=true is passed explicitly.
//   • Credentials are AES-256-GCM encrypted with the same helper the
//     workspace route uses; secrets never round-trip to the browser.
//   • Every mutation writes platform_audit_log (masked, no secrets).
// ============================================================

import { NextResponse } from "next/server";
import { z } from "zod";

import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { logPlatformAudit } from "@/lib/platform/audit";
import { platformAdmin } from "@/lib/platform/admin-client";
import { createChannelAdapter } from "@/lib/channels/adapters";
import {
  buildProviderCredentials,
  encryptProviderCredentials,
} from "@/lib/channels/credentials";
import {
  getProviderCapabilities,
  isProviderCompatible,
  PROVIDER_CHANNELS,
  PROVIDER_LABEL,
} from "@/lib/channels/provider-registry";
import type {
  ChannelConnection,
  ChannelKind,
  ChannelProvider,
} from "@/types";

const providers = ["meta", "twilio", "google", "microsoft", "resend", "smtp"] as const;
const channels = ["whatsapp", "sms", "email"] as const;

const SAFE_COLUMNS =
  "id,account_id,created_by_user_id,channel,provider,display_name,external_account_id,external_identity,configuration,status,is_enabled,is_primary,managed_by,last_connected_at,last_synced_at,last_error,created_at,updated_at";

const putSchema = z.object({
  account_id: z.string().uuid(),
  id: z.string().uuid().optional(),
  channel: z.enum(channels),
  provider: z.enum(providers),
  displayName: z.string().trim().min(1).max(120),
  externalIdentity: z.string().trim().min(1).max(320),
  configuration: z.record(z.string(), z.unknown()).default({}),
  credentials: z.record(z.string(), z.string()).optional(),
  /** Explicitly convert a client-managed row to platform-managed. */
  takeover: z.boolean().optional(),
});

const patchSchema = z.object({
  account_id: z.string().uuid(),
  id: z.string().uuid(),
  action: z.literal("test").optional(),
  isEnabled: z.boolean().optional(),
});

function enrich(connection: Record<string, unknown>) {
  const provider = connection.provider as ChannelProvider;
  const channel = connection.channel as ChannelKind;
  return {
    ...connection,
    providerLabel: PROVIDER_LABEL[provider],
    capabilities: getProviderCapabilities(provider, channel),
  };
}

export async function GET(request: Request) {
  try {
    await requireSuperAdmin();
    const admin = platformAdmin();

    const accountId = new URL(request.url).searchParams.get("account_id");
    if (!accountId) {
      return NextResponse.json({ error: "account_id is required" }, { status: 400 });
    }

    const { data, error } = await admin
      .from("channel_connections")
      .select(SAFE_COLUMNS)
      .eq("account_id", accountId)
      .order("channel")
      .order("created_at");
    if (error) {
      console.error("[GET /api/admin/channels] fetch error:", error);
      return NextResponse.json({ error: "Failed to load channel connections" }, { status: 500 });
    }

    // Provider offerings mirror the workspace settings page so the
    // provision dialog only offers providers that actually work.
    const offerings = providers.flatMap((provider) =>
      PROVIDER_CHANNELS[provider].map((channel) => ({
        provider,
        channel,
        label: PROVIDER_LABEL[provider],
        available: Boolean(createChannelAdapter(provider, channel)),
      })),
    );

    return NextResponse.json({
      connections: (data ?? []).map(enrich),
      providers: offerings.filter((o) => o.available),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireSuperAdmin();
    const admin = platformAdmin();

    const parsed = putSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid channel connection payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { account_id: accountId, channel, provider } = parsed.data;

    if (!isProviderCompatible(channel as ChannelKind, provider as ChannelProvider)) {
      return NextResponse.json({ error: `${provider} is not compatible with ${channel}` }, { status: 400 });
    }
    if (!createChannelAdapter(provider as ChannelProvider, channel as ChannelKind)) {
      return NextResponse.json(
        { error: `${PROVIDER_LABEL[provider as ChannelProvider]} setup is not available in this release` },
        { status: 409 },
      );
    }

    const suppliedCredentials = buildProviderCredentials(provider, parsed.data.credentials);

    let existing: Record<string, unknown> | null = null;
    if (parsed.data.id) {
      const result = await admin
        .from("channel_connections")
        .select("*")
        .eq("id", parsed.data.id)
        .eq("account_id", accountId)
        .maybeSingle();
      if (result.error) throw result.error;
      existing = result.data;
      if (!existing) {
        return NextResponse.json({ error: "Channel connection not found" }, { status: 404 });
      }
      if (existing.provider !== provider && !suppliedCredentials) {
        return NextResponse.json(
          { error: "New credentials are required when switching providers" },
          { status: 400 },
        );
      }
    }

    const credentialsEncrypted = suppliedCredentials
      ? encryptProviderCredentials(suppliedCredentials)
      : (existing?.credentials_encrypted as string | undefined);
    if (!credentialsEncrypted) {
      return NextResponse.json({ error: "Provider credentials are required" }, { status: 400 });
    }

    // managed_by semantics: new rows here are platform-provisioned;
    // existing rows keep their origin unless support explicitly takes
    // the connection over.
    const managedBy = existing
      ? parsed.data.takeover
        ? "platform"
        : (existing.managed_by as string)
      : "platform";

    const values = {
      account_id: accountId,
      created_by_user_id: (existing?.created_by_user_id as string | undefined) ?? ctx.userId,
      channel,
      provider,
      display_name: parsed.data.displayName,
      external_identity: parsed.data.externalIdentity,
      configuration: parsed.data.configuration,
      credentials_encrypted: credentialsEncrypted,
      managed_by: managedBy,
      status: "draft", // must pass a connection test before enabling
      is_enabled: false,
      last_error: null,
    };

    const query = parsed.data.id
      ? admin.from("channel_connections").update(values).eq("id", parsed.data.id).eq("account_id", accountId)
      : admin.from("channel_connections").insert(values);
    const { data: saved, error } = await query.select(SAFE_COLUMNS).single();
    if (error || !saved) {
      // Unique violation: same sender already connected on this channel.
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return NextResponse.json(
          { error: "A connection with this sender identity already exists for this channel." },
          { status: 409 },
        );
      }
      console.error("[PUT /api/admin/channels] save error:", error);
      return NextResponse.json({ error: "Failed to save channel connection" }, { status: 500 });
    }

    await logPlatformAudit(admin, {
      actorId: ctx.userId,
      accountId,
      action: existing
        ? suppliedCredentials
          ? "channel.credentials_rotated"
          : "channel.updated"
        : "channel.provisioned",
      entity: `channel_connection:${saved.id}`,
      before: existing
        ? {
            provider: existing.provider,
            display_name: existing.display_name,
            external_identity: existing.external_identity,
            managed_by: existing.managed_by,
          }
        : null,
      after: {
        provider,
        display_name: parsed.data.displayName,
        external_identity: parsed.data.externalIdentity,
        managed_by: managedBy,
      },
    });

    return NextResponse.json({ connection: enrich(saved) }, { status: parsed.data.id ? 200 : 201 });
  } catch (err) {
    if (err instanceof Error && err.message.includes("ENCRYPTION_KEY")) {
      console.error("[admin/channels] ENCRYPTION_KEY misconfigured:", err.message);
      return NextResponse.json(
        { error: "Server is missing the ENCRYPTION_KEY environment variable (64-char hex)." },
        { status: 503 },
      );
    }
    if (err instanceof Error && /required|Messaging Service SID/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireSuperAdmin();
    const admin = platformAdmin();

    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid channel update" }, { status: 400 });
    }
    const { account_id: accountId, id } = parsed.data;

    const { data: row, error } = await admin
      .from("channel_connections")
      .select("*")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return NextResponse.json({ error: "Channel connection not found" }, { status: 404 });

    // --- Test connection via the real provider adapter. ---
    if (parsed.data.action === "test") {
      const adapter = createChannelAdapter(row.provider as ChannelProvider, row.channel as ChannelKind);
      if (!adapter) {
        return NextResponse.json(
          { error: `${PROVIDER_LABEL[row.provider as ChannelProvider]} testing is not available` },
          { status: 409 },
        );
      }
      const health = await adapter.checkHealth(row as ChannelConnection);
      const update = health.ok
        ? { status: "connected", last_connected_at: health.checkedAt, last_error: null }
        : { status: "degraded", is_enabled: false, last_error: health.error };
      const { data: updated } = await admin
        .from("channel_connections")
        .update(update)
        .eq("id", row.id)
        .select(SAFE_COLUMNS)
        .single();
      await logPlatformAudit(admin, {
        actorId: ctx.userId,
        accountId,
        action: health.ok ? "channel.test_passed" : "channel.test_failed",
        entity: `channel_connection:${row.id}`,
        before: null,
        after: { ok: health.ok, ...(health.ok ? {} : { error: health.error }) },
      });
      if (!health.ok) return NextResponse.json({ health, connection: updated ? enrich(updated) : null }, { status: 422 });
      return NextResponse.json({ health, connection: updated ? enrich(updated) : null });
    }

    // --- Enable / disable toggle. ---
    if (typeof parsed.data.isEnabled !== "boolean") {
      return NextResponse.json({ error: "isEnabled boolean or action:'test' is required" }, { status: 400 });
    }
    if (parsed.data.isEnabled && !["connected", "degraded"].includes(row.status as string)) {
      return NextResponse.json({ error: "Run a connection test before enabling" }, { status: 409 });
    }
    const { data: updated, error: updateError } = await admin
      .from("channel_connections")
      .update({ is_enabled: parsed.data.isEnabled })
      .eq("id", row.id)
      .select(SAFE_COLUMNS)
      .single();
    if (updateError || !updated) {
      console.error("[PATCH /api/admin/channels] toggle error:", updateError);
      return NextResponse.json({ error: "Failed to update channel connection" }, { status: 500 });
    }

    await logPlatformAudit(admin, {
      actorId: ctx.userId,
      accountId,
      action: parsed.data.isEnabled ? "channel.activated" : "channel.deactivated",
      entity: `channel_connection:${row.id}`,
      before: { is_enabled: row.is_enabled },
      after: { is_enabled: updated.is_enabled },
    });

    return NextResponse.json({ connection: enrich(updated) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireSuperAdmin();
    const admin = platformAdmin();

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const accountId = url.searchParams.get("account_id");
    if (!id || !accountId) {
      return NextResponse.json({ error: "id and account_id are required" }, { status: 400 });
    }

    const { data: row } = await admin
      .from("channel_connections")
      .select("id, channel, provider, display_name, external_identity, managed_by")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!row) return NextResponse.json({ error: "Channel connection not found" }, { status: 404 });

    const { error } = await admin.from("channel_connections").delete().eq("id", row.id);
    if (error) {
      console.error("[DELETE /api/admin/channels] delete error:", error);
      return NextResponse.json({ error: "Failed to delete channel connection" }, { status: 500 });
    }

    await logPlatformAudit(admin, {
      actorId: ctx.userId,
      accountId,
      action: "channel.deleted",
      entity: `channel_connection:${row.id}`,
      before: {
        channel: row.channel,
        provider: row.provider,
        display_name: row.display_name,
        external_identity: row.external_identity,
        managed_by: row.managed_by,
      },
      after: null,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
