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

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
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
  /** Per-account AI optimization opt-ins (`ai_configs.feature_flags`).
   *  Parsed by `parseFeatureFlags`. OPTIONAL by design: ad-hoc configs
   *  (test routes, config-validation probes, test fixtures) omit it and
   *  `isAiFeatureEnabled` treats undefined as all-OFF — a missing flag
   *  object can never accidentally switch an optimization on. */
  featureFlags?: import('./feature-flags').AiFeatureFlags
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
  /** Provider-reported cached (discounted) prompt tokens — OpenAI
   *  `prompt_tokens_details.cached_tokens`, Anthropic
   *  `cache_read_input_tokens`, Gemini `cachedContentTokenCount`.
   *  Null/undefined when the provider didn't report. */
  cachedTokens?: number | null
  /** Anthropic-only `cache_creation_input_tokens` (billed at +25% once
   *  when a new prefix is written to the cache). */
  cacheWriteTokens?: number | null
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
