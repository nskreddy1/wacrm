import type { AiConfig, ChatMessage } from './types'

// ============================================================
// Engine-agnostic transcript normalization, shared by both AI
// engines (direct fetch adapters and LangChain).
// ============================================================

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
export function normalizeTurns(
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
