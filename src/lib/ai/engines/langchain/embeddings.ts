import { OpenAIEmbeddings } from '@langchain/openai'
import {
  EMBEDDING_BATCH_SIZE,
  EMBEDDING_MODEL,
  aiRequestTimeoutMs,
} from '../../defaults'
import { toAiError } from '../../errors'

// ============================================================
// LangChain OpenAI embeddings engine. Returns the raw vectors —
// shared shape validation lives in the `embedTexts` dispatcher.
// ============================================================

/**
 * Embed a list of strings via the LangChain OpenAI embeddings client,
 * preserving input order. Batched by the client; throws `AiError` on
 * provider/network failure.
 */
export async function embedTextsLangchain(
  apiKey: string,
  inputs: string[],
): Promise<number[][]> {
  const embeddings = new OpenAIEmbeddings({
    apiKey,
    model: EMBEDDING_MODEL,
    batchSize: EMBEDDING_BATCH_SIZE,
    timeout: aiRequestTimeoutMs(),
    // Single attempt, matching the direct fetch adapter — callers decide
    // whether/when to retry.
    maxRetries: 0,
  })

  try {
    return await embeddings.embedDocuments(inputs)
  } catch (err) {
    throw toAiError(err, 'OpenAI embeddings')
  }
}
