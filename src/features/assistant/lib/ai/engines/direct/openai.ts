import { AiError } from '../../types'
import { MAX_OUTPUT_TOKENS, aiRequestTimeoutMs } from '../../defaults'
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
    /** OpenAI (and some compatible gateways) report the discounted
     *  prefix here when automatic prompt caching hits. */
    prompt_tokens_details?: { cached_tokens?: number }
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
 * (handoff parsing happens in the shared dispatch layer).
 */
export async function generateOpenAi(
  args: ProviderArgs,
  opts: OpenAiCompatOptions = {},
): Promise<ProviderResult> {
  const { apiKey, model, systemPrompt, messages, timeoutMs, cacheKey } = args
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
        // Cache-routing hint (conversation id): OpenAI uses it to route
        // requests to the machine holding this conversation's cached
        // prefix, raising hit rates. Only OpenAI proper understands it —
        // compatible gateways may reject unknown params, so gate it.
        ...(isOpenAiProper && cacheKey ? { prompt_cache_key: cacheKey } : {}),
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
    cached: data?.usage?.prompt_tokens_details?.cached_tokens,
  })
  return { text, usage }
}

// ============================================================
// Embeddings (direct OpenAI fetch), restored from the
// pre-LangChain implementation. Batched; throws `AiError` on
// provider/network failure. Model/dimension constants live in
// the shared dispatch layer (src/lib/ai/embeddings.ts).
// ============================================================

const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'

// OpenAI accepts an array input; keep batches modest so a big re-index
// stays under request-size limits and partial failures are cheap.
const BATCH_SIZE = 96

interface EmbeddingResponse {
  data?: { embedding?: number[]; index?: number }[]
}

/**
 * Embed a list of strings against OpenAI's embeddings endpoint,
 * preserving input order. Used when the platform `ai_engine` flag is
 * set to `direct`.
 */
export async function embedTextsDirect(
  apiKey: string,
  model: string,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return []
  const timeoutMs = aiRequestTimeoutMs()
  const out: number[][] = []

  for (let start = 0; start < inputs.length; start += BATCH_SIZE) {
    const batch = inputs.slice(start, start + BATCH_SIZE)

    let res: Response
    try {
      res = await fetch(OPENAI_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, input: batch }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (err) {
      throw toNetworkError(err)
    }

    if (!res.ok) {
      throw await providerHttpError('OpenAI embeddings', res)
    }

    const data = (await res.json().catch(() => null)) as EmbeddingResponse | null
    const rows = data?.data
    if (!rows || rows.length !== batch.length) {
      throw new AiError('Embeddings response was malformed.', {
        code: 'embeddings_malformed',
      })
    }

    // Sort by index so order matches the input batch regardless of how
    // the provider returns them. Require a real numeric index — defaulting
    // a missing one to 0 would silently misalign chunks with their
    // vectors (chunk N gets chunk M's embedding), so fail loud instead.
    if (rows.some((r) => typeof r.index !== 'number')) {
      throw new AiError('Embeddings response was missing result indices.', {
        code: 'embeddings_malformed',
      })
    }
    const ordered = [...rows].sort((a, b) => a.index! - b.index!)
    for (const r of ordered) {
      if (!Array.isArray(r.embedding)) {
        throw new AiError('Embeddings response missing a vector.', {
          code: 'embeddings_malformed',
        })
      }
      out.push(r.embedding)
    }
  }

  return out
}
