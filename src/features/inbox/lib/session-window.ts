// ============================================================
// The composer's view of the 24-hour service window (ADR-006 D9).
//
// The server is the boundary (`evaluateOutboundWindow` in
// features/channels) and it is absolute at 24 hours. This module is the
// *display* of that same truth, and it is deliberately **stricter**,
// never laxer:
//
//   - It reads `conversations.last_inbound_at` — the denormalised server
//     column — instead of scanning whichever page of messages happens to
//     be loaded. A long thread whose last inbound fell outside the loaded
//     page used to read as "no customer messages".
//   - A thread with nothing inbound is CLOSED, not open. This is the case
//     the contact_id send path creates (a conversation with zero messages),
//     and the old `!messages.length → { expired: false }` branch let an
//     agent type into it and get a phantom send (critique C6).
//   - It closes the composer `COMPOSER_MARGIN_MS` early, so an agent who
//     starts typing at 23h55m is pushed to a template *before* writing 400
//     characters the server will refuse.
//
// Pure and clock-injected so every branch is unit-testable.
// ============================================================

/** Meta's window. Same constant the server guard uses — their policy. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** How early the composer gives up on free-form. Client-only (D9). */
export const COMPOSER_MARGIN_MS = 10 * 60 * 1000;

export interface SessionWindowInput {
  /** `conversations.last_inbound_at` — the server's truth. */
  lastInboundAt?: string | null;
  /**
   * Newest inbound timestamp visible in the loaded page. Used only when it
   * is *newer* than the column (a realtime message that arrived before the
   * conversation row was refetched), never to override a fresher column.
   */
  loadedInboundAt?: string | null;
  /** Threads that are not WhatsApp have no window and no template regime. */
  channel?: 'whatsapp' | 'sms' | 'email';
  now?: Date | number;
}

export interface SessionWindowState {
  /** Composer must refuse free-form (includes the safety margin). */
  closed: boolean;
  /** Inside the margin band: still legal server-side, about to not be. */
  closingSoon: boolean;
  /** Whether the customer has ever written. `false` ⇒ cold thread. */
  hasInbound: boolean;
  /** Milliseconds until the absolute 24h boundary; 0 once past it. */
  msRemaining: number;
}

const CLOSED_COLD: SessionWindowState = {
  closed: true,
  closingSoon: false,
  hasInbound: false,
  msRemaining: 0,
};

const NO_WINDOW: SessionWindowState = {
  closed: false,
  closingSoon: false,
  hasInbound: true,
  msRemaining: Number.POSITIVE_INFINITY,
};

/** Newest of two possibly-null ISO timestamps, or null when both are unusable. */
function newestTimestamp(
  a?: string | null,
  b?: string | null
): number | null {
  const parsed = [a, b]
    .map((v) => (v ? Date.parse(v) : Number.NaN))
    .filter((n) => Number.isFinite(n));
  return parsed.length > 0 ? Math.max(...parsed) : null;
}

export function evaluateSessionWindow(
  input: SessionWindowInput
): SessionWindowState {
  const channel = input.channel ?? 'whatsapp';
  if (channel !== 'whatsapp') return NO_WINDOW;

  const inboundMs = newestTimestamp(input.lastInboundAt, input.loadedInboundAt);
  if (inboundMs === null) return CLOSED_COLD;

  const nowMs =
    typeof input.now === 'number'
      ? input.now
      : (input.now ?? new Date()).getTime();

  const msRemaining = Math.max(0, WHATSAPP_WINDOW_MS - (nowMs - inboundMs));

  return {
    // `<=` so exactly-at-the-margin is closed: the client is never the
    // looser of the two checks.
    closed: msRemaining <= COMPOSER_MARGIN_MS,
    closingSoon: msRemaining > 0 && msRemaining <= COMPOSER_MARGIN_MS,
    hasInbound: true,
    msRemaining,
  };
}

/** Newest customer message timestamp in a loaded page, or null. */
export function newestInboundInPage(
  messages: readonly { sender_type?: string | null; created_at: string }[]
): string | null {
  let newest: string | null = null;
  for (const m of messages) {
    if (m.sender_type !== 'customer') continue;
    if (newest === null || Date.parse(m.created_at) > Date.parse(newest)) {
      newest = m.created_at;
    }
  }
  return newest;
}
