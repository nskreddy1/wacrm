import { AiError, type AiProvider } from './types'

// ============================================================
// Engine-agnostic error mapping + provider labels.
//
// Both AI engines (LangChain and the direct fetch adapters) and
// their callers/tests rely on the same `AiError` codes:
// `invalid_key`, `rate_limited`, `timeout`, `network_error`,
// `provider_error`, `missing_base_url`, `unsupported_provider`,
// `empty_response`. This module owns the shared pieces so the
// codes stay identical whichever engine the platform flag picks.
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
  ollama: 'Ollama',
  custom: 'Custom endpoint',
}

export function providerLabel(provider: AiProvider): string {
  return PROVIDER_ERROR_LABEL[provider] ?? provider
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
 * Map any SDK / provider / network failure to our typed `AiError`,
 * preserving the error codes the routes, settings UI, and tests branch
 * on: `invalid_key` (401), `rate_limited`, `timeout` (504),
 * `network_error`, `provider_error`.
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
