import { OpenAIEmbeddings } from '@langchain/openai'
import { aiRequestTimeoutMs } from '../../defaults'
import { toAiError } from '../../errors'

// ============================================================
// LangChain engine — embeddings (OpenAI). Selected when the platform
// `ai_engine` flag is `langchain`. Shape validation (length/order)
// happens in the shared dispatch layer (src/lib/ai/embeddings.ts).
// ============================================================

// OpenAI accepts an array input; keep batches modest so a big re-index
// stays under request-size limits and partial failures are cheap.
const BATCH_SIZE = 96

/**
 * Embed a list of strings via LangChain's OpenAI embeddings client,
 * preserving input order. Throws `AiError` on provider/network failure.
 */
export async function embedTextsLangChain(
  apiKey: string,
  model: string,
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return []

  const embeddings = new OpenAIEmbeddings({
    apiKey,
    model,
    batchSize: BATCH_SIZE,
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
