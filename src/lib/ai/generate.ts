import type {
  AiConfig,
  AiEscalationReason,
  AiSentiment,
  AiUsage,
  ChatMessage,
  GenerateResult,
} from './types'
import { HANDOFF_SENTINEL, META_SENTINEL } from './defaults'
import { getAiEngine } from './engine-flag'
import { generateDirect } from './engines/direct/generate'
import { generateLangchain } from './engines/langchain/generate'

// ============================================================
// Engine-agnostic generation entry point.
//
// `generateReply` keeps the exact public signature callers use
// (auto-reply, validate, /api/ai/draft, /api/ai/playground) and
// dispatches to the direct fetch adapters or the LangChain engine
// based on the platform-wide `ai_engine` flag. Both engines return
// raw { text, usage }; sentinel/meta parsing is shared here.
// ============================================================

// Transcript merging is engine-agnostic — re-exported for API compat.
export { mergeConsecutive } from './turns'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider via
 * the currently-flagged engine, then parse the handoff sentinel /
 * [[META]] tail out of the raw text. Throws `AiError` on any
 * provider/network failure — identical error codes on both engines.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const engine = await getAiEngine()
  const raw =
    engine === 'langchain'
      ? await generateLangchain(args)
      : await generateDirect(args)
  return parseGeneration(raw.text, raw.usage)
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
