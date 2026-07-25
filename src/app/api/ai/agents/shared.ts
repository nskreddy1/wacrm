import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encrypt } from '@/features/whatsapp/lib/encryption';
import { validateAiCredentials } from '@/features/assistant/lib/ai/validate';
import { embedTexts } from '@/features/assistant/lib/ai/embeddings';
import {
  AiError,
  AI_PROVIDERS,
  isAiProvider,
  isAutoReplyLimitMode,
  type AiProvider,
} from '@/features/assistant/lib/ai/types';
import { OLLAMA_PLACEHOLDER_KEY } from '@/features/assistant/lib/ai/defaults';

// ============================================================
// Shared request parsing + live validation for the single default
// agent's CRUD routes (POST /api/ai/agents, PATCH /api/ai/agents/[id]).
//
// The agent has one config (provider, key, model, persona) and two
// independently toggleable capabilities, each a first-class column:
// suggestions_enabled (inbox drafts) and autoreply_enabled.
//
// Design: one parser with a `partial` switch instead of two diverging
// validators — create demands a complete, provider-verified agent;
// PATCH validates only the fields present so a toggle flip never
// demands the API key again.
// ============================================================

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Column values ready for insert/update, plus the plaintext key when
 *  the payload carried a new one (encrypt at the write site). */
export interface ParsedAgentPayload {
  values: {
    display_name: string;
    provider: AiProvider | null;
    model: string | null;
    base_url: string | null;
    system_prompt: string | null;
    is_enabled?: boolean;
    suggestions_enabled?: boolean;
    autoreply_enabled?: boolean;
    settings?: Record<string, unknown>;
  };
  /** New plaintext key from this request; null = keep the stored one. */
  plainApiKey: string | null;
  /** Fields actually present in the body (PATCH merge decisions). */
  provided: Set<string>;
}

export async function parseAgentPayload(
  body: Record<string, unknown>,
  opts: {
    partial: boolean;
    supabase: SupabaseClient;
    accountId: string;
  }
): Promise<ParsedAgentPayload | { errorResponse: NextResponse }> {
  const { partial, supabase, accountId } = opts;
  const provided = new Set(Object.keys(body));
  const err = (m: string) => ({ errorResponse: bad(m) });

  // ---- display name --------------------------------------------
  const rawName =
    typeof body.display_name === 'string' ? body.display_name.trim() : '';
  if (!partial && !rawName) return err('display_name is required');
  if (rawName.length > 80) return err('display_name is too long (max 80)');

  // ---- provider / model ----------------------------------------
  let provider: AiProvider | null = null;
  if (provided.has('provider') || !partial) {
    if (!isAiProvider(body.provider)) {
      return err(`provider must be one of: ${AI_PROVIDERS.join(', ')}`);
    }
    provider = body.provider;
  }

  let model: string | null = null;
  if (provided.has('model') || !partial) {
    model = typeof body.model === 'string' ? body.model.trim() : '';
    if (!model) return err('model is required');
  }

  // ---- base URL (custom: required https; ollama: optional http ok)
  let baseUrl: string | null = null;
  if (provider === 'custom' || provider === 'ollama') {
    const rawBaseUrl =
      typeof body.base_url === 'string'
        ? body.base_url.trim().replace(/\/+$/, '')
        : '';
    if (!rawBaseUrl && provider === 'custom') {
      return err('base_url is required for the custom provider');
    }
    if (rawBaseUrl) {
      let parsed: URL;
      try {
        parsed = new URL(rawBaseUrl);
      } catch {
        return err('base_url must be a valid URL');
      }
      if (provider === 'custom' && parsed.protocol !== 'https:') {
        return err('base_url must use https');
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return err('base_url must be an http(s) URL');
      }
      baseUrl = rawBaseUrl;
    }
  }

  // ---- system prompt -------------------------------------------
  const systemPrompt =
    typeof body.system_prompt === 'string' && body.system_prompt.trim()
      ? body.system_prompt.trim()
      : null;
  if (systemPrompt && systemPrompt.length > 8000) {
    return err('system_prompt is too long (max 8000 characters)');
  }

  // ---- API key ---------------------------------------------------
  let plainApiKey =
    typeof body.api_key === 'string' ? body.api_key.trim() : '';
  // Ollama ignores auth — persist a harmless placeholder so the agent
  // still counts as "configured" without demanding a fake key.
  if (!plainApiKey && provider === 'ollama' && !partial) {
    plainApiKey = OLLAMA_PLACEHOLDER_KEY;
  }
  if (!partial && !plainApiKey && provider !== 'ollama') {
    return err('api_key is required');
  }

  // ---- behavior settings -----------------------------------------
  // The single agent owns all behavior knobs; auto-reply-specific ones
  // (cap, hours, handoff) only take effect while autoreply_enabled.
  const rawSettings =
    body.settings && typeof body.settings === 'object'
      ? (body.settings as Record<string, unknown>)
      : {};
  const settings: Record<string, unknown> = {};

  {
    if ('replyCap' in rawSettings || !partial) {
      let cap = Number(rawSettings.replyCap);
      if (!Number.isFinite(cap)) cap = 3;
      settings.replyCap = Math.min(20, Math.max(1, Math.floor(cap)));
    }
    if ('limitMode' in rawSettings || !partial) {
      settings.limitMode = isAutoReplyLimitMode(rawSettings.limitMode)
        ? rawSettings.limitMode
        : 'per_conversation';
    }

    // Reply-hours: both bounds valid 'HH:MM' or both null (always on).
    // Half-open input → always on, matching the switch-flip save UX.
    if (
      'scheduleStart' in rawSettings ||
      'scheduleEnd' in rawSettings ||
      !partial
    ) {
      const rawStart =
        typeof rawSettings.scheduleStart === 'string'
          ? rawSettings.scheduleStart.trim()
          : '';
      const rawEnd =
        typeof rawSettings.scheduleEnd === 'string'
          ? rawSettings.scheduleEnd.trim()
          : '';
      if (rawStart && rawEnd) {
        if (!HHMM.test(rawStart) || !HHMM.test(rawEnd)) {
          return err('schedule times must be HH:MM (24-hour)');
        }
        settings.scheduleStart = rawStart;
        settings.scheduleEnd = rawEnd;
      } else {
        settings.scheduleStart = null;
        settings.scheduleEnd = null;
      }

      const rawTz =
        typeof rawSettings.timezone === 'string'
          ? rawSettings.timezone.trim()
          : '';
      if (rawTz && settings.scheduleStart) {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: rawTz });
          settings.timezone = rawTz;
        } catch {
          return err('timezone must be a valid IANA timezone');
        }
      } else {
        settings.timezone = null;
      }
    }

    // Handoff target must be a member of THIS account — otherwise an
    // escalated conversation gets assigned to a stranger.
    if ('handoffAgentId' in rawSettings) {
      const rawHandoff =
        typeof rawSettings.handoffAgentId === 'string'
          ? rawSettings.handoffAgentId.trim()
          : '';
      if (rawHandoff) {
        const { data: member } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('account_id', accountId)
          .eq('user_id', rawHandoff)
          .maybeSingle();
        if (!member) {
          return err('handoffAgentId must be a member of this account');
        }
        settings.handoffAgentId = rawHandoff;
      } else {
        settings.handoffAgentId = null;
      }
    }
  }

  // Embeddings key (both kinds): non-empty string sets it (validated
  // live below), explicit null clears it, absent leaves unchanged.
  if ('embeddingsApiKey' in rawSettings) {
    const rawEmb =
      typeof rawSettings.embeddingsApiKey === 'string'
        ? rawSettings.embeddingsApiKey.trim()
        : '';
    if (rawEmb) {
      try {
        await embedTexts(rawEmb, ['ping']);
      } catch (e) {
        if (e instanceof AiError) {
          return {
            errorResponse: NextResponse.json(
              { error: `Embeddings key: ${e.message}`, code: e.code },
              { status: 400 }
            ),
          };
        }
        console.error('[ai/agents] embeddings validation error:', e);
        return err('Could not validate the embeddings key.');
      }
      settings.embeddingsApiKey = encrypt(rawEmb);
    } else if (rawSettings.embeddingsApiKey === null) {
      settings.embeddingsApiKey = null;
    }
  }

  return {
    values: {
      display_name: rawName,
      provider,
      model,
      base_url: baseUrl,
      system_prompt: systemPrompt,
      is_enabled:
        typeof body.is_enabled === 'boolean' ? body.is_enabled : undefined,
      suggestions_enabled:
        typeof body.suggestions_enabled === 'boolean'
          ? body.suggestions_enabled
          : undefined,
      autoreply_enabled:
        typeof body.autoreply_enabled === 'boolean'
          ? body.autoreply_enabled
          : undefined,
      settings,
    },
    plainApiKey: plainApiKey || null,
    provided,
  };
}

/**
 * Live "verify before save" round-trip: one tiny generation against
 * the provider with the agent's own credentials. Returns an error
 * NextResponse to short-circuit with, or null when the key works.
 */
export async function validateAgentCredentials(
  values: ParsedAgentPayload['values'],
  plainApiKey: string | null
): Promise<NextResponse | null> {
  if (!values.provider || !values.model) return null;
  try {
    await validateAiCredentials({
      provider: values.provider,
      model: values.model,
      apiKey: plainApiKey ?? '',
      baseUrl: values.base_url,
      systemPrompt: null,
      isActive: true,
      autoReplyEnabled: false,
      autoReplyMaxPerConversation: 3,
      autoReplyLimitMode: 'per_conversation',
      autoReplyScheduleStart: null,
      autoReplyScheduleEnd: null,
      autoReplyTimezone: null,
      handoffAgentId: null,
      embeddingsApiKey: null,
      keySource: 'account',
    });
    return null;
  } catch (e) {
    if (e instanceof AiError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: 400 }
      );
    }
    console.error('[ai/agents] credential validation error:', e);
    return bad('Could not validate the API key with the provider.');
  }
}
