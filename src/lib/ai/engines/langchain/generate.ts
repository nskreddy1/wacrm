import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
} from '../../types'
import { aiRequestTimeoutMs } from '../../defaults'
import { normalizeTurns } from '../../turns'
import { providerLabel, toAiError } from '../../errors'
import { normalizeLcUsage, resolveChatModel } from './model'

// ============================================================
// LangChain engine: resolves an AiConfig to a LangChain chat model,
// invokes it with the transcript, and returns the RAW { text, usage }
// — sentinel/meta parsing stays in the shared `generateReply`
// dispatcher.
// ============================================================

export interface LangchainGenerateArgs {
  config: AiConfig
  systemPrompt: string
  messages: ChatMessage[]
}

/** Map our provider-agnostic turns to LangChain message objects. */
function toLcMessages(
  systemPrompt: string,
  turns: ChatMessage[],
): BaseMessage[] {
  return [
    new SystemMessage(systemPrompt),
    ...turns.map((m) =>
      m.role === 'assistant'
        ? new AIMessage(m.content)
        : new HumanMessage(m.content),
    ),
  ]
}

/** Extract the plain assistant text from a LangChain message content
 *  value (string, or an array of typed content parts). */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (
          part &&
          typeof part === 'object' &&
          (part as { type?: unknown }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string'
        ) {
          return (part as { text: string }).text
        }
        return ''
      })
      .join('')
  }
  return ''
}

/**
 * Generate the next reply via LangChain. Throws `AiError` on any
 * provider/network failure, using the same error codes as the direct
 * engine.
 */
export async function generateLangchain(
  args: LangchainGenerateArgs,
): Promise<{ text: string; usage: AiUsage | null }> {
  const { config, systemPrompt, messages } = args
  const label = providerLabel(config.provider)

  // Config problems (missing base URL, unknown provider) throw typed
  // AiErrors synchronously — let them propagate untouched.
  const model = resolveChatModel(config)
  const lcMessages = toLcMessages(
    systemPrompt,
    normalizeTurns(messages, config.provider),
  )

  let response
  try {
    response = await model.invoke(lcMessages, {
      // Same env-driven per-call timeout as the direct fetch adapters.
      signal: AbortSignal.timeout(aiRequestTimeoutMs()),
    })
  } catch (err) {
    throw toAiError(err, label)
  }

  const text = contentToText(response.content).trim()
  if (!text) {
    throw new AiError(`${label} returned an empty response.`, {
      code: 'empty_response',
    })
  }

  return { text, usage: normalizeLcUsage(response.usage_metadata) }
}
