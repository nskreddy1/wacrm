import { describe, expect, it } from 'vitest';

import {
  formatPhoneForDisplay,
  isNormalizablePhone,
  toE164,
  toPhoneDigits,
} from './e164';

describe('toE164', () => {
  it('keeps an already-canonical number unchanged', () => {
    expect(toE164('+918328510888')?.e164).toBe('+918328510888');
    expect(toE164('+14155550123')?.e164).toBe('+14155550123');
  });

  it('restores the + on digits-only provider input', () => {
    // The exact WhatsApp inbound regression: Meta sends digits only, and
    // the webhook used to persist them without a country code.
    const result = toE164('918328510888');
    expect(result?.e164).toBe('+918328510888');
    expect(result?.country).toBe('IN');
  });

  it('treats bare national numbers as belonging to the default country', () => {
    expect(toE164('8328510888', 'IN')?.e164).toBe('+918328510888');
    expect(toE164('4155550123', 'US')?.e164).toBe('+14155550123');
  });

  it('prefers a valid international reading over the default country', () => {
    // Full Indian international digits must not be re-read as a US
    // national number just because the default country is US.
    expect(toE164('918328510888', 'US')?.e164).toBe('+918328510888');
  });

  it('does not prepend + to a number that needs a country code', () => {
    // `+8328510888` is not a real country code, so this must resolve via
    // the default country rather than becoming a bogus international.
    expect(toE164('8328510888', 'US')?.e164).toBe('+18328510888');
  });

  it('strips channel prefixes and separators', () => {
    expect(toE164('whatsapp:+918328510888')?.e164).toBe('+918328510888');
    expect(toE164('+370 63949836')?.e164).toBe('+37063949836');
    expect(toE164('(415) 555-0123', 'US')?.e164).toBe('+14155550123');
  });

  it('accepts reserved test ranges that are possible but not assignable', () => {
    // Gating on isPossible (not isValid) keeps seeded/test data importable.
    expect(toE164('+15555000001')?.e164).toBe('+15555000001');
    expect(toE164('15555000001')?.e164).toBe('+15555000001');
  });

  it('keeps an existing country code instead of prepending the default', () => {
    // The reported CSV bug: `15555000001` already carries the US `1`, but
    // with an India default it was read as an 11-digit Indian national
    // number and corrupted into `+9115555000001`. Digit count (11) exceeds
    // a normal Indian national number (10), so it must stay a `+1` number.
    expect(toE164('15555000001', 'IN')?.e164).toBe('+15555000001');
    expect(toE164('15555000008', 'IN')?.e164).toBe('+15555000008');
    expect(toE164('918328510888', 'IN')?.e164).toBe('+918328510888');
  });

  it('still applies the default country to same-length national numbers', () => {
    // Guards the other half of the length rule: a 10-digit number with an
    // India default is national, so it must gain `+91` and not be read as
    // some other country's international number.
    expect(toE164('8328510888', 'IN')?.e164).toBe('+918328510888');
    expect(toE164('9876543210', 'IN')?.e164).toBe('+919876543210');
    // 10-digit US national starting with `55` must not become Brazilian.
    expect(toE164('5555000001', 'US')?.e164).toBe('+15555000001');
  });

  it('rejects input that cannot be a phone number', () => {
    expect(toE164('')).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(toE164(undefined)).toBeNull();
    expect(toE164('abc')).toBeNull();
    expect(toE164('+1234')).toBeNull();
    expect(toE164('12')).toBeNull();
    expect(toE164('+123456789012345678')).toBeNull();
  });

  it('exposes digits without the + for comparison keys', () => {
    expect(toE164('+918328510888')?.digits).toBe('918328510888');
  });
});

describe('isNormalizablePhone', () => {
  it('treats blank input as not-invalid so optional fields pass', () => {
    expect(isNormalizablePhone('')).toBe(true);
    expect(isNormalizablePhone('   ')).toBe(true);
    expect(isNormalizablePhone(null)).toBe(true);
  });

  it('accepts numbers the old + -only validator rejected', () => {
    expect(isNormalizablePhone('918328510888')).toBe(true);
    expect(isNormalizablePhone('15555000001')).toBe(true);
  });

  it('still rejects garbage', () => {
    expect(isNormalizablePhone('abc')).toBe(false);
    expect(isNormalizablePhone('12')).toBe(false);
  });
});

describe('toPhoneDigits', () => {
  it('returns digits only', () => {
    expect(toPhoneDigits('+91 83285 10888')).toBe('918328510888');
    expect(toPhoneDigits('whatsapp:+14155550123')).toBe('14155550123');
  });

  it('falls back to raw digits when unparseable', () => {
    expect(toPhoneDigits('12')).toBe('12');
  });

  it('returns empty string for blank input', () => {
    expect(toPhoneDigits('')).toBe('');
    expect(toPhoneDigits(null)).toBe('');
  });
});

describe('formatPhoneForDisplay', () => {
  it('formats to international grouping', () => {
    expect(formatPhoneForDisplay('918328510888')).toBe('+91 83285 10888');
  });

  it('returns the input unchanged when it cannot be parsed', () => {
    expect(formatPhoneForDisplay('abc')).toBe('abc');
  });
});
