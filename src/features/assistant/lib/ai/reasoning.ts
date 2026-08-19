// ============================================================
// Chain-of-thought containment.
//
// Every adapter in this codebase asks a general-purpose chat model
// for ONE thing: the message text to send a customer. Reasoning
// models break that contract in two different ways, and a customer on
// WhatsApp saw both:
//
//   1. INLINE THOUGHT TAGS. DeepSeek-R1, Qwen/QwQ, and the distills
//      served through OpenRouter/Groq/Together wrap their scratchpad
//      in `<think>…</think>` inside `message.content` — the same field
//      a non-reasoning model puts the answer in. Whoever reads
//      `content` naively ships the scratchpad.
//
//   2. TRUNCATED THOUGHT. When `max_tokens` is spent before the model
//      finishes thinking, there is no answer at all — only an
//      unterminated scratchpad. That is what produced the production
//      incident: a wall of "Here's a thinking process: 1. Analyze
//      User Input…" delivered to a customer, cut off mid-sentence,
//      quoting our own system prompt back at them.
//
// The provider-side fixes (turn Gemini's thinking off, ignore
// `reasoning_content`) live in the adapters. This module is the
// last line of defence that runs on EVERY provider's output,
// including ones we have never heard of behind a `custom` base URL.
// ============================================================

/**
 * Opening/closing scratchpad delimiters, by family. Order matters only
 * in that each pair is tried independently; a response may use one
 * pair, several, or none.
 *
 * Kept as literal strings (not one big regex) so an unterminated block
 * can be detected — which is the case that mattered in production.
 */
const THOUGHT_DELIMITERS: readonly { open: string; close: string }[] = [
  { open: '<think>', close: '</think>' },
  { open: '<thinking>', close: '</thinking>' },
  { open: '<reason>', close: '</reason>' },
  { open: '<reasoning>', close: '</reasoning>' },
  { open: '<reflection>', close: '</reflection>' },
  // Kimi / Moonshot serve these full-width brackets.
  { open: '◁think▷', close: '◁/think▷' },
  // Some Llama-3 reasoning distills use the special-token form.
  { open: '<|begin_of_thought|>', close: '<|end_of_thought|>' },
];

/**
 * Strip model scratchpad from raw provider text.
 *
 * Three shapes, all seen in the wild:
 *   - `…<think>plan</think>answer` → the answer.
 *   - `<think>plan` (unterminated: token budget ran out mid-thought)
 *     → empty string. There IS no answer, and the caller must treat
 *     the turn as a failure rather than send half a scratchpad.
 *   - `plan</think>answer` (opener swallowed by the provider, common
 *     when reasoning is streamed on a separate channel) → the answer.
 */
export function stripThoughtBlocks(raw: string): string {
  let out = raw;

  for (const { open, close } of THOUGHT_DELIMITERS) {
    // Closed blocks, repeatedly — a model may think more than once.
    for (;;) {
      const start = out.indexOf(open);
      if (start === -1) break;
      const end = out.indexOf(close, start + open.length);
      if (end === -1) {
        // Unterminated: everything from the opener on is scratchpad,
        // and nothing after it will ever arrive.
        out = out.slice(0, start);
        break;
      }
      out = out.slice(0, start) + out.slice(end + close.length);
    }

    // Orphaned closer with no opener: the scratchpad came through
    // without its delimiter, so the answer is what follows.
    const orphan = out.lastIndexOf(close);
    if (orphan !== -1) {
      out = out.slice(orphan + close.length);
    }
  }

  return out.trim();
}

/**
 * Signatures of a reply that is actually a scratchpad wearing no tags.
 *
 * Deliberately anchored to the START of the output and deliberately
 * narrow. A false positive here silences a perfectly good reply, so
 * these match only phrasings no customer-facing message would open
 * with — "Here's a thinking process:", "**Analyze User Input**",
 * "I need to figure out…". A genuine reply that happens to contain
 * the word "think" ("I think we have that in stock") never matches,
 * because the phrase has to be the opening of the message.
 */
const REASONING_OPENERS: readonly RegExp[] = [
  /^(?:here(?:'|’)?s|here is)\s+(?:my|a|the)?\s*(?:thinking|thought|reasoning|internal)\b/i,
  /^(?:thinking|reasoning|thought)\s*(?:process|steps?)\s*[:\-–]/i,
  /^(?:let(?:'|’)?s|let me|i need to|i should|i will)\s+(?:first\s+)?(?:think|reason|analy[sz]e|work out|figure out|break (?:this|it) down)\b/i,
  /^\**\s*(?:step\s*1|1\.)\s*\**\s*(?:analy[sz]e|identify|understand|check)\b/i,
  /^\**(?:analy[sz]e|identify)\s+(?:the\s+)?(?:user|customer)\s+(?:input|message|request)\**/i,
  // `[\s\S]` rather than the `s` flag: the build targets ES2017.
  /^the\s+(?:user|customer)\s+is\s+(?:sending|asking|saying)\b[\s\S]*\bi\s+(?:need|should|must)\b/i,
];

/**
 * Does this text read as chain-of-thought rather than a reply?
 *
 * Used as a hard stop in auto-reply, where there is no human to catch
 * it: a suppressed reply leaves the inbound sitting in the inbox for a
 * teammate, which is recoverable — shipping the scratchpad to the
 * customer is not.
 */
export function looksLikeReasoning(text: string): boolean {
  const flat = text.trim();
  if (!flat) return false;
  return REASONING_OPENERS.some((re) => re.test(flat));
}

/**
 * Does the output quote our own instructions back at the customer?
 *
 * A model that ran out of budget mid-thought tends to be paraphrasing
 * the system prompt at the moment it gets cut off — that is exactly
 * what reached the customer in the incident ("After reply, end with
 * exact format:"). These fragments are ours, appear nowhere in a real
 * customer reply, and are cheap to check.
 */
const PROMPT_ECHOES: readonly string[] = [
  'warm handoff',
  'machine-read',
  'system prompt',
  'internal reference',
  'crm data',
  'end with exact format',
  'end your output with exactly one final line',
  'output only the message text',
];

export function leaksPrompt(text: string): boolean {
  const lower = text.toLowerCase();
  return PROMPT_ECHOES.some((needle) => lower.includes(needle));
}
