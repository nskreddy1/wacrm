import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { WebhookVerificationError } from '@/lib/ports/payment-provider';

import {
  RAZORPAY_EVENT_ID_HEADER,
  RAZORPAY_SIGNATURE_HEADER,
  verifyRazorpayDelivery,
  type WebhookSecrets,
} from './verify';

/**
 * Tests for the ENTIRE webhook security perimeter (OPEN-2 / Task 5.4).
 *
 * `/api/webhooks/` is a public, unauthenticated prefix, so every
 * assertion here is the only thing standing between the internet and a
 * function that grants paid access. Two rules shape the whole file:
 *
 *   1. Every failure mode is asserted to THROW `WebhookVerificationError`
 *      — never to return a falsy result a caller could forget to check
 *      (ADR-009/F2). `.rejects`-style optimism is what turns a perimeter
 *      into a suggestion.
 *   2. Signatures are COMPUTED here with `node:crypto`, never pasted as
 *      constants. A hardcoded digest silently stops testing the HMAC the
 *      moment the base string changes, which is exactly the refactor
 *      this file exists to catch.
 */

const CURRENT_SECRET = 'whsec_current_2f8c1d';
const PREVIOUS_SECRET = 'whsec_previous_9ab304';

const SECRETS: WebhookSecrets = { current: CURRENT_SECRET };
const ROTATING_SECRETS: WebhookSecrets = {
  current: CURRENT_SECRET,
  previous: PREVIOUS_SECRET,
};

function sign(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

function sha256(rawBody: string): string {
  return crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
}

/** A realistic signed delivery. `rawBody` is a STRING, never an object. */
function delivery(
  rawBody: string,
  options: {
    secret?: string;
    signature?: string;
    eventId?: string | null;
    signatureHeaderName?: string;
    eventIdHeaderName?: string;
  } = {}
) {
  const headers: Record<string, string> = {};

  const signature =
    options.signature ?? sign(rawBody, options.secret ?? CURRENT_SECRET);
  headers[options.signatureHeaderName ?? RAZORPAY_SIGNATURE_HEADER] = signature;

  if (options.eventId !== null) {
    headers[options.eventIdHeaderName ?? RAZORPAY_EVENT_ID_HEADER] =
      options.eventId ?? 'evt_QK1s0mDcXhY7Ab';
  }

  return { rawBody, headers };
}

const VALID_BODY = JSON.stringify({
  entity: 'event',
  account_id: 'acc_Jk9mQrTvBnXw12',
  event: 'subscription.activated',
  created_at: 1_771_000_000,
});

describe('configuration failures fail CLOSED', () => {
  it('rejects when no secrets object is supplied at all', () => {
    const { rawBody, headers } = delivery(VALID_BODY);
    expect(() => verifyRazorpayDelivery(rawBody, headers, undefined)).toThrow(
      WebhookVerificationError
    );
  });

  it('rejects when `current` is an empty string', () => {
    const { rawBody, headers } = delivery(VALID_BODY);
    expect(() => verifyRazorpayDelivery(rawBody, headers, { current: '' })).toThrow(
      /not configured/i
    );
  });

  it('rejects when `current` is only whitespace', () => {
    const { rawBody, headers } = delivery(VALID_BODY);
    expect(() =>
      verifyRazorpayDelivery(rawBody, headers, { current: '   ' })
    ).toThrow(/not configured/i);
  });

  it('an unconfigured deployment accepts NOTHING — not even a body we signed', () => {
    // The dangerous shape of this bug is "no secret ⇒ skip verification".
    // A correctly-signed delivery must still be refused, because an
    // unconfigured deployment cannot tell a real event from a forged one.
    const rawBody = VALID_BODY;
    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: sign(rawBody, CURRENT_SECRET),
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_QK1s0mDcXhY7Ab',
    };
    expect(() => verifyRazorpayDelivery(rawBody, headers, undefined)).toThrow(
      WebhookVerificationError
    );
  });
});

describe('signature header presence', () => {
  it('rejects a delivery with no signature header', () => {
    expect(() =>
      verifyRazorpayDelivery(VALID_BODY, { [RAZORPAY_EVENT_ID_HEADER]: 'evt_1' }, SECRETS)
    ).toThrow(new RegExp(RAZORPAY_SIGNATURE_HEADER));
  });

  it('treats an empty signature header as absent', () => {
    expect(() =>
      verifyRazorpayDelivery(
        VALID_BODY,
        { [RAZORPAY_SIGNATURE_HEADER]: '', [RAZORPAY_EVENT_ID_HEADER]: 'evt_1' },
        SECRETS
      )
    ).toThrow(WebhookVerificationError);
  });

  it('treats a whitespace-only signature header as absent', () => {
    expect(() =>
      verifyRazorpayDelivery(
        VALID_BODY,
        { [RAZORPAY_SIGNATURE_HEADER]: '   ', [RAZORPAY_EVENT_ID_HEADER]: 'evt_1' },
        SECRETS
      )
    ).toThrow(WebhookVerificationError);
  });

  it('reads the signature header case-insensitively', () => {
    // Header casing is not guaranteed across runtimes. A case-sensitive
    // read would reject every real delivery on one platform while
    // passing a fixture-based test on another.
    const { rawBody, headers } = delivery(VALID_BODY, {
      signatureHeaderName: 'X-Razorpay-Signature',
    });
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).not.toThrow();
  });

  it('tolerates surrounding whitespace in the signature header', () => {
    const rawBody = VALID_BODY;
    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: `  ${sign(rawBody, CURRENT_SECRET)}  `,
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_1',
    };
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).not.toThrow();
  });
});

describe('signature verification', () => {
  it('accepts a correctly signed delivery', () => {
    const { rawBody, headers } = delivery(VALID_BODY);
    const result = verifyRazorpayDelivery(rawBody, headers, SECRETS);

    expect(result.matchedSecret).toBe('current');
    expect(result.eventId).toBe('evt_QK1s0mDcXhY7Ab');
    expect(result.body).toEqual(JSON.parse(VALID_BODY));
  });

  it('rejects a signature produced with the wrong secret', () => {
    const { rawBody, headers } = delivery(VALID_BODY, { secret: 'whsec_attacker' });
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).toThrow(
      WebhookVerificationError
    );
  });

  it('rejects a TAMPERED body carrying a signature valid for the original', () => {
    // The canonical forgery: take a real delivery, change the amount,
    // keep the signature.
    const original = JSON.stringify({ event: 'subscription.charged', amount: 100 });
    const tampered = JSON.stringify({ event: 'subscription.charged', amount: 999_999 });

    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: sign(original, CURRENT_SECRET),
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_1',
    };

    expect(() => verifyRazorpayDelivery(tampered, headers, SECRETS)).toThrow(
      WebhookVerificationError
    );
  });

  it('rejects a single-bit change to the body', () => {
    const rawBody = VALID_BODY;
    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: sign(rawBody, CURRENT_SECRET),
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_1',
    };
    expect(() =>
      verifyRazorpayDelivery(`${rawBody} `, headers, SECRETS)
    ).toThrow(WebhookVerificationError);
  });

  it('rejects a non-hex signature instead of silently truncating it', () => {
    // `Buffer.from(x, 'hex')` stops at the first invalid character. Without
    // the hex guard, `'zz' + validPrefix` could decode to a short buffer
    // and a length-equal comparison could be coerced into passing.
    const { rawBody } = delivery(VALID_BODY);
    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: 'not-a-hex-digest',
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_1',
    };
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).toThrow(
      WebhookVerificationError
    );
  });

  it('rejects a VALID digest with non-hex garbage appended', () => {
    // The forgery the hex guard actually exists to stop, and the only
    // one that defeats the length check.
    //
    // `Buffer.from(hex, 'hex')` stops decoding at the first invalid
    // character. So `<64 valid hex chars> + 'zz'` is 66 characters that
    // decode to exactly the 32 expected bytes — the length check passes
    // and `timingSafeEqual` returns TRUE. Verified empirically: without
    // the `/^[0-9a-f]+$/i` guard this delivery is ACCEPTED.
    //
    // It is not exploitable on its own (the attacker still needs a valid
    // digest, which needs the secret), but it means the header is not
    // parsed the way it is compared — and a comparison that accepts
    // inputs its own validator would reject is one refactor away from
    // being reachable.
    const rawBody = VALID_BODY;
    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: `${sign(rawBody, CURRENT_SECRET)}zz`,
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_1',
    };
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).toThrow(
      WebhookVerificationError
    );
  });

  it('rejects a signature whose hex prefix decodes to the right length', () => {
    // Same class, stated as a property: any signature containing a
    // non-hex character must be refused BEFORE decoding, regardless of
    // what its decodable prefix happens to equal.
    const rawBody = VALID_BODY;
    const valid = sign(rawBody, CURRENT_SECRET);
    // Trailing WHITESPACE is deliberately absent from this list: the
    // header read trims, so `valid + ' '` trims back to a valid digest
    // and is correctly accepted. Only non-hex, non-whitespace garbage is
    // a forgery attempt.
    for (const forged of [`${valid}!`, `${valid}g0`, `${valid}zz`, `0x${valid}`]) {
      expect(() =>
        verifyRazorpayDelivery(
          rawBody,
          {
            [RAZORPAY_SIGNATURE_HEADER]: forged,
            [RAZORPAY_EVENT_ID_HEADER]: 'evt_1',
          },
          SECRETS
        )
      ).toThrow(WebhookVerificationError);
    }
  });

  it('rejects a truncated prefix of an otherwise valid signature', () => {
    const rawBody = VALID_BODY;
    const valid = sign(rawBody, CURRENT_SECRET);
    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: valid.slice(0, 32),
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_1',
    };
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).toThrow(
      WebhookVerificationError
    );
  });

  it('rejects an over-long signature', () => {
    const rawBody = VALID_BODY;
    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: `${sign(rawBody, CURRENT_SECRET)}00`,
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_1',
    };
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).toThrow(
      WebhookVerificationError
    );
  });

  it('accepts an uppercase hex signature', () => {
    const rawBody = VALID_BODY;
    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: sign(rawBody, CURRENT_SECRET).toUpperCase(),
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_1',
    };
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).not.toThrow();
  });

  it('does not leak WHICH check failed in the error message', () => {
    // A message naming the failing secret, or the expected digest, hands
    // an attacker a distinguishing oracle.
    const { rawBody, headers } = delivery(VALID_BODY, { secret: 'whsec_attacker' });
    try {
      verifyRazorpayDelivery(rawBody, headers, ROTATING_SECRETS);
      throw new Error('expected a throw');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain(CURRENT_SECRET);
      expect(message).not.toContain(PREVIOUS_SECRET);
      expect(message).not.toContain('current');
      expect(message).not.toContain('previous');
    }
  });
});

describe('raw bytes are the base string', () => {
  it('verifies bytes that would NOT survive a JSON round trip', () => {
    // Key order, whitespace, and number formatting all change under
    // `JSON.parse` → `JSON.stringify`. This body is written so that a
    // re-serialising implementation produces different bytes and fails,
    // while the correct raw-bytes implementation passes. This is the
    // test that catches "parse first, verify later".
    const rawBody = '{ "b": 1,  "a": 2, "amount": 1.50, "nested": {"z": null} }';
    expect(JSON.stringify(JSON.parse(rawBody))).not.toBe(rawBody);

    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: sign(rawBody, CURRENT_SECRET),
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_1',
    };

    const result = verifyRazorpayDelivery(rawBody, headers, SECRETS);
    expect(result.body).toEqual({ b: 1, a: 2, amount: 1.5, nested: { z: null } });
  });

  it('signs UTF-8 bytes, not UTF-16 code units', () => {
    const rawBody = JSON.stringify({ note: 'नमस्ते 🙏', event: 'subscription.charged' });
    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: sign(rawBody, CURRENT_SECRET),
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_1',
    };
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).not.toThrow();
  });
});

describe('parse happens ONLY after the signature verifies', () => {
  it('rejects unsigned malformed JSON as a SIGNATURE failure', () => {
    // If the implementation parsed first, this would surface as a JSON
    // error. It must surface as a signature failure, because an
    // unauthenticated caller is owed no parser feedback.
    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: sign('{}', CURRENT_SECRET),
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_1',
    };
    expect(() => verifyRazorpayDelivery('{not json', headers, SECRETS)).toThrow(
      /signature verification failed/i
    );
  });

  it('rejects a correctly signed body that is not valid JSON', () => {
    const rawBody = '{"unterminated": ';
    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: sign(rawBody, CURRENT_SECRET),
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_1',
    };
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).toThrow(
      /not valid JSON/i
    );
  });
});

describe('event id — required, never synthesised', () => {
  it('rejects a verified delivery with no event-id header', () => {
    // A fabricated id would defeat `UNIQUE (provider, environment,
    // event_id)`: every retry would mint a fresh id and apply again.
    const { rawBody, headers } = delivery(VALID_BODY, { eventId: null });
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).toThrow(
      /refusing to synthesise/i
    );
  });

  it('rejects an empty event-id header', () => {
    const { rawBody, headers } = delivery(VALID_BODY, { eventId: '' });
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).toThrow(
      WebhookVerificationError
    );
  });

  it('rejects a whitespace-only event-id header', () => {
    const { rawBody, headers } = delivery(VALID_BODY, { eventId: '   ' });
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).toThrow(
      WebhookVerificationError
    );
  });

  it('reads the event-id header case-insensitively', () => {
    const { rawBody, headers } = delivery(VALID_BODY, {
      eventIdHeaderName: 'X-Razorpay-Event-Id',
    });
    expect(verifyRazorpayDelivery(rawBody, headers, SECRETS).eventId).toBe(
      'evt_QK1s0mDcXhY7Ab'
    );
  });

  it('returns the event id verbatim, trimmed', () => {
    const { rawBody, headers } = delivery(VALID_BODY, { eventId: ' evt_TRIMMED ' });
    expect(verifyRazorpayDelivery(rawBody, headers, SECRETS).eventId).toBe(
      'evt_TRIMMED'
    );
  });

  it('does NOT derive the event id from the body', () => {
    // Two deliveries, same body, different headers ⇒ different ids. If
    // the id were derived from the payload these would collide and one
    // real event would be dropped as a duplicate.
    const a = delivery(VALID_BODY, { eventId: 'evt_aaa' });
    const b = delivery(VALID_BODY, { eventId: 'evt_bbb' });

    expect(verifyRazorpayDelivery(a.rawBody, a.headers, SECRETS).eventId).toBe(
      'evt_aaa'
    );
    expect(verifyRazorpayDelivery(b.rawBody, b.headers, SECRETS).eventId).toBe(
      'evt_bbb'
    );
  });
});

describe('secret rotation', () => {
  it('reports `current` when the current secret verifies', () => {
    const { rawBody, headers } = delivery(VALID_BODY, { secret: CURRENT_SECRET });
    expect(
      verifyRazorpayDelivery(rawBody, headers, ROTATING_SECRETS).matchedSecret
    ).toBe('current');
  });

  it('accepts a delivery signed with the PREVIOUS secret and flags it', () => {
    // Razorpay retries for up to 24 hours, so a single-secret rotation
    // silently 401s a day of real retries. `previous` must be accepted
    // AND surfaced, so the runbook knows when it is safe to drop it.
    const { rawBody, headers } = delivery(VALID_BODY, { secret: PREVIOUS_SECRET });
    const result = verifyRazorpayDelivery(rawBody, headers, ROTATING_SECRETS);
    expect(result.matchedSecret).toBe('previous');
  });

  it('rejects the previous secret once it is no longer configured', () => {
    const { rawBody, headers } = delivery(VALID_BODY, { secret: PREVIOUS_SECRET });
    expect(() => verifyRazorpayDelivery(rawBody, headers, SECRETS)).toThrow(
      WebhookVerificationError
    );
  });

  it('ignores an empty `previous` rather than treating it as a candidate', () => {
    const { rawBody, headers } = delivery(VALID_BODY, { secret: CURRENT_SECRET });
    const result = verifyRazorpayDelivery(rawBody, headers, {
      current: CURRENT_SECRET,
      previous: '   ',
    });
    expect(result.matchedSecret).toBe('current');
  });

  it('prefers `current` when both secrets are identical', () => {
    const { rawBody, headers } = delivery(VALID_BODY, { secret: CURRENT_SECRET });
    const result = verifyRazorpayDelivery(rawBody, headers, {
      current: CURRENT_SECRET,
      previous: CURRENT_SECRET,
    });
    expect(result.matchedSecret).toBe('current');
  });
});

describe('forensics', () => {
  it('returns the SHA-256 digest of the raw body, not the body', () => {
    const { rawBody, headers } = delivery(VALID_BODY);
    const result = verifyRazorpayDelivery(rawBody, headers, SECRETS);

    expect(result.payloadDigest).toBe(sha256(VALID_BODY));
    expect(result.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('digests differ for bodies differing by one byte', () => {
    const a = delivery('{"a":1}');
    const b = delivery('{"a":2}');
    expect(verifyRazorpayDelivery(a.rawBody, a.headers, SECRETS).payloadDigest).not.toBe(
      verifyRazorpayDelivery(b.rawBody, b.headers, SECRETS).payloadDigest
    );
  });

  it('the digest is not the signature — they must never be conflated', () => {
    const { rawBody, headers } = delivery(VALID_BODY);
    const result = verifyRazorpayDelivery(rawBody, headers, SECRETS);
    expect(result.payloadDigest).not.toBe(sign(VALID_BODY, CURRENT_SECRET));
  });
});

describe('there is deliberately NO replay window', () => {
  it('accepts a genuinely signed delivery regardless of body timestamp age', () => {
    // Razorpay's base string carries no signed timestamp to anchor a
    // freshness check on, and retries run for up to 24 hours. A
    // "reject if older than N minutes" rule cannot stop a forgery (which
    // fails the HMAC at any age) and DOES discard real retries — i.e. it
    // throws away money. Replay is fenced at the event-id claim and,
    // for money effects, again at the ledger's `provider_ref`.
    const ancient = JSON.stringify({
      event: 'subscription.charged',
      created_at: 1_000_000_000, // 2001
    });
    const headers = {
      [RAZORPAY_SIGNATURE_HEADER]: sign(ancient, CURRENT_SECRET),
      [RAZORPAY_EVENT_ID_HEADER]: 'evt_old',
    };
    expect(() => verifyRazorpayDelivery(ancient, headers, SECRETS)).not.toThrow();
  });

  it('verification is pure — the same delivery verifies twice identically', () => {
    // Dedup is the RPC's job, not this function's. If verification were
    // stateful, a legitimate provider retry would fail here with no row
    // written and no way to recover.
    const { rawBody, headers } = delivery(VALID_BODY);
    const first = verifyRazorpayDelivery(rawBody, headers, SECRETS);
    const second = verifyRazorpayDelivery(rawBody, headers, SECRETS);
    expect(first).toEqual(second);
  });
});

describe('dependency rule', () => {
  it('imports no database, framework, or vendor SDK', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/features/billing/lib/razorpay/verify.ts'),
      'utf8'
    );
    const imports = Array.from(
      source.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g),
      (m) => m[1]
    );

    expect(imports).toEqual(['node:crypto', '@/lib/ports/payment-provider']);
    for (const forbidden of ['@supabase', 'next/', 'razorpay', 'stripe']) {
      expect(imports.some((i) => i.includes(forbidden))).toBe(false);
    }
  });

  it('never reads process.env — secrets arrive as an argument', () => {
    // Reading configuration here would make the perimeter untestable and
    // couple it to one deployment's variable names.
    const source = readFileSync(
      join(process.cwd(), 'src/features/billing/lib/razorpay/verify.ts'),
      'utf8'
    );
    expect(source).not.toContain('process.env');
  });

  it('uses timingSafeEqual rather than `===` on the digest', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/features/billing/lib/razorpay/verify.ts'),
      'utf8'
    );
    expect(source).toContain('timingSafeEqual');
  });
});
