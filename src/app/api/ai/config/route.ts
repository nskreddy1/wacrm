import { NextResponse } from 'next/server'
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { validateAiCredentials } from '@/lib/ai/validate'
import { embedTexts } from '@/lib/ai/embeddings'
import {
  AiError,
  AI_PROVIDERS,
  isAiProvider,
  isAutoReplyLimitMode,
  type AiProvider,
} from '@/lib/ai/types'
import { verifyValidationProof } from '@/lib/ai/validation-proof'
import { OLLAMA_PLACEHOLDER_KEY } from '@/lib/ai/defaults'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * GET /api/ai/config
 *
 * Any member may read the config so the inbox/settings can reflect
 * whether AI is set up. The encrypted key is NEVER returned — only a
 * `has_key` flag; the settings form shows a masked placeholder.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()

    const { data, error } = await supabase
      .from('ai_configs')
      // `api_key` is selected only to derive `has_key` — it is stripped
      // out below and never returned to the client.
      .select(
        'provider, model, base_url, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, auto_reply_limit_mode, auto_reply_schedule_start, auto_reply_schedule_end, auto_reply_timezone, handoff_agent_id, api_key, embeddings_api_key',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[ai/config GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load AI configuration' },
        { status: 500 },
      )
    }

    // `auto_reply_live` mirrors `loadAiConfig`'s effective decision —
    // INCLUDING the shared env-key fallback — so the inbox banner shows
    // the Take over / Resume AI toggle for accounts that ride the env
    // key with no ai_configs row of their own. An explicit row with
    // `is_active = false` wins over the fallback (same rule as the bot).
    const envFallback = !!process.env.GEMINI_API_KEY?.trim()

    if (!data) {
      return NextResponse.json({
        configured: false,
        env_fallback: envFallback,
        auto_reply_live: envFallback,
      })
    }
    // The keys are selected only to derive the has_* flags; neither is
    // returned to the client.
    const { api_key, embeddings_api_key, ...safe } = data
    const autoReplyLive = api_key
      ? !!(data.is_active && data.auto_reply_enabled)
      : data.is_active === false
        ? false
        : envFallback
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      env_fallback: envFallback,
      auto_reply_live: autoReplyLive,
      ...safe,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/ai/config  (admin+)
 *
 * Upsert the account's AI config. Validates the key with the provider
 * before persisting (mirrors the WhatsApp config verifying with Meta
 * first), then stores the key AES-256-GCM-encrypted. When `api_key` is
 * omitted the existing stored key is reused (the form sends it only
 * when the user re-enters it).
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    if (!isAiProvider(body.provider)) {
      return bad(`provider must be one of: ${AI_PROVIDERS.join(', ')}`)
    }
    const provider: AiProvider = body.provider
    const model = typeof body.model === 'string' ? body.model.trim() : ''
    if (!model) return bad('model is required')

    // Base URL is only meaningful for the custom OpenAI-compatible
    // provider (required, https-only) and for Ollama (optional — falls
    // back to OLLAMA_BASE_URL / the local daemon; http allowed since
    // Ollama typically runs on localhost or a private network).
    let baseUrl: string | null = null
    if (provider === 'custom' || provider === 'ollama') {
      const rawBaseUrl =
        typeof body.base_url === 'string' ? body.base_url.trim().replace(/\/+$/, '') : ''
      if (!rawBaseUrl && provider === 'custom') {
        return bad('base_url is required for the custom provider')
      }
      if (rawBaseUrl) {
        let parsed: URL
        try {
          parsed = new URL(rawBaseUrl)
        } catch {
          return bad('base_url must be a valid URL')
        }
        if (provider === 'custom' && parsed.protocol !== 'https:') {
          return bad('base_url must use https')
        }
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
          return bad('base_url must be an http(s) URL')
        }
        baseUrl = rawBaseUrl
      }
    }

    const systemPrompt =
      typeof body.system_prompt === 'string' && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null
    const isActive = body.is_active === true
    const autoReplyEnabled = body.auto_reply_enabled === true

    let maxPer = Number(body.auto_reply_max_per_conversation)
    if (!Number.isFinite(maxPer)) maxPer = 3
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)))

    // Limit mode: what the cap counts against. Absent/invalid → the
    // legacy per-conversation behaviour.
    const limitMode = isAutoReplyLimitMode(body.auto_reply_limit_mode)
      ? body.auto_reply_limit_mode
      : 'per_conversation'

    // Reply-hours schedule: both bounds must be valid 'HH:MM' strings or
    // both null ("always on"). Half-open input → treated as always on
    // rather than rejected, matching the switch-flip save UX.
    const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
    const rawStart =
      typeof body.auto_reply_schedule_start === 'string'
        ? body.auto_reply_schedule_start.trim()
        : ''
    const rawEnd =
      typeof body.auto_reply_schedule_end === 'string'
        ? body.auto_reply_schedule_end.trim()
        : ''
    let scheduleStart: string | null = null
    let scheduleEnd: string | null = null
    if (rawStart && rawEnd) {
      if (!HHMM.test(rawStart) || !HHMM.test(rawEnd)) {
        return bad('schedule times must be HH:MM (24-hour)')
      }
      scheduleStart = rawStart
      scheduleEnd = rawEnd
    }

    // Timezone: must resolve in Intl, else the schedule silently
    // evaluates in the wrong zone. Only meaningful alongside a window.
    let timezone: string | null = null
    const rawTz =
      typeof body.auto_reply_timezone === 'string'
        ? body.auto_reply_timezone.trim()
        : ''
    if (rawTz && scheduleStart) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: rawTz })
        timezone = rawTz
      } catch {
        return bad('auto_reply_timezone must be a valid IANA timezone')
      }
    }

    // Handoff routing target for auto-reply. A non-empty string must be a
    // member of this account (else the conversation would be assigned to a
    // stranger); an empty string / null means "leave unassigned" (the
    // shared queue). Absent → left unchanged on update below.
    const rawHandoff =
      typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
    const handoffProvided = 'handoff_agent_id' in body
    let handoffAgentId: string | null = null
    if (rawHandoff) {
      const { data: member } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('account_id', accountId)
        .eq('user_id', rawHandoff)
        .maybeSingle()
      if (!member) return bad('handoff_agent_id must be a member of this account')
      handoffAgentId = rawHandoff
    }

    let rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''

    // Embeddings key (optional, for semantic KB search): a non-empty
    // string sets/replaces it; an explicit null clears it; absent leaves
    // it unchanged. The form only sends it when the admin edits it.
    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === 'string'
        ? body.embeddings_api_key.trim()
        : ''
    const clearEmbeddingsKey = body.embeddings_api_key === null

    // Reuse the stored key when the form didn't send a fresh one.
    const { data: existing } = await supabase
      .from('ai_configs')
      .select('id, provider, model, api_key, base_url')
      .eq('account_id', accountId)
      .maybeSingle()

    // Ollama ignores auth entirely — when the admin leaves the key blank
    // and there's nothing stored, persist a harmless placeholder so the
    // row still counts as "configured" (an empty api_key would fall
    // through to the shared env-key fallback in loadAiConfig).
    if (!rawKey && provider === 'ollama' && !existing?.api_key) {
      rawKey = OLLAMA_PLACEHOLDER_KEY
    }

    let apiKeyPlain: string
    if (rawKey) {
      apiKeyPlain = rawKey
    } else if (existing?.api_key) {
      try {
        apiKeyPlain = decrypt(existing.api_key)
      } catch {
        return bad('Stored API key could not be decrypted — re-enter your key.')
      }
    } else {
      return bad('api_key is required')
    }

    // Only spend a provider round-trip when the credentials that affect
    // reachability actually changed. A save that just flips a toggle or
    // edits the system prompt on an existing, already-validated config
    // skips the call — no wasted token/latency on the account's key.
    const credentialsChanged =
      !existing ||
      rawKey !== '' ||
      provider !== existing.provider ||
      model !== existing.model ||
      baseUrl !== (existing.base_url ?? null)

    const hasValidTestProof = verifyValidationProof(body.validation_proof, {
      accountId,
      provider,
      model,
      apiKey: apiKeyPlain,
      baseUrl,
    })

    if (credentialsChanged && !hasValidTestProof) {
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
          autoReplyLimitMode: 'per_conversation',
          autoReplyScheduleStart: null,
          autoReplyScheduleEnd: null,
          autoReplyTimezone: null,
          handoffAgentId: null,
          embeddingsApiKey: null,
          keySource: 'account',
        })
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] validation error:', err)
        return bad('Could not validate the API key with the provider.')
      }
    }

    // Validate a new embeddings key before storing (a cheap 1-input
    // embed), same "verify before save" discipline as the chat key.
    if (rawEmbeddingsKey) {
      try {
        await embedTexts(rawEmbeddingsKey, ['ping'])
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: `Embeddings key: ${err.message}`, code: err.code },
            { status: 400 },
          )
        }
        console.error('[ai/config POST] embeddings validation error:', err)
        return bad('Could not validate the embeddings key.')
      }
    }

    const encryptedKey = rawKey ? encrypt(rawKey) : null
    const shared: Record<string, unknown> = {
      provider,
      model,
      base_url: baseUrl,
      system_prompt: systemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
      auto_reply_limit_mode: limitMode,
      auto_reply_schedule_start: scheduleStart,
      auto_reply_schedule_end: scheduleEnd,
      auto_reply_timezone: timezone,
    }
    // Only touch the handoff target when the form actually sent the field,
    // so a partial save (e.g. flipping a toggle) doesn't wipe it.
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId
    if (rawEmbeddingsKey) {
      shared.embeddings_api_key = encrypt(rawEmbeddingsKey)
    } else if (clearEmbeddingsKey) {
      shared.embeddings_api_key = null
    }

    if (existing) {
      const { error: upErr } = await supabase
        .from('ai_configs')
        .update(encryptedKey ? { ...shared, api_key: encryptedKey } : shared)
        .eq('account_id', accountId)
      if (upErr) {
        console.error('[ai/config POST] update error:', upErr)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 },
        )
      }
    } else {
      const { error: insErr } = await supabase.from('ai_configs').insert({
        account_id: accountId,
        created_by: userId,
        api_key: encryptedKey, // guaranteed non-null: rawKey required when no existing row
        ...shared,
      })
      if (insErr) {
        console.error('[ai/config POST] insert error:', insErr)
        return NextResponse.json(
          { error: 'Failed to save AI configuration' },
          { status: 500 },
        )
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * PATCH /api/ai/config  (admin+)
 *
 * Lightweight toggle endpoint: flips `is_active` (AI assistant) and/or
 * `auto_reply_enabled` on the EXISTING row without requiring the full
 * form payload. The POST handler demands provider + model + key and may
 * re-validate with the provider — overkill for a switch flip, and the
 * reason toggles previously appeared to "not stick" when the form
 * didn't have the key in memory. A toggle never changes credentials,
 * so no provider round-trip is needed.
 */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')

    const limit = checkRateLimit(`ai-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const patch: Record<string, boolean> = {}
    if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
    if (typeof body.auto_reply_enabled === 'boolean') {
      patch.auto_reply_enabled = body.auto_reply_enabled
    }
    if (Object.keys(patch).length === 0) {
      return bad('Provide is_active and/or auto_reply_enabled as booleans')
    }

    const { data: existing, error: findErr } = await supabase
      .from('ai_configs')
      .select('id')
      .eq('account_id', accountId)
      .maybeSingle()
    if (findErr) {
      console.error('[ai/config PATCH] fetch error:', findErr)
      return NextResponse.json(
        { error: 'Failed to load AI configuration' },
        { status: 500 },
      )
    }
    if (!existing) {
      return NextResponse.json(
        { error: 'Set up the AI agent before enabling it.' },
        { status: 404 },
      )
    }

    const { error: upErr } = await supabase
      .from('ai_configs')
      .update(patch)
      .eq('account_id', accountId)
    if (upErr) {
      console.error('[ai/config PATCH] update error:', upErr)
      return NextResponse.json(
        { error: 'Failed to update AI configuration' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true, ...patch })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/ai/config  (admin+)
 *
 * Removes the account's AI config (turns everything off and forgets the
 * key). Also used to recover from a corrupted encrypted key.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { error } = await supabase
      .from('ai_configs')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[ai/config DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to delete AI configuration' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
