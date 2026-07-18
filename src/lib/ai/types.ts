// ============================================================
// Shared types for the AI reply assistant (bring-your-own-key).
//
// One small provider-agnostic surface so the inbox draft route and the
// inbound auto-reply bot both talk to `generateReply` without caring
// whether the account is on OpenAI or Anthropic.
// ============================================================

export type AiProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  // OpenAI-compatible presets — same chat/completions protocol as OpenAI,
  // different base URL. All served by the shared `generateOpenAi` adapter.
  | 'nvidia'
  | 'groq'
  | 'openrouter'
  | 'together'
  | 'mistral'
  | 'deepseek'
  | 'xai'
  // Self-hosted Ollama server (OpenAI-compatible /v1 endpoint). No API
  // key required; base URL defaults to the local daemon and can be
  // overridden per-account (`baseUrl`) or via `OLLAMA_BASE_URL`.
  | 'ollama'
  // Bring-your-own OpenAI-compatible endpoint (`baseUrl` required).
  | 'custom'

export const AI_PROVIDERS: readonly AiProvider[] = [
  'openai',
  'anthropic',
  'gemini',
  'nvidia',
  'groq',
  'openrouter',
  'together',
  'mistral',
  'deepseek',
  'xai',
  'ollama',
  'custom',
]

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && AI_PROVIDERS.includes(value as AiProvider)
}

/** Persona tone options a bot can be configured with. */
export type BotTone =
  | 'professional'
  | 'friendly'
  | 'casual'
  | 'formal'
  | 'playful'

/** What the bot does when a message arrives outside working hours. */
export type OutsideHoursBehavior = 'silent' | 'away_message'

/** Per-day working window in the bot's timezone; null = closed. */
export interface WorkingHoursDay {
  /** "HH:MM" 24h */
  start: string
  /** "HH:MM" 24h */
  end: string
}

/**
 * A bot's weekly schedule. Null on the bot means "always on". Days are
 * keyed mon..sun; a missing/null day means closed that day.
 */
export interface WorkingHours {
  /** IANA timezone, e.g. "Asia/Kolkata". */
  timezone: string
  days: Partial<
    Record<
      'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun',
      WorkingHoursDay | null
    >
  >
}

/**
 * One persona bot (`ai_bots` row), camelCase. Credentials stay on the
 * account (`ai_configs`); a bot is the persona/behavior layer merged
 * on top of them by `loadAiConfig`.
 */
export interface AiBot {
  id: string
  accountId: string
  name: string
  description: string | null
  emoji: string | null
  systemPrompt: string
  tone: BotTone
  /** 'auto' = mirror the customer's language; else a language name. */
  language: string
  greetingMessage: string | null
  temperature: number | null
  modelOverride: string | null
  autoReplyMaxPerConversation: number | null
  handoffAgentId: string | null
  workingHours: WorkingHours | null
  outsideHoursBehavior: OutsideHoursBehavior
  awayMessage: string | null
  useKnowledgeBase: boolean
  isActive: boolean
  templateKey: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 *
 * When the account has an active bot (or the caller passes `botId`),
 * the bot's persona is merged in: `systemPrompt` becomes the bot's
 * prompt, `model`/cap/handoff take the bot's overrides, and the
 * bot-only fields (`temperature`, `greetingMessage`, `workingHours`,
 * `useKnowledgeBase`, …) are populated. With no bot they carry
 * behavior-neutral defaults so callers can read them unconditionally.
 */
export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string
  /** OpenAI-compatible endpoint base URL. Only meaningful when
   *  `provider === 'custom'` (e.g. `https://my-gateway.example.com/v1`);
   *  presets derive their URL from the registry in `defaults.ts`. */
  baseUrl?: string | null
  systemPrompt: string | null
  isActive: boolean
  autoReplyEnabled: boolean
  autoReplyMaxPerConversation: number
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null
  /** Which key pays for the call: the account's own BYO key, or the
   *  shared `process.env.GEMINI_API_KEY` fallback. Logged to
   *  `ai_usage_log.key_source` so shared-key spend is auditable. */
  keySource: 'account' | 'env'

  // ---- Bot persona layer (merged from the active/requested ai_bots
  // ---- row; behavior-neutral defaults when there is no bot).
  /** Active/requested bot id, or null when running bot-less. */
  botId: string | null
  botName: string | null
  /** Persona tone directive; null = no directive (bot-less). */
  tone: BotTone | null
  /** Reply language; 'auto'/null = mirror the customer's language. */
  language: string | null
  /** Sampling temperature override; null = provider default (omit). */
  temperature: number | null
  /** Prepended to the bot's first auto-reply in a conversation. */
  greetingMessage: string | null
  /** Weekly schedule; null = always on. */
  workingHours: WorkingHours | null
  outsideHoursBehavior: OutsideHoursBehavior
  awayMessage: string | null
  /** When false, skip knowledge-base retrieval entirely. */
  useKnowledgeBase: boolean
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Customer sentiment classified by the model in the [[META]] tail. */
export type AiSentiment = 'angry' | 'frustrated' | 'neutral' | 'happy'

/** Why the model asked for a human, from the [[META]] tail. */
export type AiEscalationReason =
  | 'human_requested'
  | 'angry_customer'
  | 'out_of_scope'
  | 'needs_account_data'
  | 'purchase_ready'

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel / [[META]] tail stripped. */
  text: string
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null
  /** Classified customer sentiment; 'neutral' when meta is missing/bad. */
  sentiment: AiSentiment
  /** Escalation reason when handing off; null when not escalating (or
   *  when only the legacy bare [[HANDOFF]] sentinel was emitted). */
  escalationReason: AiEscalationReason | null
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message)
    this.name = 'AiError'
    this.code = opts.code ?? 'ai_error'
    this.status = opts.status ?? 502
  }
}
