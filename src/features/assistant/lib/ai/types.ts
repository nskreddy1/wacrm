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
  | 'custom';

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
];

export function isAiProvider(value: unknown): value is AiProvider {
  return (
    typeof value === 'string' && AI_PROVIDERS.includes(value as AiProvider)
  );
}

/**
 * What `autoReplyMaxPerConversation` counts against:
 *  - `per_conversation` — lifetime cap per thread (legacy behaviour)
 *  - `per_day`          — cap resets daily per thread
 *  - `never`            — no cap; the bot always replies
 */
export type AutoReplyLimitMode = 'per_conversation' | 'per_day' | 'never';

export const AUTO_REPLY_LIMIT_MODES: readonly AutoReplyLimitMode[] = [
  'per_conversation',
  'per_day',
  'never',
];

export function isAutoReplyLimitMode(
  value: unknown
): value is AutoReplyLimitMode {
  return (
    typeof value === 'string' &&
    AUTO_REPLY_LIMIT_MODES.includes(value as AutoReplyLimitMode)
  );
}

/**
 * How much internal reasoning ("thinking", chain-of-thought) the model
 * is allowed to do before writing the reply.
 *
 *  - `off`  — ask the provider not to reason at all. The DEFAULT, and
 *             the right answer for almost every account: `MAX_OUTPUT_TOKENS`
 *             is a budget shared by the scratchpad AND the reply, so a
 *             model that thinks past the cap returns half a thought and
 *             no answer.
 *  - `auto` — send no reasoning flags; whatever the model does by
 *             default is what happens.
 *  - `on`   — ask for reasoning, and ask for it to stay hidden. Costs
 *             more tokens and adds latency; only worth it for genuinely
 *             multi-step questions.
 *
 * `on` NEVER means "show the thinking to the customer". Reasoning is an
 * internal step: every mode still routes through the `reasoning.ts`
 * text guards, so a scratchpad can't reach a WhatsApp thread.
 */
export type ReasoningMode = 'off' | 'auto' | 'on';

export const REASONING_MODES: readonly ReasoningMode[] = ['off', 'auto', 'on'];

/** Safe default for every account, new or existing. */
export const DEFAULT_REASONING_MODE: ReasoningMode = 'off';

export function isReasoningMode(value: unknown): value is ReasoningMode {
  return (
    typeof value === 'string' && REASONING_MODES.includes(value as ReasoningMode)
  );
}

/**
 * Account AI setup, decrypted and ready to use. Produced by
 * `loadAiConfig` — `apiKey` is the plaintext BYO provider key
 * (stored AES-256-GCM-encrypted at rest).
 */
export interface AiConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
  /** OpenAI-compatible endpoint base URL. Only meaningful when
   *  `provider === 'custom'` (e.g. `https://my-gateway.example.com/v1`);
   *  presets derive their URL from the registry in `defaults.ts`. */
  baseUrl?: string | null;
  systemPrompt: string | null;
  /** Auto-Reply Agent's own system prompt. Null = inherit
   *  `systemPrompt` (the Support Copilot prompt) — the pre-split
   *  behaviour, so existing accounts are unaffected. */
  autoreplySystemPrompt?: string | null;
  isActive: boolean;
  autoReplyEnabled: boolean;
  autoReplyMaxPerConversation: number;
  /** What the reply cap counts against (lifetime, daily, or no cap). */
  autoReplyLimitMode: AutoReplyLimitMode;
  /** Auto-reply window start, 'HH:MM' 24h local to `autoReplyTimezone`.
   *  Null (with end also null) = always on — the default. */
  autoReplyScheduleStart: string | null;
  /** Auto-reply window end, 'HH:MM'. May be earlier than start for an
   *  overnight window (e.g. 20:00 → 06:00). */
  autoReplyScheduleEnd: string | null;
  /** IANA timezone the schedule is evaluated in (e.g. 'Asia/Kolkata').
   *  Null = UTC. */
  autoReplyTimezone: string | null;
  /** Where auto-reply hands a conversation off when the model bails: an
   *  agent's `auth.users.id`, or null to leave it unassigned (drop into
   *  the shared queue). */
  handoffAgentId: string | null;
  /** Optional OpenAI-compatible key for embeddings. When set, the
   *  knowledge base is embedded and semantic retrieval turns on; when
   *  null, retrieval falls back to lexical full-text search. */
  embeddingsApiKey: string | null;
  /** How much internal reasoning the model may do. Optional so that
   *  older callers and the legacy `ai_configs` path stay valid —
   *  everything resolves an absent value to `DEFAULT_REASONING_MODE`
   *  ('off'), which is the pre-toggle behaviour. */
  reasoningMode?: ReasoningMode;
  /** Which key pays for the call: the account's own BYO key, or the
   *  shared `process.env.GEMINI_API_KEY` fallback. Logged to
   *  `ai_usage_log.key_source` so shared-key spend is auditable. */
  keySource: 'account' | 'env';
}

/** A single conversation turn in the shape both providers accept. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Token counts for one provider call, normalized across OpenAI
 * (`prompt`/`completion`) and Anthropic (`input`/`output`). Null when
 * the provider didn't return usage. Logged to `ai_usage_log`.
 */
export interface AiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Provider-reported cached (discounted) prompt tokens — OpenAI
   *  `prompt_tokens_details.cached_tokens`, Anthropic
   *  `cache_read_input_tokens`, Gemini `cachedContentTokenCount`.
   *  Null/undefined when the provider didn't report. */
  cachedTokens?: number | null;
  /** Anthropic-only `cache_creation_input_tokens` (billed at +25% once
   *  when a new prefix is written to the cache). */
  cacheWriteTokens?: number | null;
}

/** Customer sentiment classified by the model in the [[META]] tail. */
export type AiSentiment = 'angry' | 'frustrated' | 'neutral' | 'happy';

/**
 * Multi-label emotion vocabulary (ADR-002 §3).
 *
 * CLOSED set, unlike language tags: every label here is a promise to
 * reporting (chart axes, alert thresholds), so additions are deliberate
 * schema-ish changes, and unknown labels from the model are dropped at
 * parse time rather than leaking hallucinated axes into dashboards.
 *
 * Multi-label because customers are rarely one thing: "angry AND still
 * hopeful" and "confused AND grateful" are different service situations
 * that a single winner-take-all sentiment collapses into noise.
 */
export const AFFECT_EMOTIONS = [
  'anger',
  'frustration',
  'disappointment',
  'confusion',
  'anxiety',
  'urgency',
  'satisfaction',
  'gratitude',
] as const;
export type AffectEmotion = (typeof AFFECT_EMOTIONS)[number];

/**
 * A point-in-time emotional read of the customer.
 *
 * `source` is the modality invariant that keeps this layer voice-ready
 * (ADR-002 §11): text turns emit `lexical`; a future voice-note sidecar
 * emits `prosodic` from the same audio's tone; `fused` combines them.
 * Consumers read the vector and must never branch on the origin.
 */
export interface AffectiveState {
  /** Present emotions only, each scored 0..1 (independent, not softmax). */
  emotions: Partial<Record<AffectEmotion, number>>;
  source: 'lexical' | 'prosodic' | 'fused';
}

/** Why the model asked for a human, from the [[META]] tail. */
export type AiEscalationReason =
  | 'human_requested'
  | 'angry_customer'
  | 'out_of_scope'
  | 'needs_account_data'
  | 'purchase_ready';

/** Outcome of a generation call. */
export interface GenerateResult {
  /** The reply text, with any handoff sentinel / [[META]] tail stripped. */
  text: string;
  /** True when the model asked to hand off to a human (auto-reply mode). */
  handoff: boolean;
  /** Provider token usage for this call, or null when unavailable. */
  usage: AiUsage | null;
  /** Classified customer sentiment; 'neutral' when meta is missing/bad. */
  sentiment: AiSentiment;
  /** Escalation reason when handing off; null when not escalating (or
   *  when only the legacy bare [[HANDOFF]] sentinel was emitted). */
  escalationReason: AiEscalationReason | null;
  /**
   * Customer language classified in the same [[META]] tail, as a
   * lowercase BCP-47-ish tag. Deliberately an open string, not a union:
   * India alone has 22 scheduled languages, and an enum here would turn
   * every new one into a code change. Script is significant — `hi-latn`
   * (romanized Hinglish) is not `hi` (Devanagari), and replying in the
   * wrong script is as jarring as the wrong language. Null when the
   * model omitted it or the tag failed the sanity check.
   */
  language: string | null;
  /**
   * Multi-label emotional read from the same [[META]] tail, or null
   * when omitted/unparseable. Coexists with the single-label
   * `sentiment` during migration: sentiment keeps existing consumers
   * (escalation rules, banner) working; `affect` feeds the append-only
   * history that reports and trend detection are built on.
   */
  affect: AffectiveState | null;
}

/**
 * Typed error for every AI failure mode. `status` maps cleanly to an
 * HTTP response in the draft route; `code` lets the UI/tests branch
 * (invalid_key vs rate_limited vs timeout, etc.).
 */
export class AiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, opts: { code?: string; status?: number } = {}) {
    super(message);
    this.name = 'AiError';
    this.code = opts.code ?? 'ai_error';
    this.status = opts.status ?? 502;
  }
}
