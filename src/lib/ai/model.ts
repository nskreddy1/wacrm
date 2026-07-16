import { APICallError, RetryError, type LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { AiError, type AiConfig, type AiProvider, type AiUsage } from './types'
import { OPENAI_COMPAT_BASE_URL } from './defaults'

// ============================================================
// AiConfig → Vercel AI SDK language model.
//
// Single factory replacing the hand-rolled fetch adapters: native
// providers get their own SDK package; the OpenAI-compatible presets
// (NVIDIA NIM, Groq, OpenRouter, …) and the bring-your-own `custom`
// endpoint all go through `@ai-sdk/openai-compatible` with the right
// base URL. Keys stay per-account (BYO) — passed at call time, never
// from env.
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
 * Build the AI SDK model for an account's config. Throws `AiError`
 * (`missing_base_url` / `unsupported_provider`) on config problems so
 * routes keep returning the same error codes as before.
 */
export function resolveLanguageModel(config: AiConfig): LanguageModel {
  const { provider, apiKey, model } = config
  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey })(model)
    case 'anthropic':
      return createAnthropic({ apiKey })(model)
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey })(model)
    case 'custom': {
      // Bring-your-own OpenAI-compatible endpoint, per-account base URL.
      const baseUrl = config.baseUrl?.trim()
      if (!baseUrl) {
        throw new AiError(
          'A base URL is required for the custom OpenAI-compatible provider.',
          { code: 'missing_base_url', status: 400 },
        )
      }
      return createOpenAICompatible({
        baseURL: baseUrl,
        apiKey,
        name: 'custom',
      })(model)
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
      return createOpenAICompatible({
        baseURL: baseUrl,
        apiKey,
        name: provider,
      })(model)
    }
  }
}

/**
 * Coerce the AI SDK's usage block into our normalized `AiUsage`,
 * tolerant of missing/partial fields. Returns null when there's nothing
 * usable, so logging can distinguish "no usage reported" from "zero
 * tokens". `total` falls back to input + output when absent.
 */
export function normalizeSdkUsage(
  raw:
    | {
        inputTokens?: number | undefined
        outputTokens?: number | undefined
        totalTokens?: number | undefined
      }
    | null
    | undefined,
): AiUsage | null {
  if (!raw) return null
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
  const promptTokens = num(raw.inputTokens)
  const completionTokens = num(raw.outputTokens)
  const total = num(raw.totalTokens)
  const totalTokens = total > 0 ? total : promptTokens + completionTokens
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
    return null
  }
  return { promptTokens, completionTokens, totalTokens }
}

/**
 * Map any AI SDK / network failure to our typed `AiError`, preserving
 * the error codes the routes, settings UI, and tests branch on:
 * `invalid_key` (401), `rate_limited`, `timeout` (504),
 * `network_error`, `provider_error`.
 */
export function toAiError(err: unknown, provider: string): AiError {
  if (err instanceof AiError) return err

  // The SDK retries transient failures and wraps the attempts.
  if (RetryError.isInstance(err)) {
    return toAiError(err.lastError ?? err.errors[err.errors.length - 1], provider)
  }

  if (APICallError.isInstance(err)) {
    const status = err.statusCode
    if (status === 401 || status === 403) {
      return new AiError(`${provider} rejected the API key: ${err.message}`, {
        // 401 so the settings "Test key" button can show "invalid key".
        code: 'invalid_key',
        status: 401,
      })
    }
    if (status === 429) {
      return new AiError(`${provider} rate limit reached: ${err.message}`, {
        code: 'rate_limited',
        status: 502,
      })
    }
    if (typeof status === 'number') {
      return new AiError(`${provider} API error (${status}): ${err.message}`, {
        code: 'provider_error',
        status: 502,
      })
    }
    // No status → the request never got a response (DNS, refused, …).
    return new AiError(`Could not reach the AI provider: ${err.message}`, {
      code: 'network_error',
      status: 502,
    })
  }

  // AbortSignal.timeout() fires as a TimeoutError/AbortError DOMException.
  if (
    (err instanceof DOMException || err instanceof Error) &&
    (err.name === 'TimeoutError' || err.name === 'AbortError')
  ) {
    return new AiError('The AI provider took too long to respond.', {
      code: 'timeout',
      status: 504,
    })
  }

  const msg = err instanceof Error ? err.message : String(err)
  return new AiError(`Could not reach the AI provider: ${msg}`, {
    code: 'network_error',
    status: 502,
  })
}
