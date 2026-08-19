// ============================================================
// /api/admin/ai-config — per-tenant AI agent provisioning for the
// super-admin console. This is how a new customer's bot gets set
// up FOR them: provider, model, key, persona, behaviour.
//
//   GET  ?account_id=…  — the workspace's `ai_agents` default row
//                         (safe fields + has_key flags, NEVER the
//                         key) plus the member roster for the
//                         handoff picker.
//   PUT                 — upsert the workspace's kind='default'
//                         agent. The key is validated against the
//                         provider first, then AES-256-GCM
//                         encrypted with the same ENCRYPTION_KEY
//                         the tenant's own routes use, so the bot
//                         runtime (loadAgentConfig) reads it
//                         identically.
//   DELETE ?account_id=… — remove the agent (bot off, key
//                         forgotten). Also the recovery path for
//                         a corrupted key.
//
// WHY ai_agents AND NOT ai_configs: every runtime path — the
// auto-reply engine, the inbox draft route, the playground — loads
// its config through `loadAgentConfig`, which reads `ai_agents`.
// While this route wrote `ai_configs`, provisioning a workspace here
// produced a complete, correct row that NOTHING consumed: the bot
// stayed silent and the console reported success. Migration
// 20260819120000 carries the rows written before this fix across.
//
// Every mutation writes platform_audit_log — never any secret
// material, only shape flags (has_key, has_tuning) and non-secret
// fields.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/features/auth/lib/account';
import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { logPlatformAudit } from '@/features/admin/lib/platform/audit';
import { platformAdmin } from '@/lib/supabase/admin';
import { encrypt, decrypt } from '@/lib/crypto/secrets';
import { validateAiCredentials } from '@/features/assistant/lib/ai/validate';
import { OLLAMA_PLACEHOLDER_KEY } from '@/features/assistant/lib/ai/defaults';
import { fetchAgentRow } from '@/features/assistant/lib/ai/agents';
import {
  AiError,
  AI_PROVIDERS,
  DEFAULT_REASONING_MODE,
  isAiProvider,
  isAutoReplyLimitMode,
  isReasoningMode,
  normalizeTuning,
  type AiProvider,
  type AutoReplyLimitMode,
  type GenerationTuning,
  type ReasoningMode,
} from '@/features/assistant/lib/ai/types';

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Display name for a workspace the platform provisions on the
 *  customer's behalf. The tenant can rename it afterwards. */
const PROVISIONED_AGENT_NAME = 'AI Assistant';

/** Postgres/JSON 'HH:MM:SS' or 'HH:MM' → 'HH:MM' | null. Mirrors the
 *  reader in agents.ts so the console shows what the engine evaluates. */
function toHhMm(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const m = /^(\d{2}:\d{2})/.exec(value);
  return m ? m[1] : null;
}

export async function GET(request: Request) {
  try {
    await requireSuperAdmin();
    const admin = platformAdmin();

    const accountId = new URL(request.url).searchParams.get('account_id');
    if (!accountId) return bad('account_id is required');

    const [agent, membersRes] = await Promise.all([
      fetchAgentRow(admin, accountId),
      admin
        .from('profiles')
        .select('user_id, full_name, email, account_role')
        .eq('account_id', accountId)
        .order('created_at', { ascending: true }),
    ]);

    const members = membersRes.data ?? [];
    if (!agent) return NextResponse.json({ configured: false, members });

    const settings = (agent.settings ?? {}) as Record<string, unknown>;
    const cap = Number(settings.replyCap);

    return NextResponse.json({
      configured: true,
      // The key itself NEVER leaves the server after save — the console
      // only learns whether one is stored.
      has_key: !!agent.api_key,
      has_embeddings_key:
        typeof settings.embeddingsApiKey === 'string' &&
        settings.embeddingsApiKey.length > 0,
      members,
      provider: agent.provider,
      model: agent.model,
      base_url: agent.base_url,
      system_prompt: agent.system_prompt,
      // Master switch + the two independent capability columns, exactly
      // as the runtime reads them.
      is_active: agent.is_enabled,
      suggestions_enabled: agent.suggestions_enabled,
      auto_reply_enabled: agent.autoreply_enabled,
      auto_reply_max_per_conversation:
        Number.isFinite(cap) && cap >= 1 ? Math.floor(cap) : 3,
      auto_reply_limit_mode: isAutoReplyLimitMode(settings.limitMode)
        ? settings.limitMode
        : 'per_conversation',
      auto_reply_schedule_start: toHhMm(settings.scheduleStart),
      auto_reply_schedule_end: toHhMm(settings.scheduleEnd),
      auto_reply_timezone:
        typeof settings.timezone === 'string' && settings.timezone
          ? settings.timezone
          : null,
      handoff_agent_id:
        typeof settings.handoffAgentId === 'string' && settings.handoffAgentId
          ? settings.handoffAgentId
          : null,
      reasoning: isReasoningMode(settings.reasoning)
        ? settings.reasoning
        : DEFAULT_REASONING_MODE,
      // Clamped on read as well as write, so a hand-edited row shows the
      // console the same values generation will actually send.
      tuning: normalizeTuning(settings.tuning),
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
    if (!body || typeof body !== 'object') return bad('Invalid request body');

    const accountId =
      typeof body.account_id === 'string' ? body.account_id : '';
    if (!accountId) return bad('account_id is required');

    if (!isAiProvider(body.provider)) {
      return bad(`provider must be one of: ${AI_PROVIDERS.join(', ')}`);
    }
    const provider: AiProvider = body.provider;
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model) return bad('model is required');

    // Base URL rules mirror the tenant routes exactly: required
    // + https-only for `custom`; optional (http allowed) for `ollama`.
    let baseUrl: string | null = null;
    if (provider === 'custom' || provider === 'ollama') {
      const rawBaseUrl =
        typeof body.base_url === 'string'
          ? body.base_url.trim().replace(/\/+$/, '')
          : '';
      if (!rawBaseUrl && provider === 'custom') {
        return bad('base_url is required for the custom provider');
      }
      if (rawBaseUrl) {
        let parsed: URL;
        try {
          parsed = new URL(rawBaseUrl);
        } catch {
          return bad('base_url must be a valid URL');
        }
        if (provider === 'custom' && parsed.protocol !== 'https:') {
          return bad('base_url must use https');
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return bad('base_url must be an http(s) URL');
        }
        baseUrl = rawBaseUrl;
      }
    }

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null;
    if (systemPrompt && systemPrompt.length > 8000) {
      return bad('system_prompt is too long (max 8000 characters)');
    }

    const isActive = body.is_active === true;
    // Drafts default ON with the master switch: an older console build
    // that doesn't send the field must not silently disable them.
    const suggestionsEnabled =
      typeof body.suggestions_enabled === 'boolean'
        ? body.suggestions_enabled
        : isActive;
    const autoReplyEnabled = body.auto_reply_enabled === true;

    let maxPer = Number(body.auto_reply_max_per_conversation);
    if (!Number.isFinite(maxPer)) maxPer = 3;
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)));

    const limitMode: AutoReplyLimitMode = isAutoReplyLimitMode(
      body.auto_reply_limit_mode
    )
      ? body.auto_reply_limit_mode
      : 'per_conversation';

    // Reply hours: both bounds or neither (always on). Half-open input
    // reads as "always on", same rule as the tenant parser.
    const rawStart =
      typeof body.auto_reply_schedule_start === 'string'
        ? body.auto_reply_schedule_start.trim()
        : '';
    const rawEnd =
      typeof body.auto_reply_schedule_end === 'string'
        ? body.auto_reply_schedule_end.trim()
        : '';
    let scheduleStart: string | null = null;
    let scheduleEnd: string | null = null;
    if (rawStart && rawEnd) {
      if (!HHMM.test(rawStart) || !HHMM.test(rawEnd)) {
        return bad('schedule times must be HH:MM (24-hour)');
      }
      scheduleStart = rawStart;
      scheduleEnd = rawEnd;
    }

    const rawTz =
      typeof body.auto_reply_timezone === 'string'
        ? body.auto_reply_timezone.trim()
        : '';
    let timezone: string | null = null;
    if (rawTz && scheduleStart) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: rawTz });
        timezone = rawTz;
      } catch {
        return bad('timezone must be a valid IANA timezone');
      }
    }

    // Rejected rather than coerced: reasoning costs real tokens and can
    // truncate a customer's reply, so a typo must not read back as a
    // mode the operator never chose.
    let reasoning: ReasoningMode = DEFAULT_REASONING_MODE;
    if ('reasoning' in body) {
      if (!isReasoningMode(body.reasoning)) {
        return bad('reasoning must be one of: off, auto, on');
      }
      reasoning = body.reasoning;
    }

    // Expert sampling knobs — super-admin-only surface. Explicit null
    // wipes them back to "send no sampling params" instead of leaving a
    // stale temperature behind.
    const tuning: GenerationTuning =
      body.tuning === null ? {} : normalizeTuning(body.tuning);

    // Handoff target must belong to the TARGET workspace — the whole
    // point of this console is acting on another tenant's behalf, so
    // the membership check runs against accountId, not the caller's.
    const rawHandoff =
      typeof body.handoff_agent_id === 'string'
        ? body.handoff_agent_id.trim()
        : '';
    let handoffAgentId: string | null = null;
    if (rawHandoff) {
      const { data: member } = await admin
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle();
      if (!member) {
        return bad('handoff_agent_id must be a member of the workspace');
      }
      handoffAgentId = rawHandoff;
    }

    let rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';

    // Reuse the stored key when the form didn't send a fresh one.
    let existing: Awaited<ReturnType<typeof fetchAgentRow>> = null;
    try {
      existing = await fetchAgentRow(admin, accountId);
    } catch (e) {
      console.error('[PUT /api/admin/ai-config] fetch error:', e);
      return NextResponse.json(
        { error: 'Failed to load the workspace agent' },
        { status: 500 }
      );
    }

    // Ollama ignores auth — persist the harmless placeholder so the row
    // counts as "configured" (same rule as the tenant routes).
    if (!rawKey && provider === 'ollama' && !existing?.api_key) {
      rawKey = OLLAMA_PLACEHOLDER_KEY;
    }

    let apiKeyPlain: string;
    if (rawKey) {
      apiKeyPlain = rawKey;
    } else if (existing?.api_key) {
      try {
        apiKeyPlain = decrypt(existing.api_key);
      } catch {
        return bad('Stored API key could not be decrypted — re-enter the key.');
      }
    } else {
      return bad('api_key is required');
    }

    // Verify-before-save, but only when reachability inputs changed —
    // a save that just edits the system prompt or flips a toggle must
    // not burn a provider round-trip on the tenant's key.
    const credentialsChanged =
      !existing ||
      rawKey !== '' ||
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
          autoReplyLimitMode: limitMode,
          autoReplyScheduleStart: null,
          autoReplyScheduleEnd: null,
          autoReplyTimezone: null,
          handoffAgentId: null,
          embeddingsApiKey: null,
          keySource: 'account',
        });
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 }
          );
        }
        console.error('[PUT /api/admin/ai-config] validation error:', err);
        return bad('Could not validate the API key with the provider.');
      }
    }

    // Shallow-merge the settings jsonb — same rule as the tenant PATCH:
    // keys this console doesn't own (personaConfig, triggerKeywords, the
    // encrypted embeddings key) must survive a platform save.
    const settings: Record<string, unknown> = {
      ...((existing?.settings ?? {}) as Record<string, unknown>),
      replyCap: maxPer,
      limitMode,
      scheduleStart: scheduleStart,
      scheduleEnd: scheduleEnd,
      timezone,
      handoffAgentId,
      reasoning,
      tuning,
    };

    const shared: Record<string, unknown> = {
      provider,
      model,
      base_url: baseUrl,
      system_prompt: systemPrompt,
      is_enabled: isActive,
      suggestions_enabled: suggestionsEnabled,
      autoreply_enabled: autoReplyEnabled,
      settings,
    };

    const encryptedKey = rawKey ? encrypt(rawKey) : null;

    if (existing) {
      const { error: upErr } = await admin
        .from('ai_agents')
        .update(encryptedKey ? { ...shared, api_key: encryptedKey } : shared)
        .eq('id', existing.id);
      if (upErr) {
        console.error('[PUT /api/admin/ai-config] update error:', upErr);
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 }
        );
      }
    } else {
      const { error: insErr } = await admin.from('ai_agents').insert({
        account_id: accountId,
        created_by: ctx.userId,
        kind: 'default',
        display_name: PROVISIONED_AGENT_NAME,
        api_key: encryptedKey, // non-null: rawKey required when no existing row
        ...shared,
      });
      if (insErr) {
        console.error('[PUT /api/admin/ai-config] insert error:', insErr);
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 }
        );
      }
    }

    await logPlatformAudit(admin, {
      actorId: ctx.userId,
      accountId,
      action: existing ? 'ai_agent.updated' : 'ai_agent.provisioned',
      entity: `ai_agent:${accountId}`,
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
        suggestions_enabled: suggestionsEnabled,
        auto_reply_enabled: autoReplyEnabled,
        // Shape flags only — never a secret, never a prompt.
        reasoning,
        has_tuning: Object.keys(tuning).length > 0,
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

    const accountId = new URL(request.url).searchParams.get('account_id');
    if (!accountId) return bad('account_id is required');

    const { data, error } = await admin
      .from('ai_agents')
      .delete()
      .eq('account_id', accountId)
      .eq('kind', 'default')
      .select('provider, model');
    if (error) {
      console.error('[DELETE /api/admin/ai-config] error:', error);
      return NextResponse.json(
        { error: 'Failed to remove AI configuration' },
        { status: 500 }
      );
    }

    const removed = data?.[0];
    if (removed) {
      await logPlatformAudit(admin, {
        actorId: ctx.userId,
        accountId,
        action: 'ai_agent.removed',
        entity: `ai_agent:${accountId}`,
        before: { provider: removed.provider, model: removed.model },
        after: null,
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
