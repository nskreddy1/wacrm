import crypto from 'node:crypto';

import { WebhookVerificationError } from '@/lib/ports/payment-provider';

/**
 * Razorpay webhook verification — the ENTIRE security perimeter.
 *
 * `/api/webhooks/` is a public, unauthenticated prefix. Nothing else
 * stands between the internet and a function that grants paid access,
 * so every failure mode in this file must be a throw, never a
 * `{ ok: false }` a caller can forget to check (ADR-009/F2).
 *
 * THE ORDER OF OPERATIONS IS THE SECURITY PROPERTY
 *
 *   1. raw body string   (never a re-serialised object)
 *   2. HMAC-SHA256 over those exact bytes
 *   3. timingSafeEqual on equal-length buffers
 *   4. parse — ONLY after the signature verifies
 *   5. read the event-id header — only now that we know the body is genuine
 *
 * Step 1 is not a style preference. `JSON.parse` then `JSON.stringify`
 * reorders keys, changes number formatting, and drops insignificant
 * whitespace; the resulting bytes will never match the provider's HMAC.
 * Any refactor that parses before verifying breaks authentication for
 * every real delivery while continuing to "work" in a test that reuses
 * one fixture.
 *
 * WHY THERE IS NO REPLAY WINDOW
 * Razorpay's signature is an HMAC over the raw body with the webhook
 * secret. There is no signed timestamp in the base string to anchor a
 * freshness check on, and Razorpay retries failed deliveries with
 * exponential backoff for up to 24 hours. An "older than N minutes ⇒
 * reject" rule cannot stop an attacker (who cannot forge a signature at
 * any age) and does discard legitimate retries — i.e. it throws away
 * money. Event-level replay is fenced by the `UNIQUE (provider,
 * environment, event_id)` claim, and — because the event id is NOT
 * signed — duplicate money effects are fenced again at the ledger by
 * `provider_ref` uniqueness (A35). Freshness is an adapter-local
 * concern: if a future provider signs a timestamp, ITS adapter may
 * enforce one. Never generalise a replay rule into shared code.
 */

/** The header carrying the HMAC-SHA256 hex digest of the raw body. */
export const RAZORPAY_SIGNATURE_HEADER = 'x-razorpay-signature';

/**
 * The header carrying the per-event identifier.
 *
 * Razorpay documents this as the unique id intended for deduplication,
 * and it stays stable across the retries of one delivery. It is
 * **outside the HMAC base string**, so it is provider-supplied but NOT
 * authenticated: it is event *identity*, never verified data.
 */
export const RAZORPAY_EVENT_ID_HEADER = 'x-razorpay-event-id';

/**
 * Which secret in the rotation list verified a delivery.
 *
 * `previous` is the operational signal the rotation runbook reads. It
 * is not an error — Razorpay's own FAQ documents that deliveries in
 * flight when the secret changes still validate against the old secret
 * — but it must stop appearing before the old secret is removed.
 */
export type MatchedSecret = 'current' | 'previous';

export interface VerifiedDelivery {
  /** The parsed body. Untrusted in CONTENT, but genuine in ORIGIN. */
  readonly body: unknown;
  /** From the header. The idempotency claim key component. */
  readonly eventId: string;
  readonly matchedSecret: MatchedSecret;
  /** SHA-256 of the raw body. For forensics — never the payload (F7). */
  readonly payloadDigest: string;
}

/**
 * Candidate secrets, in resolution order.
 *
 * Two entries, not one, because rotation is otherwise a guaranteed
 * outage: the provider's retry window is up to 24 hours, so a
 * single-secret deployment that rotates silently `401`s a day of real
 * retries. `previous` is present only DURING a rotation.
 */
export interface WebhookSecrets {
  readonly current: string;
  readonly previous?: string;
}

/** Case-insensitive header read. Header casing is not guaranteed. */
function header(
  headers: Readonly<Record<string, string>>,
  name: string
): string | undefined {
  const direct = headers[name];
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

/**
 * Constant-time comparison of a received hex digest against an expected one.
 *
 * Compares the RAW BYTES rather than the hex text, and bails on a length
 * mismatch because `timingSafeEqual` throws on unequal lengths — a throw
 * that would otherwise leak "wrong length" as a distinguishable outcome.
 */
function digestMatches(received: string, expectedHex: string): boolean {
  // A malformed (non-hex) header must not reach `Buffer.from`, whose
  // hex decoder silently truncates at the first invalid character —
  // which would let a short prefix compare equal to a truncated buffer.
  if (!/^[0-9a-f]+$/i.test(received)) return false;

  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hmacHex(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Verify a delivery, then parse it. THROWS on every failure.
 *
 * @param rawBody The exact bytes received, as a string. Never re-serialised.
 * @param headers The request headers.
 * @param secrets Ordered rotation candidates. Absent `current` ⇒ throw.
 */
export function verifyRazorpayDelivery(
  rawBody: string,
  headers: Readonly<Record<string, string>>,
  secrets: WebhookSecrets | undefined
): VerifiedDelivery {
  // ── Missing configuration is a rejection, never a "skip" (F2). ──
  //
  // A deployment with no webhook secret cannot distinguish a real event
  // from a forged one, so the only safe behaviour is to accept neither.
  if (!secrets?.current || secrets.current.trim().length === 0) {
    throw new WebhookVerificationError(
      'Razorpay webhook secret is not configured — rejecting delivery'
    );
  }

  const signature = header(headers, RAZORPAY_SIGNATURE_HEADER);
  if (!signature) {
    throw new WebhookVerificationError(
      `Missing ${RAZORPAY_SIGNATURE_HEADER} header`
    );
  }

  // ── Step 2/3: try each candidate secret, current first. ──
  //
  // Every candidate is compared in constant time, and a `previous` hit
  // is recorded rather than merely tolerated: the rotation runbook's
  // "wait until no retries rely on the old secret" step reads that
  // signal, so it has to be observable.
  const candidates: readonly (readonly [MatchedSecret, string])[] = [
    ['current', secrets.current],
    ...(secrets.previous && secrets.previous.trim().length > 0
      ? ([['previous', secrets.previous]] as const)
      : []),
  ];

  let matchedSecret: MatchedSecret | undefined;
  for (const [label, secret] of candidates) {
    if (digestMatches(signature, hmacHex(rawBody, secret))) {
      matchedSecret = label;
      break;
    }
  }

  if (!matchedSecret) {
    // Deliberately opaque: which secret failed, and by how much, is not
    // the sender's business.
    throw new WebhookVerificationError(
      'Razorpay webhook signature verification failed'
    );
  }

  // ── Step 4: parse ONLY now. ──
  //
  // Reaching this line means the bytes are genuinely from Razorpay. The
  // CONTENT is still untrusted — a genuine event may still name an
  // account we must not honour (F3) — but the ORIGIN is settled.
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // A signed body that is not JSON means our secret is paired with a
    // sender we do not understand. Terminal, not retryable.
    throw new WebhookVerificationError(
      'Razorpay webhook body verified but is not valid JSON'
    );
  }

  // ── Step 5: the event id. REQUIRED — never synthesised. ──
  //
  // A fabricated id (from a payload field, a hash, or `now()`) would
  // defeat the `UNIQUE (provider, environment, event_id)` claim that
  // makes redelivery idempotent: every retry would mint a fresh id and
  // apply again. Absent header ⇒ 401 with nothing recorded (A31).
  const eventId = header(headers, RAZORPAY_EVENT_ID_HEADER);
  if (!eventId) {
    throw new WebhookVerificationError(
      `Missing ${RAZORPAY_EVENT_ID_HEADER} header — refusing to synthesise an event id`
    );
  }

  return {
    body,
    eventId,
    matchedSecret,
    payloadDigest: crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex'),
  };
}
