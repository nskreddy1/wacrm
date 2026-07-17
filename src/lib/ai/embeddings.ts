import { AiError } from './types'
import { getAiEngine } from './engine-flag'
import { embedTextsDirect } from './engines/direct/embeddings'
import { embedTextsLangchain } from './engines/langchain/embeddings'

// ============================================================
// Engine-agnostic embeddings entry point.
//
// Used for the knowledge base's optional semantic-search path: embed
// each chunk at ingest, and embed the query at retrieval. Anthropic has
// no embeddings endpoint, so this is always OpenAI's — the account
// supplies a (possibly separate) embeddings key. 1536-dim
// text-embedding-3-small matches the `vector(1536)` column in
// migration 030.
//
// `embedTexts` keeps the exact public signature callers use
// (knowledge.ts, /api/ai/config) and dispatches to the direct fetch
// adapter or the LangChain client based on the platform-wide
// `ai_engine` flag. Shared shape validation applies to both.
// ============================================================

export { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from './defaults'

/** Format a vector for a pgvector column / RPC param: `[0.1,0.2,...]`.
 *  PostgREST casts this text literal to `vector`; a raw JS array does
 *  not cast reliably. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}

/**
 * Embed a list of strings, preserving input order. Batched by the
 * engine; throws `AiError` on provider/network failure so callers can
 * decide whether to degrade (retrieval) or surface (ingest).
 */
export async function embedTexts(
  apiKey: string,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return []

  const engine = await getAiEngine()
  const out =
    engine === 'langchain'
      ? await embedTextsLangchain(apiKey, inputs)
      : await embedTextsDirect(apiKey, inputs)

  // Engines return vectors in input order; anything else (missing
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
