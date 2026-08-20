/**
 * Shared inbound consent-keyword detection (ADR-006 D19).
 *
 * Every channel's inbound path routes through this so WhatsApp, SMS, and any
 * future provider agree on what counts as an opt-out. Keyword sets mirror the
 * pre-existing SMS implementation in the Twilio webhook, which was the de-facto
 * precedent before this was extracted.
 *
 * Matching rules, deliberately strict:
 *   - trimmed and upper-cased, then compared for EXACT equality
 *   - never a substring match: "please don't stop the delivery" is a sentence,
 *     not a consent event, and treating it as one would silently mute a paying
 *     customer's thread
 *
 * Why this matters more on WhatsApp than SMS: for SMS the carrier itself
 * blocks traffic after STOP (Twilio error 21610), so our column is a mirror of
 * an upstream truth. On WhatsApp NOTHING upstream enforces opt-out — the
 * column written here is the only record, and the outbound guard's consent
 * check is the only thing standing between a STOP and the next send.
 */

const OPT_OUT_KEYWORDS = new Set([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
]);

const OPT_IN_KEYWORDS = new Set(['START', 'YES', 'UNSTOP']);

export type OptEvent = 'in' | 'out';

/**
 * Classify an inbound message body as a consent event.
 *
 * @returns `'out'` to withdraw consent, `'in'` to restore it, or `null` when
 * the message is ordinary conversation (the overwhelmingly common case).
 */
export function detectOptEvent(body: string | null | undefined): OptEvent | null {
  if (!body) return null;

  const normalized = body.trim().toUpperCase();
  if (!normalized) return null;

  if (OPT_OUT_KEYWORDS.has(normalized)) return 'out';
  if (OPT_IN_KEYWORDS.has(normalized)) return 'in';

  return null;
}
