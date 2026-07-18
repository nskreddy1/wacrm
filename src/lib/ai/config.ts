import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { AI_PROVIDER_DEFAULT_MODEL } from './defaults'
import type {
  AiConfig,
  BotTone,
  OutsideHoursBehavior,
  WorkingHours,
} from './types'

interface AiConfigRow {
  provider: AiConfig['provider']
  model: string
  api_key: string
  base_url: string | null
  system_prompt: string | null
  is_active: boolean
  auto_reply_enabled: boolean
  auto_reply_max_per_conversation: number
  handoff_agent_id: string | null
  embeddings_api_key: string | null
}

const CONFIG_COLUMNS =
  'provider, model, api_key, base_url, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, embeddings_api_key'

/** The persona subset of an `ai_bots` row that `loadAiConfig` merges. */
interface AiBotPersonaRow {
  id: string
  name: string
  system_prompt: string
  tone: BotTone
  language: string
  greeting_message: string | null
  temperature: number | string | null
  model_override: string | null
  auto_reply_max_per_conversation: number | null
  handoff_agent_id: string | null
  working_hours: WorkingHours | null
  outside_hours_behavior: OutsideHoursBehavior
  away_message: string | null
  use_knowledge_base: boolean
}

const BOT_COLUMNS =
  'id, name, system_prompt, tone, language, greeting_message, temperature, model_override, auto_reply_max_per_conversation, handoff_agent_id, working_hours, outside_hours_behavior, away_message, use_knowledge_base'

/** Fields every AiConfig carries when there is NO bot — behavior-neutral
 *  defaults so callers can read them unconditionally. */
const NO_BOT_FIELDS = {
  botId: null,
  botName: null,
  tone: null,
  language: null,
  temperature: null,
  greetingMessage: null,
  workingHours: null,
  outsideHoursBehavior: 'silent' as const,
  awayMessage: null,
  useKnowledgeBase: true,
}

/**
 * Fetch the bot persona to merge: the explicitly requested bot when
 * `botId` is given (Playground testing any bot), otherwise the
 * account's single active bot. Best-effort — a query failure (e.g.
 * migration 047 not applied yet) degrades to bot-less behavior rather
 * than taking down draft/auto-reply.
 */
async function loadBotPersona(
  db: SupabaseClient,
  accountId: string,
  botId?: string | null,
): Promise<AiBotPersonaRow | null> {
  try {
    let query = db
      .from('ai_bots')
      .select(BOT_COLUMNS)
      .eq('account_id', accountId)
    query = botId ? query.eq('id', botId) : query.eq('is_active', true)
    const { data, error } = await query.maybeSingle()
    if (error) {
      console.error('[ai config] active-bot lookup failed (running bot-less):', error)
      return null
    }
    return (data as AiBotPersonaRow | null) ?? null
  } catch (err) {
    console.error('[ai config] active-bot lookup threw (running bot-less):', err)
    return null
  }
}

/** Merge a bot persona on top of a bot-less AiConfig. */
function mergeBot(config: AiConfig, bot: AiBotPersonaRow): AiConfig {
  // numeric columns can arrive as strings from PostgREST
  const rawTemp =
    bot.temperature === null || bot.temperature === undefined
      ? null
      : Number(bot.temperature)
  const temperature =
    rawTemp !== null && Number.isFinite(rawTemp) ? rawTemp : null
  return {
    ...config,
    systemPrompt: bot.system_prompt,
    model: bot.model_override?.trim() || config.model,
    autoReplyMaxPerConversation:
      bot.auto_reply_max_per_conversation ?? config.autoReplyMaxPerConversation,
    handoffAgentId: bot.handoff_agent_id ?? config.handoffAgentId,
    botId: bot.id,
    botName: bot.name,
    tone: bot.tone,
    language: bot.language,
    temperature,
    greetingMessage: bot.greeting_message,
    workingHours: bot.working_hours,
    outsideHoursBehavior: bot.outside_hours_behavior,
    awayMessage: bot.away_message,
    useKnowledgeBase: bot.use_knowledge_base,
  }
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
  opts: { requireActive?: boolean; botId?: string | null } = {},
): Promise<AiConfig | null> {
  const { requireActive = true, botId = null } = opts
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
  if (!data) return withBotPersona(db, accountId, botId, envFallbackConfig())

  const row = data as AiConfigRow
  // The Playground passes requireActive:false so an admin can test the
  // agent before flipping the master switch on.
  if (requireActive && !row.is_active) return null
  // Defensive: the column is NOT NULL, but a partial write / manual DB
  // edit could leave it empty. Treat a missing key as "not configured"
  // (env fallback applies) rather than letting decrypt() throw on null.
  if (!row.api_key) return withBotPersona(db, accountId, botId, envFallbackConfig())

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

  const base: AiConfig = {
    provider: row.provider,
    model: row.model,
    apiKey: decrypt(row.api_key),
    baseUrl: row.base_url,
    systemPrompt: row.system_prompt,
    isActive: row.is_active,
    autoReplyEnabled: row.auto_reply_enabled,
    autoReplyMaxPerConversation: row.auto_reply_max_per_conversation,
    handoffAgentId: row.handoff_agent_id,
    embeddingsApiKey,
    keySource: 'account',
    ...NO_BOT_FIELDS,
  }
  return withBotPersona(db, accountId, botId, base)
}

/**
 * Apply the account's active bot (or the explicitly requested one) on
 * top of a base config. A null base stays null — "AI unavailable" is
 * never resurrected by a bot. No bot found → the base is returned
 * unchanged, which is exactly the pre-bots behavior.
 */
async function withBotPersona(
  db: SupabaseClient,
  accountId: string,
  botId: string | null,
  base: AiConfig | null,
): Promise<AiConfig | null> {
  if (!base) return null
  const bot = await loadBotPersona(db, accountId, botId)
  if (!bot) return base
  return mergeBot(base, bot)
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
    handoffAgentId: null,
    embeddingsApiKey: null,
    keySource: 'env',
    ...NO_BOT_FIELDS,
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
