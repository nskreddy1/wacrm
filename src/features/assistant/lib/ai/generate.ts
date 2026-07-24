import {
  AiError,
  type AiEscalationReason,
  type AiSentiment,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types';
import { HANDOFF_SENTINEL, META_SENTINEL } from './defaults';
import { providerLabel } from './errors';
import { getAiEngine } from './engine-flag';
import { generateReplyDirect } from './engines/direct/generate';
import { generateReplyLangChain } from './engines/langchain/generate';
import type { AiConfig } from './types';

// ============================================================
// Shared dispatch layer for chat generation.
//
// `generateReply` keeps the exact public signature callers use
// (auto-reply.ts, validate.ts, /api/ai/draft, /api/ai/playground);
// the platform `ai_engine` flag picks the engine underneath:
//   - 'direct'    → engines/direct (hand-rolled fetch adapters)
//   - 'langchain' → engines/langchain
// Both engines return raw `{ text, usage }`; the empty-response
// check and sentinel/meta parsing below are engine-agnostic.
// ============================================================

export interface GenerateArgs {
  config: AiConfig;
  /** Raw system prompt for one-off calls (credential validation probe).
   *  Chat paths pass `promptParts` instead. */
  systemPrompt?: string;
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[];
  /**
   * Cache-aligned prompt — the standard path for all chat generation
   * (benchmarked ~70% cheaper on full-price input tokens than a single
   * monolithic prompt). `systemBlocks` become the stable system prefix
   * and `volatileContext` (retrieved knowledge) is appended as the
   * FINAL user turn — after the history — so a different retrieval
   * never invalidates the provider's prefix cache. Built by
   * `buildPromptParts`. Wins over `systemPrompt` when both are set.
   */
  promptParts?: { systemBlocks: string[]; volatileContext: string | null };
  /**
   * Stable per-conversation cache-routing hint (we pass the
   * conversation id). Forwarded as OpenAI's `prompt_cache_key`;
   * harmless elsewhere. Only used when `promptParts` is set.
   */
  cacheKey?: string;
}

/**
 * Collapse consecutive same-role turns into one (joined with blank
 * lines). Anthropic requires strictly alternating roles; merging is
 * also harmless for the other providers and keeps the transcript
 * compact.
 */
export function mergeConsecutive(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (last && last.role === m.role) {
      last.content = `${last.content}\n\n${m.content}`;
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

/**
 * Normalize the transcript for the target provider. Anthropic's
 * Messages API additionally requires the turns to begin with `user`,
 * so leading assistant turns (an agent greeting before the customer
 * said anything) are dropped and an empty transcript gets a
 * placeholder — guaranteeing a valid, non-empty payload.
 *
 * Used on the LangChain path; the direct adapters carry their own
 * (identical) normalization internally, preserving their original
 * behavior verbatim.
 */
export function normalizeTurns(
  messages: ChatMessage[],
  provider: AiConfig['provider']
): ChatMessage[] {
  const merged = mergeConsecutive(messages);
  if (provider !== 'anthropic') return merged;
  while (merged.length > 0 && merged[0].role === 'assistant') {
    merged.shift();
  }
  if (merged.length === 0) {
    return [
      { role: 'user', content: '(The customer has not sent a message yet.)' },
    ];
  }
  return merged;
}

/**
 * Generate the next reply from the account's configured provider via
 * whichever engine the platform flag selects, then parse the handoff
 * sentinel / meta line out of the raw text. Throws `AiError` on any
 * provider/network failure — with identical error codes across
 * engines.
 */
export async function generateReply(
  args: GenerateArgs
): Promise<GenerateResult> {
  const { config, promptParts, cacheKey } = args;
  const engine = await getAiEngine();

  // Cache-aligned path: stable blocks form the system prompt; the
  // volatile knowledge context rides as the final user turn so the
  // prefix (system + history) stays byte-identical between calls.
  const systemPrompt = promptParts
    ? promptParts.systemBlocks.join('\n\n')
    : (args.systemPrompt ?? '');
  const messages = promptParts?.volatileContext
    ? [
        ...args.messages,
        { role: 'user' as const, content: promptParts.volatileContext },
      ]
    : args.messages;

  const raw =
    engine === 'langchain'
      ? await generateReplyLangChain({
          config,
          systemPrompt,
          turns: normalizeTurns(messages, config.provider),
        })
      : await generateReplyDirect({
          config,
          systemPrompt,
          messages,
          systemBlocks: promptParts?.systemBlocks,
          cacheKey: promptParts ? cacheKey : undefined,
        });

  const text = raw.text.trim();
  if (!text) {
    throw new AiError(
      `${providerLabel(config.provider)} returned an empty response.`,
      {
        code: 'empty_response',
      }
    );
  }

  return parseGeneration(text, raw.usage);
}

const SENTIMENTS: readonly AiSentiment[] = [
  'angry',
  'frustrated',
  'neutral',
  'happy',
];
const ESCALATION_REASONS: readonly AiEscalationReason[] = [
  'human_requested',
  'angry_customer',
  'out_of_scope',
  'needs_account_data',
  'purchase_ready',
];

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
  usage: AiUsage | null = null
): GenerateResult {
  let sentiment: AiSentiment = 'neutral';
  let escalationReason: AiEscalationReason | null = null;
  let metaEscalate = false;

  let body = raw;
  const metaIdx = raw.lastIndexOf(META_SENTINEL);
  if (metaIdx !== -1) {
    // Everything from the sentinel on is machine metadata — never send
    // it to the customer, even if the JSON turns out to be malformed.
    body = raw.slice(0, metaIdx);
    const tail = raw.slice(metaIdx + META_SENTINEL.length).trim();
    try {
      const meta = JSON.parse(extractJsonObject(tail)) as Record<
        string,
        unknown
      >;
      if (SENTIMENTS.includes(meta.sentiment as AiSentiment)) {
        sentiment = meta.sentiment as AiSentiment;
      }
      metaEscalate = meta.escalate === true;
      if (
        metaEscalate &&
        ESCALATION_REASONS.includes(meta.reason as AiEscalationReason)
      ) {
        escalationReason = meta.reason as AiEscalationReason;
      }
    } catch {
      // Malformed meta → keep the defaults; the reply itself still goes out.
    }
  }

  const handoff = body.includes(HANDOFF_SENTINEL) || metaEscalate;
  const text = body.split(HANDOFF_SENTINEL).join('').trim();
  return { text, handoff, usage, sentiment, escalationReason };
}

/** Best-effort first `{...}` block from the meta tail — providers
 *  occasionally wrap it in code fences or trail whitespace. */
function extractJsonObject(tail: string): string {
  const start = tail.indexOf('{');
  const end = tail.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return tail;
  return tail.slice(start, end + 1);
}
