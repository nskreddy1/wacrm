import { AiError } from './types'
import { getAiEngine } from './engine-flag'
import { embedTextsDirect } from './engines/direct/openai'
import { embedTextsLangChain } from './engines/langchain/embeddings'

// ============================================================
// Shared dispatch layer for embeddings (OpenAI).
//
// Used for the knowledge base's optional semantic-search path: embed
// each chunk at ingest, and embed the query at retrieval. Anthropic has
// no embeddings endpoint, so this is always OpenAI's — the account
// supplies a (possibly separate) embeddings key. 1536-dim
// text-embedding-3-small matches the `vector(1536)` column in
// migration 030.
//
// The same platform `ai_engine` flag that switches chat generation
// also switches embeddings: 'direct' → hand-rolled fetch adapter,
// 'langchain' → LangChain's OpenAIEmbeddings. Post-validation
// (length/order/malformed checks) is shared and applies to both.
// ============================================================

export const EMBEDDING_MODEL = 'text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1536

/** Format a vector for a pgvector column / RPC param: `[0.1,0.2,...]`.
 *  PostgREST casts this text literal to `vector`; a raw JS array does
 *  not cast reliably. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Embed a list of strings, preserving input order, via whichever
 * engine the platform flag selects. Throws `AiError` on
 * provider/network failure so callers can decide whether to degrade
 * (retrieval) or surface (ingest).
 */
export async function embedTexts(
  apiKey: string,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return []

  const engine = await getAiEngine()
  const out =
    engine === 'langchain'
      ? await embedTextsLangChain(apiKey, EMBEDDING_MODEL, inputs)
      : await embedTextsDirect(apiKey, EMBEDDING_MODEL, inputs)

  // Both engines return vectors in input order; anything else (missing
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
