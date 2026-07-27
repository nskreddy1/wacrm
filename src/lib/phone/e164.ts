/**
 * Single source of truth for turning arbitrary phone input into E.164.
 *
 * Why this exists
 * ---------------
 * Phone numbers entered the system through four paths that each formatted
 * them differently, so the "same" number was stored several ways and the
 * validator rejected most of them:
 *
 *   - Manual create: the country picker produced proper `+<cc><number>`.
 *   - WhatsApp/SMS inbound: Meta and Twilio send digits only, and the
 *     webhook stored `normalizePhone()` output — which strips `+`. A
 *     contact from India landed as `918328510888`.
 *   - CSV import: whatever the spreadsheet happened to contain.
 *   - AI agent / public API: whatever the caller passed.
 *
 * Validation used libphonenumber's `isValidPhoneNumber`, which *requires*
 * a leading `+`. So every number written by the inbound, import, and agent
 * paths failed validation even though the digits were correct.
 *
 * Everything that writes `contacts.phone` now runs through `toE164()` so
 * stored numbers are always `+<countrycode><number>`.
 *
 * Possible vs. valid
 * ------------------
 * We gate on `isPossible()` (right number of digits for the country), not
 * `isValid()` (digits map to a real, assignable range). A CRM must accept
 * numbers libphonenumber's metadata doesn't recognise yet, plus reserved
 * test ranges like `+1 555 500 0001`. `isValid()` is still used to *rank*
 * interpretations below, just never to reject outright.
 */

import {
  parsePhoneNumberFromString,
  getExampleNumber,
  type CountryCode,
} from 'libphonenumber-js';
import examples from 'libphonenumber-js/examples.mobile.json';

/** Default country for bare national numbers when none is supplied. */
export const DEFAULT_PHONE_COUNTRY: CountryCode = 'US';

export interface NormalizedPhone {
  /** Canonical `+<cc><number>` form. Store this in `contacts.phone`. */
  e164: string;
  /** ISO country, when it could be determined. */
  country?: CountryCode;
  /**
   * Digits only, no `+`. For comparison keys (`normalized_identity`,
   * dedupe) and for provider APIs like Meta that reject the `+`.
   */
  digits: string;
}

/** Strip channel prefixes and separators providers add. */
function clean(raw: string): string {
  return raw
    .trim()
    .replace(/^(?:whatsapp|sms|tel|phone):\s*/i, '')
    .replace(/[\s\-().\u00a0\u2010-\u2015]/g, '');
}

function build(
  parsed: NonNullable<ReturnType<typeof parsePhoneNumberFromString>>
): NormalizedPhone {
  return {
    e164: parsed.number,
    country: parsed.country,
    digits: parsed.number.replace(/\D/g, ''),
  };
}

function attempt(
  input: string,
  country: CountryCode | undefined,
  require: 'valid' | 'possible'
): NormalizedPhone | null {
  let parsed;
  try {
    parsed = parsePhoneNumberFromString(input, country);
  } catch {
    return null;
  }
  if (!parsed) return null;
  const ok = require === 'valid' ? parsed.isValid() : parsed.isPossible();
  return ok ? build(parsed) : null;
}

/** Cache of `country -> length of a typical national number`. */
const nationalLengthCache = new Map<CountryCode, number | undefined>();

/**
 * How many digits a normal national number has in `country` (10 for US
 * and IN, 9 for AE, 8 for LT…). Derived from libphonenumber's own example
 * numbers so it stays correct as metadata is updated.
 */
function nationalLength(country: CountryCode): number | undefined {
  if (!nationalLengthCache.has(country)) {
    let length: number | undefined;
    try {
      length = getExampleNumber(country, examples)?.nationalNumber.length;
    } catch {
      length = undefined;
    }
    nationalLengthCache.set(country, length);
  }
  return nationalLengthCache.get(country);
}

/**
 * Normalize any phone input to E.164, or return `null` if it can't be.
 *
 * Deciding whether bare digits already include a country code
 * ------------------------------------------------------------
 * `918328510888` and `8328510888` are both "an Indian number" but only
 * one carries the `91`. We can't ask libphonenumber which is which — its
 * metadata is lenient enough that `15555000001` parses as a *valid* 11
 * digit Indian national number (becoming `+9115555000001`), which is
 * exactly the corruption this function has to prevent.
 *
 * So we compare digit count against the length of a normal national
 * number in `defaultCountry`:
 *
 *   - **Longer** than that ⇒ the extra digits must be a country code, so
 *     read it as international. `15555000001` (11 > 10) → `+15555000001`,
 *     and `918328510888` (12 > 10) → `+918328510888`.
 *   - **Equal or shorter** ⇒ it's a bare national number, so apply
 *     `defaultCountry`. `8328510888` + `IN` → `+918328510888`.
 *
 * Within each branch we try `isValid` before `isPossible`, so a
 * confidently-real reading beats a merely plausible one while reserved
 * test ranges like `+1 555 500 0001` still get through.
 */
export function toE164(
  raw: string | null | undefined,
  defaultCountry: CountryCode | undefined = DEFAULT_PHONE_COUNTRY
): NormalizedPhone | null {
  if (!raw) return null;
  const cleaned = clean(String(raw));
  if (!cleaned) return null;

  // An explicit `+` is authoritative: the country code is already stated.
  if (cleaned.startsWith('+')) return attempt(cleaned, undefined, 'possible');

  const digits = cleaned.replace(/\D/g, '');
  // Too short to be any real number; avoids nonsense like `12` → `+12`.
  if (digits.length < 5) return null;
  const asIntl = `+${digits}`;

  const expected = defaultCountry ? nationalLength(defaultCountry) : undefined;
  const carriesCountryCode =
    expected !== undefined && digits.length > expected;

  if (carriesCountryCode) {
    return (
      attempt(asIntl, undefined, 'valid') ??
      attempt(asIntl, undefined, 'possible') ??
      attempt(digits, defaultCountry, 'valid') ??
      attempt(digits, defaultCountry, 'possible')
    );
  }

  return (
    attempt(digits, defaultCountry, 'valid') ??
    attempt(digits, defaultCountry, 'possible') ??
    attempt(asIntl, undefined, 'valid') ??
    attempt(asIntl, undefined, 'possible')
  );
}

/** True when `raw` is empty or can be normalized. Empty is "not invalid". */
export function isNormalizablePhone(
  raw: string | null | undefined,
  defaultCountry?: CountryCode
): boolean {
  if (!raw || !String(raw).trim()) return true;
  return toE164(raw, defaultCountry) !== null;
}

/**
 * Digits-only form for comparisons and for provider APIs that reject `+`.
 * Falls back to raw digits when the number can't be parsed, so matching
 * still degrades gracefully instead of throwing.
 */
export function toPhoneDigits(
  raw: string | null | undefined,
  defaultCountry?: CountryCode
): string {
  if (!raw) return '';
  return (
    toE164(raw, defaultCountry)?.digits ?? clean(String(raw)).replace(/\D/g, '')
  );
}

/** Human-friendly international form, e.g. `+91 83285 10888`. */
export function formatPhoneForDisplay(
  raw: string | null | undefined,
  defaultCountry?: CountryCode
): string {
  if (!raw) return '';
  const normalized = toE164(raw, defaultCountry);
  if (!normalized) return String(raw);
  const parsed = parsePhoneNumberFromString(normalized.e164);
  return parsed ? parsed.formatInternational() : normalized.e164;
}

export type { CountryCode };
