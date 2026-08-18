import type { UIMessage } from 'ai';

/**
 * Shaping the transcript that goes to the model.
 *
 * Every Mira turn re-sends the whole thread, so this module is both the
 * biggest lever on time-to-first-token AND the place a thread can be
 * silently poisoned. Two separate jobs:
 *
 *   1. BUDGET — keep the prompt small (message count, tool-output size,
 *      total characters) so a long thread doesn't drift into the
 *      model's context limit or pay to replay data it already used.
 *
 *   2. REPAIR — drop tool calls that never resolved. This is the fix
 *      for the "Mira couldn't finish that reply" thread that stays
 *      broken forever: `convertToModelMessages` emits a `tool-call`
 *      for a part left at `input-available` or `approval-requested`
 *      but has no result to pair it with, and every provider rejects a
 *      dangling tool call outright. One interrupted stream (closed
 *      panel, dropped connection, Stop pressed, a write approval the
 *      user ignored and typed past) therefore made EVERY later message
 *      in that thread fail, not just the one that broke.
 *
 * Client-safe: pure functions over UIMessage, no imports beyond types.
 */

/**
 * How many messages the model sees. Every turn re-sends the whole
 * transcript, so this is the single biggest lever on time-to-first-token
 * once threads are persisted and reopened.
 */
export const MODEL_HISTORY_MESSAGES = 12;

/**
 * Cap on a single stored tool result before it is summarised.
 *
 * Read tools return real workspace data — a contact list or pipeline
 * dump is easily tens of kilobytes of JSON. Replaying those verbatim on
 * every subsequent turn is what made long threads crawl: the prompt
 * grew without bound while adding nothing, because the model had
 * already used the data in the answer the user can see.
 */
export const MAX_TOOL_OUTPUT_CHARS = 1_200;

/**
 * Ceiling on the whole compacted transcript.
 *
 * The message cap alone is not a budget: twelve messages can each carry
 * a truncated tool result plus a long answer, and a single pasted wall
 * of text has no cap at all. That silently walks a thread into the
 * model's context window, where the failure arrives from the provider
 * as an opaque 400 rather than as anything the user can act on.
 *
 * ~48k characters is roughly 12k tokens on English prose — comfortably
 * inside the smallest context window any configured provider offers
 * (the defaults here are 128k-class models) while leaving room for the
 * system prompt, the tool schemas and the reply itself.
 */
export const MAX_TRANSCRIPT_CHARS = 48_000;

/**
 * Tool-part states that carry a result the model can consume.
 *
 * Anything else is an in-flight or abandoned call. `approval-responded`
 * is deliberately absent: it means the user answered but execution
 * never finished, so on an older turn it is just as dangling as an
 * unanswered request.
 */
const RESOLVED_TOOL_STATES = new Set([
  'output-available',
  'output-error',
  'output-denied',
]);

type Part = UIMessage['parts'][number];

/** Tool parts are `tool-<name>` (static) or `dynamic-tool`. */
function isToolPart(part: Part): boolean {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool';
}

function isResolvedToolPart(part: Part): boolean {
  if (!isToolPart(part)) return true;
  const state = 'state' in part ? part.state : undefined;
  return typeof state === 'string' && RESOLVED_TOOL_STATES.has(state);
}

/** Rough size of a message, used for the transcript-wide budget. */
function messageChars(message: UIMessage): number {
  let total = 0;
  for (const part of message.parts) {
    if (part.type === 'text' || part.type === 'reasoning') {
      total += part.text?.length ?? 0;
      continue;
    }
    if ('output' in part && part.output !== undefined) {
      total +=
        typeof part.output === 'string'
          ? part.output.length
          : JSON.stringify(part.output).length;
    }
    if ('input' in part && part.input !== undefined) {
      total += JSON.stringify(part.input).length;
    }
  }
  return total;
}

function truncateToolOutputs(message: UIMessage): UIMessage {
  let changed = false;
  const parts = message.parts.map((part) => {
    if (!('output' in part) || part.output === undefined) return part;
    const serialized =
      typeof part.output === 'string' ? part.output : JSON.stringify(part.output);
    if (serialized.length <= MAX_TOOL_OUTPUT_CHARS) return part;
    changed = true;
    return {
      ...part,
      output: `${serialized.slice(0, MAX_TOOL_OUTPUT_CHARS)}… [older result truncated — call the tool again for current data]`,
    };
  });

  return changed ? { ...message, parts: parts as UIMessage['parts'] } : message;
}

function dropUnresolvedToolParts(message: UIMessage): UIMessage {
  if (message.parts.every(isResolvedToolPart)) return message;
  return {
    ...message,
    parts: message.parts.filter(isResolvedToolPart) as UIMessage['parts'],
  };
}

/**
 * Shrink and repair the transcript before it goes to the model.
 *
 * The last message is returned byte-exact and the one before it keeps
 * its tool output verbatim. That is the turn actually being reasoned
 * about: on an approval resend the final assistant message carries the
 * `approval-responded` part the SDK needs to run the approved write, so
 * repairing it would cancel the very action the user just authorised.
 * Everything older is budgeted and repaired.
 *
 * Messages left with no parts (an interrupted turn that was nothing but
 * an unresolved tool call) are dropped rather than sent empty, which
 * some providers reject in its own right.
 */
export function prepareModelTranscript(messages: UIMessage[]): UIMessage[] {
  const recent = messages.slice(-MODEL_HISTORY_MESSAGES);
  const lastIndex = recent.length - 1;

  const shaped = recent.flatMap<UIMessage>((message, index) => {
    if (index === lastIndex) return [message];

    const repaired = dropUnresolvedToolParts(message);
    // Keep the second-to-last message's tool output intact — the final
    // step of the current turn may depend on reading it in full.
    const budgeted =
      index === lastIndex - 1 ? repaired : truncateToolOutputs(repaired);

    return budgeted.parts.length > 0 ? [budgeted] : [];
  });

  return enforceCharBudget(shaped);
}

/**
 * Drop whole messages from the front until the transcript fits.
 *
 * Oldest-first, and never the final message: dropping the turn the user
 * just sent would answer a question nobody asked. A single message over
 * budget on its own is still sent — truncating a user's own words mid
 * sentence produces a confidently wrong answer, where letting the
 * provider reject it yields an error the user can act on.
 */
function enforceCharBudget(messages: UIMessage[]): UIMessage[] {
  if (messages.length === 0) return messages;

  const sizes = messages.map(messageChars);
  let total = sizes.reduce((sum, size) => sum + size, 0);
  let start = 0;

  while (total > MAX_TRANSCRIPT_CHARS && start < messages.length - 1) {
    total -= sizes[start];
    start += 1;
  }

  return start === 0 ? messages : messages.slice(start);
}
