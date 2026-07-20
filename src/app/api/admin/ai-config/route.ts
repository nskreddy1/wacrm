// ============================================================
// /api/admin/ai-config — per-tenant AI agent provisioning for the
// super-admin console. This is how a new customer's bot gets set
// up FOR them: provider, model, key, system prompt, auto-reply.
//
//   GET  ?account_id=…  — the workspace's ai_configs row (safe
//                         fields + has_key flags, NEVER the key)
//                         plus the member roster for the handoff
//                         picker.
//   PUT                 — upsert the workspace's AI config. The
//                         key is validated against the provider
//                         first, then AES-256-GCM encrypted with
//                         the same ENCRYPTION_KEY the workspace-
//                         level /api/ai/config route uses, so the
//                         bot runtime (loadAiConfig) reads it
//                         identically.
//   DELETE ?account_id=… — remove the config (bot off, key
//                         forgotten). Also the recovery path for
//                         a corrupted key.
//
// Every mutation writes platform_audit_log — never any secret
// material, only shape flags (has_key) and non-secret fields.
// ============================================================

import { NextResponse } from "next/server";

import { toErrorResponse } from "@/lib/auth/account";
import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { logPlatformAudit } from "@/lib/platform/audit";
import { platformAdmin } from "@/lib/platform/admin-client";
import { encrypt, decrypt } from "@/lib/whatsapp/encryption";
import { validateAiCredentials } from "@/lib/ai/validate";
import { OLLAMA_PLACEHOLDER_KEY } from "@/lib/ai/defaults";
import {
  AiError,
  AI_PROVIDERS,
  isAiProvider,
  type AiProvider,
} from "@/lib/ai/types";

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Everything the console form needs — the two key columns are
 *  selected only to derive has_* flags and stripped before responding. */
const FORM_COLUMNS =
  "provider, model, base_url, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, api_key, embeddings_api_key";

export async function GET(request: Request) {
  try {
    await requireSuperAdmin();
    const admin = platformAdmin();

    const accountId = new URL(request.url).searchParams.get("account_id");
    if (!accountId) return bad("account_id is required");

    const [configRes, membersRes] = await Promise.all([
      admin
        .from("ai_configs")
        .select(FORM_COLUMNS)
        .eq("account_id", accountId)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("user_id, full_name, email, account_role")
        .eq("account_id", accountId)
        .order("created_at", { ascending: true }),
    ]);

    if (configRes.error) {
      console.error("[GET /api/admin/ai-config] fetch error:", configRes.error);
      return NextResponse.json(
        { error: "Failed to load AI configuration" },
        { status: 500 },
      );
    }

    const members = membersRes.data ?? [];

    if (!configRes.data) {
      return NextResponse.json({ configured: false, members });
    }

    const { api_key, embeddings_api_key, ...safe } = configRes.data;
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      members,
      ...safe,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await requireSuperAdmin();
    const admin = platformAdmin();

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return bad("Invalid request body");

    const accountId =
      typeof body.account_id === "string" ? body.account_id : "";
    if (!accountId) return bad("account_id is required");

    if (!isAiProvider(body.provider)) {
      return bad(`provider must be one of: ${AI_PROVIDERS.join(", ")}`);
    }
    const provider: AiProvider = body.provider;
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model) return bad("model is required");

    // Base URL rules mirror the workspace-level route exactly: required
    // + https-only for `custom`; optional (http allowed) for `ollama`.
    let baseUrl: string | null = null;
    if (provider === "custom" || provider === "ollama") {
      const rawBaseUrl =
        typeof body.base_url === "string"
          ? body.base_url.trim().replace(/\/+$/, "")
          : "";
      if (!rawBaseUrl && provider === "custom") {
        return bad("base_url is required for the custom provider");
      }
      if (rawBaseUrl) {
        let parsed: URL;
        try {
          parsed = new URL(rawBaseUrl);
        } catch {
          return bad("base_url must be a valid URL");
        }
        if (provider === "custom" && parsed.protocol !== "https:") {
          return bad("base_url must use https");
        }
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          return bad("base_url must be an http(s) URL");
        }
        baseUrl = rawBaseUrl;
      }
    }

    const systemPrompt =
      typeof body.system_prompt === "string" && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null;
    const isActive = body.is_active === true;
    const autoReplyEnabled = body.auto_reply_enabled === true;

    let maxPer = Number(body.auto_reply_max_per_conversation);
    if (!Number.isFinite(maxPer)) maxPer = 3;
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)));

    // Handoff target must belong to the TARGET workspace — the whole
    // point of this console is acting on another tenant's behalf, so
    // the membership check runs against accountId, not the caller's.
    const rawHandoff =
      typeof body.handoff_agent_id === "string"
        ? body.handoff_agent_id.trim()
        : "";
    let handoffAgentId: string | null = null;
    if (rawHandoff) {
      const { data: member } = await admin
        .from("profiles")
        .select("user_id")
        .eq("account_id", accountId)
        .eq("user_id", rawHandoff)
        .maybeSingle();
      if (!member) {
        return bad("handoff_agent_id must be a member of the workspace");
      }
      handoffAgentId = rawHandoff;
    }

    let rawKey = typeof body.api_key === "string" ? body.api_key.trim() : "";

    // Reuse the stored key when the form didn't send a fresh one.
    const { data: existing } = await admin
      .from("ai_configs")
      .select("id, provider, model, api_key, base_url")
      .eq("account_id", accountId)
      .maybeSingle();

    // Ollama ignores auth — persist the harmless placeholder so the row
    // counts as "configured" (same rule as the workspace-level route).
    if (!rawKey && provider === "ollama" && !existing?.api_key) {
      rawKey = OLLAMA_PLACEHOLDER_KEY;
    }

    let apiKeyPlain: string;
    if (rawKey) {
      apiKeyPlain = rawKey;
    } else if (existing?.api_key) {
      try {
        apiKeyPlain = decrypt(existing.api_key);
      } catch {
        return bad(
          "Stored API key could not be decrypted — re-enter the key.",
        );
      }
    } else {
      return bad("api_key is required");
    }

    // Verify-before-save, but only when reachability inputs changed —
    // a save that just edits the system prompt or flips a toggle must
    // not burn a provider round-trip on the tenant's key.
    const credentialsChanged =
      !existing ||
      rawKey !== "" ||
      provider !== existing.provider ||
      model !== existing.model ||
      baseUrl !== (existing.base_url ?? null);

    if (credentialsChanged) {
      try {
        await validateAiCredentials({
          provider,
          model,
          apiKey: apiKeyPlain,
          baseUrl,
          systemPrompt,
          isActive,
          autoReplyEnabled,
          autoReplyMaxPerConversation: maxPer,
          handoffAgentId: null,
          embeddingsApiKey: null,
          keySource: "account",
        });
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 },
          );
        }
        console.error("[PUT /api/admin/ai-config] validation error:", err);
        return bad("Could not validate the API key with the provider.");
      }
    }

    const shared: Record<string, unknown> = {
      provider,
      model,
      base_url: baseUrl,
      system_prompt: systemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
      handoff_agent_id: handoffAgentId,
    };

    const encryptedKey = rawKey ? encrypt(rawKey) : null;

    if (existing) {
      const { error: upErr } = await admin
        .from("ai_configs")
        .update(encryptedKey ? { ...shared, api_key: encryptedKey } : shared)
        .eq("account_id", accountId);
      if (upErr) {
        console.error("[PUT /api/admin/ai-config] update error:", upErr);
        return NextResponse.json(
          { error: "Failed to save AI configuration" },
          { status: 500 },
        );
      }
    } else {
      const { error: insErr } = await admin.from("ai_configs").insert({
        account_id: accountId,
        created_by: ctx.userId,
        api_key: encryptedKey, // non-null: rawKey required when no existing row
        ...shared,
      });
      if (insErr) {
        console.error("[PUT /api/admin/ai-config] insert error:", insErr);
        return NextResponse.json(
          { error: "Failed to save AI configuration" },
          { status: 500 },
        );
      }
    }

    await logPlatformAudit(admin, {
      actorId: ctx.userId,
      accountId,
      action: existing ? "ai_agent.updated" : "ai_agent.provisioned",
      entity: `ai_config:${accountId}`,
      before: existing
        ? {
            provider: existing.provider,
            model: existing.model,
            has_key: !!existing.api_key,
          }
        : null,
      after: {
        provider,
        model,
        has_key: true,
        is_active: isActive,
        auto_reply_enabled: autoReplyEnabled,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireSuperAdmin();
    const admin = platformAdmin();

    const accountId = new URL(request.url).searchParams.get("account_id");
    if (!accountId) return bad("account_id is required");

    const { data: existing } = await admin
      .from("ai_configs")
      .select("provider, model")
      .eq("account_id", accountId)
      .maybeSingle();

    const { error } = await admin
      .from("ai_configs")
      .delete()
      .eq("account_id", accountId);
    if (error) {
      console.error("[DELETE /api/admin/ai-config] error:", error);
      return NextResponse.json(
        { error: "Failed to remove AI configuration" },
        { status: 500 },
      );
    }

    if (existing) {
      await logPlatformAudit(admin, {
        actorId: ctx.userId,
        accountId,
        action: "ai_agent.removed",
        entity: `ai_config:${accountId}`,
        before: { provider: existing.provider, model: existing.model },
        after: null,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
