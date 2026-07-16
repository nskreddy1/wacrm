import { OpenAIEmbeddings } from '@langchain/openai'
import { AiError } from './types'
import { aiRequestTimeoutMs } from './defaults'
import { toAiError } from './model'

// ============================================================
// Embeddings (OpenAI, via LangChain).
//
// Used for the knowledge base's optional semantic-search path: embed
// each chunk at ingest, and embed the query at retrieval. Anthropic has
// no embeddings endpoint, so this is always OpenAI's — the account
// supplies a (possibly separate) embeddings key. 1536-dim
// text-embedding-3-small matches the `vector(1536)` column in
// migration 030.
// ============================================================

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536

// OpenAI accepts an array input; keep batches modest so a big re-index
// stays under request-size limits and partial failures are cheap.
const BATCH_SIZE = 96

/** Format a vector for a pgvector column / RPC param: `[0.1,0.2,...]`.
 *  PostgREST casts this text literal to `vector`; a raw JS array does
 *  not cast reliably. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Embed a list of strings, preserving input order. Batched by the
 * LangChain client; throws `AiError` on provider/network failure so
 * callers can decide whether to degrade (retrieval) or surface
 * (ingest).
 */
export async function embedTexts(
  apiKey: string,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return []

  const embeddings = new OpenAIEmbeddings({
    apiKey,
    model: EMBEDDING_MODEL,
    batchSize: BATCH_SIZE,
    timeout: aiRequestTimeoutMs(),
    // Single attempt, matching the old fetch adapter — callers decide
    // whether/when to retry.
    maxRetries: 0,
  })

  let out: number[][]
  try {
    out = await embeddings.embedDocuments(inputs)
  } catch (err) {
    throw toAiError(err, 'OpenAI embeddings')
  }

  // The client returns vectors in input order; anything else (missing
  // rows, non-vector entries) means a malformed provider response —
  // fail loud rather than silently misalign chunks with their vectors.
  if (!Array.isArray(out) || out.length !== inputs.length) {
    throw new AiError('Embeddings response was malformed.', {
      code: 'embeddings_malformed',
    })
  }
  for (const vec of out) {
    if (!Array.isArray(vec)) {
      throw new AiError('Embeddings response missing a vector.', {
        code: 'embeddings_malformed',
      })
    }
  }

  return out
}
