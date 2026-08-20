import type { OutboundMessagePayload } from '@/features/channels/lib/contracts';
import type { ChannelKind } from '@/types';

// ============================================================
// ADR-006: the WhatsApp 24-hour window and consent are server-side
// boundaries, evaluated here and nowhere else.
//
// This module is deliberately pure and synchronous: no database, no
// clock of its own, no provider knowledge. Everything it needs is
// passed in, so every branch is reachable in a unit test without a
// credential of any tier (ADR-006 D10) and the orchestrator stays the
// only place that does I/O.
//
// The rule (docs/outbound-messaging.md §1, not ours to negotiate):
// free-form content may only be sent inside a 24-hour window that
// opens when the *customer* writes. Outside it, only an approved
// template is legal.
// ============================================================

/** Meta's window, in milliseconds. Not configurable — it is their policy. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Tolerance for a `last_inbound_at` in the future. Postgres `now()` and this
 * process can disagree by a little; they cannot disagree by an hour. Beyond
 * this, the timestamp is treated as corrupt rather than as a window that is
 * open for another day (ADR-006 F3 — a bad value must not become a bypass).
 */
const FUTURE_SKEW_TOLERANCE_MS = 60 * 60 * 1000;

export type OutboundBlockedCode = 'window_closed' | 'contact_opted_out';

/**
 * Thrown when a send is refused by policy rather than by a provider.
 *
 * Carries an HTTP status so route handlers can map it without re-deriving
 * intent, and joins the typed-error convention from ADR-005.
 */
export class OutboundBlockedError extends Error {
  readonly code: OutboundBlockedCode;
  readonly status: number;

  constructor(code: OutboundBlockedCode, message: string) {
    super(message);
    this.name = 'OutboundBlockedError';
    this.code = code;
    // Both refusals are conflicts with current conversation state, not
    // malformed requests: the same bytes succeed once the customer writes
    // back (window) or opts back in (consent).
    this.status = 409;
  }
}

/**
 * True when the payload counts as free-form for window purposes.
 *
 * ADR-006 D21: this is an **allowlist of what is exempt**, not a blocklist of
 * what is restricted. Only `template` is exempt. Any payload kind added later
 * is therefore restricted by default — the safe direction. Inverting this to
 * `kind === 'text' || kind === 'media' || …` would silently exempt every
 * future kind, which is the bug class this ADR exists to close.
 */
export function isFreeFormPayload(payload: OutboundMessagePayload): boolean {
  return payload.kind !== 'template';
}

export interface OutboundWindowInput {
  channel: ChannelKind;
  /** `conversations.last_inbound_at`. NULL = no inbound ever = closed. */
  lastInboundAt: string | null;
  payload: OutboundMessagePayload;
  /** `contacts.whatsapp_opted_out` for this channel's contact. */
  optedOut: boolean;
  /** Injected for testability; defaults to the real clock. */
  now?: Date;
}

/**
 * Evaluate a single outbound send against consent and the 24-hour window.
 *
 * Returns normally when the send is allowed and throws
 * {@link OutboundBlockedError} when it is not. It never returns a boolean,
 * because a boolean invites a caller to ignore it — the throw is what makes
 * this a boundary instead of advice.
 */
export function evaluateOutboundWindow(input: OutboundWindowInput): void {
  const { channel, lastInboundAt, payload, optedOut } = input;
  const now = input.now ?? new Date();

  // 1. Consent first, and for every channel. Opt-out outranks the window:
  // a template is the way *out* of a closed window, never a way around STOP
  // (ADR-006 D8).
  if (optedOut) {
    throw new OutboundBlockedError(
      'contact_opted_out',
      'This contact has opted out of messages on this channel. Sending is blocked, including approved templates.'
    );
  }

  // 2. The window is a WhatsApp policy. SMS and email have no window and no
  // template regime, so they are unaffected (ADR-006 D10).
  if (channel !== 'whatsapp') return;

  // 3. Templates are legal at any time — this check never rejects one.
  if (!isFreeFormPayload(payload)) return;

  const closed = (detail: string) =>
    new OutboundBlockedError(
      'window_closed',
      `The 24-hour customer service window is closed (${detail}). Send an approved template instead — the customer's reply reopens the window for free-form messages.`
    );

  // 4. No inbound ever: the cold-contact case. Fails closed, the same
  // direction the composer already fails.
  if (lastInboundAt === null) {
    throw closed('this contact has never messaged you');
  }

  const inboundMs = Date.parse(lastInboundAt);

  // 5. An unparseable timestamp is corrupt data, not an open window.
  if (Number.isNaN(inboundMs)) {
    throw closed('the last inbound message time could not be read');
  }

  const elapsed = now.getTime() - inboundMs;

  // 6. A future timestamp beyond tolerance would hold the window open
  // indefinitely, so it is refused rather than trusted.
  if (elapsed < -FUTURE_SKEW_TOLERANCE_MS) {
    throw closed('the last inbound message time is in the future');
  }

  // 7. The boundary itself. `>=` makes exactly-24h closed: at the edge, the
  // provider is the one that would refuse, so we refuse first and keep the
  // phantom send from happening (ADR-006 D5).
  if (elapsed >= WINDOW_MS) {
    const hours = Math.floor(elapsed / (60 * 60 * 1000));
    throw closed(`the customer last messaged ${hours} hours ago`);
  }
}
