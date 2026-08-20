// ============================================================
// The inbox's "New message" flow, as pure functions (ADR-006 D13/D14).
//
// A business-initiated conversation is the one outbound case where the
// 24-hour service window is *always* closed: the contact has never
// written, so `conversations.last_inbound_at` is null and
// `evaluateOutboundWindow` refuses anything that isn't a template.
// The UI therefore has to open in template-only mode rather than
// discovering the block by round-tripping a free-form send.
//
// Both functions here are pure so the dialog's decisions — which
// contacts match what the agent typed, and what a given send response
// means — are unit-testable without React, Supabase, or Meta.
// ============================================================

/**
 * The subset of a contact row the picker needs. Deliberately narrow: the
 * dialog only ever renders a name, a phone, and an email, and every
 * field except `id` is optional because `contacts` allows nulls.
 */
export interface ContactCandidate {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
}

/**
 * What the send route's response means for the compose UI. Modelled as a
 * closed union so the dialog must handle every branch — the failure
 * modes here are policy outcomes (ADR-006 D4), not generic errors, and
 * each one needs a different recovery path.
 */
export type SendOutcome =
  /** Meta accepted it. `conversationId` is null only if the route omitted it. */
  | { kind: 'sent'; conversationId: string | null }
  /** 24h window shut: free-form is impossible, a template is the only way in. */
  | { kind: 'window_closed' }
  /** Contact sent STOP. Terminal — no template gets through either. */
  | { kind: 'opted_out' }
  /** Per-user send budget spent. Retryable once the bucket refills. */
  | { kind: 'rate_limited'; retryAfterSeconds: number | null }
  /** Anything else, carrying whatever the server said. */
  | { kind: 'error'; message: string };

/** Digits only, so a typed query matches a stored phone whatever the formatting. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Does this contact match what the agent typed?
 *
 * Runs client-side over the already-fetched contact page, so filtering is
 * instant (no request per keystroke — ADR-006 D13 wants the picker to feel
 * like local search).
 *
 * Matches a name or email as a case-insensitive substring, and a phone by
 * digits alone: an agent who types `5550101234`, `+1 555 010 1234`, or
 * `(555) 010-1234` should all find `+1 (555) 010-1234`. A blank query is
 * treated as unfiltered so the picker shows the full list on open.
 */
export function matchesContactQuery(
  contact: ContactCandidate,
  query: string
): boolean {
  const trimmed = query.trim();
  if (!trimmed) return true;

  const needle = trimmed.toLowerCase();

  const name = contact.name?.toLowerCase() ?? '';
  if (name && name.includes(needle)) return true;

  const email = contact.email?.toLowerCase() ?? '';
  if (email && email.includes(needle)) return true;

  // Phone is compared on digits only. Guarded on the query actually
  // containing digits, otherwise a text query like "zzz" would reduce to
  // an empty string and `includes('')` would match every contact.
  const queryDigits = digitsOf(trimmed);
  if (queryDigits) {
    const phoneDigits = digitsOf(contact.phone ?? '');
    if (phoneDigits && phoneDigits.includes(queryDigits)) return true;
  }

  return false;
}

/**
 * Substitute a template's positional `{{n}}` placeholders for preview.
 *
 * An unfilled slot is left as the literal `{{n}}` rather than collapsing
 * to an empty string, so an agent looking at the preview can see the gap
 * instead of sending a sentence with a hole in it.
 *
 * Shared by the compose sheet's preview bubble and the thread's optimistic
 * message, so both render a pending template identically.
 */
export function renderTemplatePreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw: string) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

/** Narrow an unknown JSON body to a string field without trusting its shape. */
function stringField(
  body: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  const value = body?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Same, for the numeric retry hint. */
function numberField(
  body: Record<string, unknown> | null | undefined,
  key: string
): number | null {
  const value = body?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const GENERIC_ERROR = 'Could not send the message. Please try again.';

/**
 * Translate an HTTP status + JSON body from `/api/whatsapp/send` into a
 * `SendOutcome`.
 *
 * The two 409 codes are the contract from ADR-006 D4 — the route forwards
 * `SendMessageError.code` precisely so the client can distinguish
 * "template required" from "never contact this person again" instead of
 * showing one indistinct red toast.
 *
 * Fails closed on an unrecognised 409: a new policy code the client
 * doesn't know about surfaces as a plain error (with the server's own
 * message) rather than being silently optimistically retried.
 */
export function resolveSendOutcome(
  status: number,
  body: Record<string, unknown> | null | undefined
): SendOutcome {
  if (status >= 200 && status < 300) {
    return {
      kind: 'sent',
      conversationId: stringField(body, 'conversation_id'),
    };
  }

  if (status === 409) {
    const code = stringField(body, 'code');
    if (code === 'window_closed') return { kind: 'window_closed' };
    if (code === 'contact_opted_out') return { kind: 'opted_out' };
    return {
      kind: 'error',
      message: stringField(body, 'error') ?? GENERIC_ERROR,
    };
  }

  if (status === 429) {
    // `retry_after_seconds` is what `rateLimitResponse` actually sends;
    // `retry_after` is accepted too so either spelling works.
    return {
      kind: 'rate_limited',
      retryAfterSeconds:
        numberField(body, 'retry_after') ??
        numberField(body, 'retry_after_seconds'),
    };
  }

  return { kind: 'error', message: stringField(body, 'error') ?? GENERIC_ERROR };
}
