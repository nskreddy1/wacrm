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
  type CountryCode,
} from 'libphonenumber-js';

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

/**
 * Normalize any phone input to E.164, or return `null` if it can't be.
 *
 * Interpretation order — most trustworthy signal first, so a confident
 * reading always beats a speculative one:
 *
 *   1. Input already has `+`. The caller declared the country; accept any
 *      possible number.
 *   2. Bare digits that parse as a *valid* international number. Covers
 *      provider webhooks, which always send full international digits
 *      (`918328510888` → `+918328510888`).
 *   3. Bare digits that are a *valid* national number for
 *      `defaultCountry` (`8328510888` + `IN` → `+918328510888`).
 *   4. Same as 2 but only *possible*. Rescues real numbers whose range
 *      libphonenumber doesn't know, and reserved test ranges.
 *   5. Same as 3 but only *possible*.
 *
 * Steps 2–3 demand `isValid` before the `isPossible` fallbacks so a
 * genuine national number is never mangled by a speculative country-code
 * guess: bare `8328510888` must not become `+8328510888`.
 */
export function toE164(
  raw: string | null | undefined,
  defaultCountry: CountryCode | undefined = DEFAULT_PHONE_COUNTRY
): NormalizedPhone | null {
  if (!raw) return null;
  const cleaned = clean(String(raw));
  if (!cleaned) return null;

  if (cleaned.startsWith('+')) return attempt(cleaned, undefined, 'possible');

  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return null;
  const asIntl = `+${digits}`;

  return (
    attempt(asIntl, undefined, 'valid') ??
    attempt(digits, defaultCountry, 'valid') ??
    attempt(asIntl, undefined, 'possible') ??
    attempt(digits, defaultCountry, 'possible')
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
