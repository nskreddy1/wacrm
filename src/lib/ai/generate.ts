import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import {
  AiError,
  type AiEscalationReason,
  type AiSentiment,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import {
  HANDOFF_SENTINEL,
  META_SENTINEL,
  aiRequestTimeoutMs,
} from './defaults'
import {
  normalizeLcUsage,
  providerLabel,
  resolveChatModel,
  toAiError,
} from './model'
import type { AiConfig } from './types'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Collapse consecutive same-role turns into one (joined with blank
 * lines). Anthropic requires strictly alternating roles; merging is
 * also harmless for the other providers and keeps the transcript
 * compact.
 */
export function mergeConsecutive(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const m of messages) {
    const last = out[out.length - 1]
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`
    } else {
      out.push({ role: m.role, content: m.content })
    }
  }
  return out
}

/**
 * Normalize the transcript for the target provider. Anthropic's
 * Messages API additionally requires the turns to begin with `user`,
 * so leading assistant turns (an agent greeting before the customer
 * said anything) are dropped and an empty transcript gets a
 * placeholder — guaranteeing a valid, non-empty payload.
 */
function normalizeTurns(
  messages: ChatMessage[],
  provider: AiConfig['provider'],
): ChatMessage[] {
  const merged = mergeConsecutive(messages)
  if (provider !== 'anthropic') return merged
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift()
  }
  if (merged.length === 0) {
    return [{ role: 'user', content: '(The customer has not sent a message yet.)' }]
  }
  return merged
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
 * Generate the next reply from the account's configured provider.
 * Resolves the LangChain chat model, invokes it with the transcript,
 * then parses the handoff sentinel out of the raw text. Throws
 * `AiError` on any provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
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
      // Same env-driven per-call timeout as the old fetch adapters.
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

  const usage: AiUsage | null = normalizeLcUsage(response.usage_metadata)
  return parseGeneration(text, usage)
}

const SENTIMENTS: readonly AiSentiment[] = [
  'angry',
  'frustrated',
  'neutral',
  'happy',
]
const ESCALATION_REASONS: readonly AiEscalationReason[] = [
  'human_requested',
  'angry_customer',
  'out_of_scope',
  'needs_account_data',
  'purchase_ready',
]

/**
 * Split the raw model output into `{ text, handoff, usage, sentiment,
 * escalationReason }`.
 *
 * Two markers are parsed and stripped, both tolerant of absence:
 *   - `[[META]]{...json...}` — the trailing classification line. Missing
 *     or malformed → defaults `{sentiment:'neutral', escalate:false}` so
 *     a model that ignores the instruction degrades gracefully.
 *   - `[[HANDOFF]]` — the legacy bare sentinel, kept as a fallback so
 *     nothing breaks mid-deploy; it forces `handoff` even without meta.
 *
 * `usage` is passed straight through (null when the provider didn't
 * report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  let sentiment: AiSentiment = 'neutral'
  let escalationReason: AiEscalationReason | null = null
  let metaEscalate = false

  let body = raw
  const metaIdx = raw.lastIndexOf(META_SENTINEL)
  if (metaIdx !== -1) {
    // Everything from the sentinel on is machine metadata — never send
    // it to the customer, even if the JSON turns out to be malformed.
    body = raw.slice(0, metaIdx)
    const tail = raw.slice(metaIdx + META_SENTINEL.length).trim()
    try {
      const meta = JSON.parse(extractJsonObject(tail)) as Record<string, unknown>
      if (SENTIMENTS.includes(meta.sentiment as AiSentiment)) {
        sentiment = meta.sentiment as AiSentiment
      }
      metaEscalate = meta.escalate === true
      if (
        metaEscalate &&
        ESCALATION_REASONS.includes(meta.reason as AiEscalationReason)
      ) {
        escalationReason = meta.reason as AiEscalationReason
      }
    } catch {
      // Malformed meta → keep the defaults; the reply itself still goes out.
    }
  }

  const handoff = body.includes(HANDOFF_SENTINEL) || metaEscalate
  const text = body.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage, sentiment, escalationReason }
}

/** Best-effort first `{...}` block from the meta tail — providers
 *  occasionally wrap it in code fences or trail whitespace. */
function extractJsonObject(tail: string): string {
  const start = tail.indexOf('{')
  const end = tail.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return tail
  return tail.slice(start, end + 1)
}
