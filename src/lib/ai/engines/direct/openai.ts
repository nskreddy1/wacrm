import { AiError } from '../../types'
import { MAX_OUTPUT_TOKENS } from '../../defaults'
import {
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  type ProviderArgs,
  type ProviderResult,
} from './shared'

const OPENAI_BASE_URL = 'https://api.openai.com/v1'

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export interface OpenAiCompatOptions {
  /** Endpoint base, e.g. `https://integrate.api.nvidia.com/v1`. The adapter
   *  appends `/chat/completions`. Defaults to OpenAI's own API. */
  baseUrl?: string
  /** Human-readable provider name for error messages ("NVIDIA", "Groq"…). */
  providerLabel?: string
}

/**
 * Call an OpenAI-compatible Chat Completions endpoint with the caller's
 * own key. Serves OpenAI itself plus every compatible provider (NVIDIA
 * NIM, Groq, OpenRouter, Together, Mistral, DeepSeek, xAI, custom
 * gateways) — they all accept the same request/response shape, only the
 * base URL differs. Returns the raw assistant text + token usage
 * (handoff parsing happens in `generateReply`).
 */
export async function generateOpenAi(
  args: ProviderArgs,
  opts: OpenAiCompatOptions = {},
): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs } = args
  const baseUrl = (opts.baseUrl ?? OPENAI_BASE_URL).replace(/\/+$/, '')
  const label = opts.providerLabel ?? 'OpenAI'
  const isOpenAiProper = baseUrl === OPENAI_BASE_URL

  let res: Response
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          ...mergeConsecutive(messages),
        ],
        // OpenAI's newer models reject the legacy `max_tokens` param, while
        // many compatible providers haven't adopted `max_completion_tokens`
        // yet — send whichever the endpoint understands.
        ...(isOpenAiProper
          ? { max_completion_tokens: MAX_OUTPUT_TOKENS }
          : { max_tokens: MAX_OUTPUT_TOKENS }),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw toNetworkError(err)
  }

  if (!res.ok) {
    throw await providerHttpError(label, res)
  }

  const data = (await res.json().catch(() => null)) as OpenAiResponse | null
  const text = data?.choices?.[0]?.message?.content
  if (!text || typeof text !== 'string' || !text.trim()) {
    throw new AiError(`${label} returned an empty response.`, {
      code: 'empty_response',
    })
  }
  const usage = normalizeUsage({
    prompt: data?.usage?.prompt_tokens,
    completion: data?.usage?.completion_tokens,
    total: data?.usage?.total_tokens,
  })
  return { text, usage }
}
