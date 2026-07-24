import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/features/whatsapp/lib/encryption'
import { AI_PROVIDER_DEFAULT_MODEL } from './defaults'
import type { AiConfig } from './types'

interface AiConfigRow {
  provider: AiConfig['provider']
  model: string
  api_key: string
  base_url: string | null
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  auto_reply_limit_mode: AiConfig['autoReplyLimitMode']
  auto_reply_schedule_start: string | null
  auto_reply_schedule_end: string | null
  auto_reply_timezone: string | null
  handoff_agent_id: string | null
  embeddings_api_key: string | null
}

const CONFIG_COLUMNS =
  'provider, model, api_key, base_url, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, auto_reply_limit_mode, auto_reply_schedule_start, auto_reply_schedule_end, auto_reply_timezone, handoff_agent_id, embeddings_api_key'

/** Postgres `time` columns come back as 'HH:MM:SS'; the app works in
 *  'HH:MM'. Normalizes either shape (or null) to 'HH:MM' | null. */
function toHhMm(value: string | null): string | null {
  if (!value) return null
  const m = /^(\d{2}:\d{2})/.exec(value)
  return m ? m[1] : null
}

/**
 * Load and decrypt the account's AI config for *use* (draft or
 * auto-reply). Returns `null` when there's no row or the master switch
 * (`is_active`) is off — both mean "AI is not available", which callers
 * treat identically. Throws only if the stored key can't be decrypted
 * (mismatched `ENCRYPTION_KEY`), so that distinct failure surfaces
 * rather than looking like "not configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {},
): Promise<AiConfig | null> {
  const { requireActive = true } = opts
  const { data, error } = await db
    .from('ai_configs')
    .select(CONFIG_COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error) throw error
  // Env fallback: an account with no AI setup at all still gets Gemini
  // auto-reply when the deployment provides a shared GEMINI_API_KEY.
  // An EXPLICIT off must win over the fallback, so a row with
  // `is_active = false` returns null and never falls through.
  if (!data) return envFallbackConfig()

  const row = data as AiConfigRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // (env fallback applies) rather than letting decrypt() throw on null.
  if (!row.api_key) return envFallbackConfig()

  // The embeddings key is optional and independent of the chat key —
  // a corrupt/undecryptable one should downgrade to lexical KB, not
  // take down draft/auto-reply, so decrypt failures are swallowed here.
  let embeddingsApiKey: string | null = null
  if (row.embeddings_api_key) {
    try {
      embeddingsApiKey = decrypt(row.embeddings_api_key)
    } catch {
      // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
      // semantic search quietly stops working, so leave a breadcrumb.
      console.error(
        `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
      )
      embeddingsApiKey = null
    }
  }

  return {
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key),
    baseUrl: row.base_url,
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    autoReplyLimitMode: row.auto_reply_limit_mode ?? 'per_conversation',
    autoReplyScheduleStart: toHhMm(row.auto_reply_schedule_start),
    autoReplyScheduleEnd: toHhMm(row.auto_reply_schedule_end),
    autoReplyTimezone: row.auto_reply_timezone,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
    keySource: 'account',
  }
}

/** Cap for accounts riding the shared env key — a bit more generous than
 *  the per-account default (3) since there's no admin to raise it, but
 *  still bounded so one chatty thread can't burn the shared key. */
const ENV_FALLBACK_MAX_PER_CONVERSATION = 10

/**
 * Zero-setup Gemini config backed by the deployment's shared
 * `GEMINI_API_KEY`. Returned when the account has no usable BYO key of
 * its own (no `ai_configs` row, or a row with an empty key). Returns
 * null when the env var isn't set — the pre-fallback behaviour.
 */
export function envFallbackConfig(): AiConfig | null {
  const key = process.env.GEMINI_API_KEY?.trim()
  if (!key) return null
  return {
    provider: 'gemini',
    model: AI_PROVIDER_DEFAULT_MODEL.gemini,
    apiKey: key,
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: ENV_FALLBACK_MAX_PER_CONVERSATION,
    autoReplyLimitMode: 'per_conversation',
    autoReplyScheduleStart: null,
    autoReplyScheduleEnd: null,
    autoReplyTimezone: null,
    handoffAgentId: null,
    embeddingsApiKey: null,
    keySource: 'env',
  }
}

/**
 * Load + decrypt just the embeddings key, independent of `is_active`.
 * Used by the knowledge-base ingest routes so the KB gets embedded (and
 * semantic search works) whenever an embeddings key is present, even if
 * the assistant's master switch is currently off.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key OR it
 * can't be decrypted; `corrupt` distinguishes those cases so callers can
 * warn ("a key is set but unusable") rather than silently indexing
 * lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data, error } = await db
    .from('ai_configs')
    .select('embeddings_api_key')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.embeddings_api_key) return { key: null, corrupt: false }
  try {
    return { key: decrypt(data.embeddings_api_key), corrupt: false }
  } catch {
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return { key: null, corrupt: true }
  }
}
