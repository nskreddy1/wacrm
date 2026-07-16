import {
  AiError,
  type AiConfig,
  type AiEscalationReason,
  type AiSentiment,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import {
  HANDOFF_SENTINEL,
  META_SENTINEL,
  OPENAI_COMPAT_BASE_URL,
  aiRequestTimeoutMs,
} from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { generateGemini } from './providers/gemini'

/** Human-readable names used in provider error messages. */
const PROVIDER_ERROR_LABEL: Partial<Record<AiConfig['provider'], string>> = {
  nvidia: 'NVIDIA',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  together: 'Together AI',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  xai: 'xAI',
}

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff sentinel out
 * of the raw text. Throws `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    case 'gemini':
      result = await generateGemini(providerArgs)
      break
    case 'custom': {
      // Bring-your-own OpenAI-compatible endpoint, per-account base URL.
      const baseUrl = config.baseUrl?.trim()
      if (!baseUrl) {
        throw new AiError(
          'A base URL is required for the custom OpenAI-compatible provider.',
          { code: 'missing_base_url', status: 400 },
        )
      }
      result = await generateOpenAi(providerArgs, {
        baseUrl,
        providerLabel: 'Custom endpoint',
      })
      break
    }
    default: {
      // OpenAI-compatible presets (NVIDIA NIM, Groq, OpenRouter, Together,
      // Mistral, DeepSeek, xAI) — same protocol, registry-provided URL.
      const baseUrl = OPENAI_COMPAT_BASE_URL[config.provider]
      if (!baseUrl) {
        throw new AiError(`Unsupported AI provider: ${config.provider}`, {
          code: 'unsupported_provider',
          status: 400,
        })
      }
      result = await generateOpenAi(providerArgs, {
        baseUrl,
        providerLabel: PROVIDER_ERROR_LABEL[config.provider] ?? config.provider,
      })
    }
  }

  return parseGeneration(result.text, result.usage)
}

const SENTIMENTS: readonly AiSentiment[] = [
  'angry',
  'frustrated',
  'neutral',
  'happy',
]
const ESCALATION_REASONS: readonly AiEscalationReason[] = [
  'human_requested',
  'angry_customer',
  'out_of_scope',
  'needs_account_data',
  'purchase_ready',
]

/**
 * Split the raw model output into `{ text, handoff, usage, sentiment,
 * escalationReason }`.
 *
 * Two markers are parsed and stripped, both tolerant of absence:
 *   - `[[META]]{...json...}` — the trailing classification line. Missing
 *     or malformed → defaults `{sentiment:'neutral', escalate:false}` so
 *     a model that ignores the instruction degrades gracefully.
 *   - `[[HANDOFF]]` — the legacy bare sentinel, kept as a fallback so
 *     nothing breaks mid-deploy; it forces `handoff` even without meta.
 *
 * `usage` is passed straight through (null when the provider didn't
 * report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  let sentiment: AiSentiment = 'neutral'
  let escalationReason: AiEscalationReason | null = null
  let metaEscalate = false

  let body = raw
  const metaIdx = raw.lastIndexOf(META_SENTINEL)
  if (metaIdx !== -1) {
    // Everything from the sentinel on is machine metadata — never send
    // it to the customer, even if the JSON turns out to be malformed.
    body = raw.slice(0, metaIdx)
    const tail = raw.slice(metaIdx + META_SENTINEL.length).trim()
    try {
      const meta = JSON.parse(extractJsonObject(tail)) as Record<string, unknown>
      if (SENTIMENTS.includes(meta.sentiment as AiSentiment)) {
        sentiment = meta.sentiment as AiSentiment
      }
      metaEscalate = meta.escalate === true
      if (
        metaEscalate &&
        ESCALATION_REASONS.includes(meta.reason as AiEscalationReason)
      ) {
        escalationReason = meta.reason as AiEscalationReason
      }
    } catch {
      // Malformed meta → keep the defaults; the reply itself still goes out.
    }
  }

  const handoff = body.includes(HANDOFF_SENTINEL) || metaEscalate
  const text = body.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage, sentiment, escalationReason }
}

/** Best-effort first `{...}` block from the meta tail — providers
 *  occasionally wrap it in code fences or trail whitespace. */
function extractJsonObject(tail: string): string {
  const start = tail.indexOf('{')
  const end = tail.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return tail
  return tail.slice(start, end + 1)
}
