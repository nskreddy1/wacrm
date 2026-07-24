import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { AiError, type AiConfig, type AiUsage } from '../../types'
import {
  MAX_OUTPUT_TOKENS,
  OPENAI_COMPAT_BASE_URL,
  OLLAMA_PLACEHOLDER_KEY,
  resolveOllamaBaseUrl,
} from '../../defaults'

// ============================================================
// AiConfig → LangChain chat model.
//
// Native providers get their own LangChain package; the
// OpenAI-compatible presets (NVIDIA NIM, Groq, OpenRouter, …) and the
// bring-your-own `custom` endpoint all go through `ChatOpenAI` with
// the right base URL. Keys stay per-account (BYO) — passed at call
// time, never from env. `maxRetries: 0` matches the direct adapters'
// single-attempt fetch; the per-call timeout is applied via
// `AbortSignal` at invoke time in `generateReplyLangChain`.
// ============================================================

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
    case 'ollama': {
      // Self-hosted Ollama — OpenAI-compatible /v1 endpoint, no real
      // API key (the daemon ignores auth, ChatOpenAI needs a non-empty one).
      return new ChatOpenAI({
        apiKey: apiKey || OLLAMA_PLACEHOLDER_KEY,
        model,
        maxRetries: 0,
        maxTokens: MAX_OUTPUT_TOKENS,
        configuration: { baseURL: resolveOllamaBaseUrl(config.baseUrl) },
      })
    }
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
