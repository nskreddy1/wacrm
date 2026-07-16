import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { AiError, type AiConfig, type AiProvider, type AiUsage } from './types'
import { MAX_OUTPUT_TOKENS, OPENAI_COMPAT_BASE_URL } from './defaults'

// ============================================================
// AiConfig → LangChain chat model.
//
// Single factory replacing the hand-rolled fetch adapters: native
// providers get their own LangChain package; the OpenAI-compatible
// presets (NVIDIA NIM, Groq, OpenRouter, …) and the bring-your-own
// `custom` endpoint all go through `ChatOpenAI` with the right base
// URL. Keys stay per-account (BYO) — passed at call time, never from
// env. `maxRetries: 0` matches the old adapters' single-attempt fetch;
// the per-call timeout is applied via `AbortSignal` at invoke time in
// `generateReply`.
// ============================================================

/** Human-readable provider names used in error messages. */
const PROVIDER_ERROR_LABEL: Partial<Record<AiProvider, string>> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  nvidia: 'NVIDIA',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  together: 'Together AI',
  mistral: 'Mistral',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  custom: 'Custom endpoint',
}

export function providerLabel(provider: AiProvider): string {
  return PROVIDER_ERROR_LABEL[provider] ?? provider
}

/**
 * Build the LangChain chat model for an account's config. Throws
 * `AiError` (`missing_base_url` / `unsupported_provider`) on config
 * problems so routes keep returning the same error codes as before.
 */
export function resolveChatModel(config: AiConfig): BaseChatModel {
  const { provider, apiKey, model } = config
  switch (provider) {
    case 'openai':
      return new ChatOpenAI({
        apiKey,
        model,
        maxRetries: 0,
        maxTokens: MAX_OUTPUT_TOKENS,
      })
    case 'anthropic':
      return new ChatAnthropic({
        apiKey,
        model,
        maxRetries: 0,
        maxTokens: MAX_OUTPUT_TOKENS,
      })
    case 'gemini':
      return new ChatGoogleGenerativeAI({
        apiKey,
        model,
        maxRetries: 0,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })
    case 'custom': {
      // Bring-your-own OpenAI-compatible endpoint, per-account base URL.
      const baseUrl = config.baseUrl?.trim()
      if (!baseUrl) {
        throw new AiError(
          'A base URL is required for the custom OpenAI-compatible provider.',
          { code: 'missing_base_url', status: 400 },
        )
      }
      return new ChatOpenAI({
        apiKey,
        model,
        maxRetries: 0,
        maxTokens: MAX_OUTPUT_TOKENS,
        configuration: { baseURL: baseUrl },
      })
    }
    default: {
      // OpenAI-compatible presets — same protocol, registry-provided URL.
      const baseUrl = OPENAI_COMPAT_BASE_URL[provider]
      if (!baseUrl) {
        throw new AiError(`Unsupported AI provider: ${provider}`, {
          code: 'unsupported_provider',
          status: 400,
        })
      }
      return new ChatOpenAI({
        apiKey,
        model,
        maxRetries: 0,
        maxTokens: MAX_OUTPUT_TOKENS,
        configuration: { baseURL: baseUrl },
      })
    }
  }
}

/**
 * Coerce LangChain's `usage_metadata` block into our normalized
 * `AiUsage`, tolerant of missing/partial fields. Returns null when
 * there's nothing usable, so logging can distinguish "no usage
 * reported" from "zero tokens". `total` falls back to input + output
 * when absent.
 */
export function normalizeLcUsage(
  raw:
    | {
        input_tokens?: number | undefined
        output_tokens?: number | undefined
        total_tokens?: number | undefined
      }
    | null
    | undefined,
): AiUsage | null {
  if (!raw) return null
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
  const promptTokens = num(raw.input_tokens)
  const completionTokens = num(raw.output_tokens)
  const total = num(raw.total_tokens)
  const totalTokens = total > 0 ? total : promptTokens + completionTokens
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
    return null
  }
  return { promptTokens, completionTokens, totalTokens }
}

/** Best-effort HTTP status from a provider SDK error. The OpenAI,
 *  Anthropic, and Google GenAI SDK errors all surface the response
 *  status as `status` (or `statusCode`), which LangChain rethrows. */
function errorStatus(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) return null
  const e = err as { status?: unknown; statusCode?: unknown }
  if (typeof e.status === 'number' && Number.isFinite(e.status)) return e.status
  if (typeof e.statusCode === 'number' && Number.isFinite(e.statusCode)) {
    return e.statusCode
  }
  return null
}

/**
 * Map any LangChain / provider SDK / network failure to our typed
 * `AiError`, preserving the error codes the routes, settings UI, and
 * tests branch on: `invalid_key` (401), `rate_limited`, `timeout`
 * (504), `network_error`, `provider_error`.
 */
export function toAiError(err: unknown, provider: string): AiError {
  if (err instanceof AiError) return err

  // AbortSignal.timeout() fires as a TimeoutError/AbortError
  // DOMException; the OpenAI SDK also has its own timeout error class.
  if (
    (err instanceof DOMException || err instanceof Error) &&
    (err.name === 'TimeoutError' ||
      err.name === 'AbortError' ||
      err.name === 'APIConnectionTimeoutError' ||
      err.name === 'APIUserAbortError')
  ) {
    return new AiError('The AI provider took too long to respond.', {
      code: 'timeout',
      status: 504,
    })
  }

  const status = errorStatus(err)
  const msg = err instanceof Error ? err.message : String(err)

  if (status === 401 || status === 403) {
    return new AiError(`${provider} rejected the API key: ${msg}`, {
      // 401 so the settings "Test key" button can show "invalid key".
      code: 'invalid_key',
      status: 401,
    })
  }
  if (status === 429) {
    return new AiError(`${provider} rate limit reached: ${msg}`, {
      code: 'rate_limited',
      status: 502,
    })
  }
  if (typeof status === 'number') {
    return new AiError(`${provider} API error (${status}): ${msg}`, {
      code: 'provider_error',
      status: 502,
    })
  }

  // No status → the request never got a response (DNS, refused, …).
  return new AiError(`Could not reach the AI provider: ${msg}`, {
    code: 'network_error',
    status: 502,
  })
}
