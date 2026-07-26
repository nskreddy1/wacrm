import { describe, expect, it } from 'vitest';
import { authorizeCronRequest, secretMatches } from './cron-auth';

const AUTOMATION = 'automation-secret-abc';
const VERCEL = 'vercel-cron-secret-xyz';
const bothSecrets = {
  automationCronSecret: AUTOMATION,
  vercelCronSecret: VERCEL,
};

describe('secretMatches', () => {
  it('matches identical secrets', () => {
    expect(secretMatches('abc123', 'abc123')).toBe(true);
  });

  it('rejects different secrets of equal length', () => {
    expect(secretMatches('abc123', 'abc124')).toBe(false);
  });

  it('rejects on length mismatch without throwing', () => {
    // `timingSafeEqual` throws on unequal lengths, so the guard must
    // short-circuit before calling it.
    expect(() => secretMatches('short', 'muchlongersecret')).not.toThrow();
    expect(secretMatches('short', 'muchlongersecret')).toBe(false);
  });

  it('rejects empty supplied secret', () => {
    expect(secretMatches('', AUTOMATION)).toBe(false);
  });
});

describe('authorizeCronRequest', () => {
  it('fails CLOSED with 503 when no secret is configured', () => {
    // Regression guard: an unconfigured deploy must never leave the
    // workflow engine's admin-client writes open to the internet.
    expect(
      authorizeCronRequest(
        { authorization: 'Bearer anything', xCronSecret: 'anything' },
        { automationCronSecret: undefined, vercelCronSecret: undefined }
      )
    ).toEqual({ status: 503, error: 'cron not configured' });
  });

  it('rejects a request with no auth headers', () => {
    expect(
      authorizeCronRequest({}, bothSecrets)
    ).toEqual({ status: 401, error: 'Unauthorized' });
  });

  it('rejects a wrong x-cron-secret', () => {
    expect(
      authorizeCronRequest({ xCronSecret: 'nope' }, bothSecrets)
    ).toEqual({ status: 401, error: 'Unauthorized' });
  });

  it('accepts a correct x-cron-secret (external pinger)', () => {
    expect(
      authorizeCronRequest({ xCronSecret: AUTOMATION }, bothSecrets)
    ).toEqual({ status: 200 });
  });

  it('accepts Vercel Cron Bearer CRON_SECRET', () => {
    // Vercel Cron cannot send custom headers — it only sends
    // `Authorization: Bearer $CRON_SECRET`. This is the case that was
    // silently 401ing before the fix.
    expect(
      authorizeCronRequest({ authorization: `Bearer ${VERCEL}` }, bothSecrets)
    ).toEqual({ status: 200 });
  });

  it('is case-insensitive on the Bearer prefix', () => {
    expect(
      authorizeCronRequest({ authorization: `bearer ${VERCEL}` }, bothSecrets)
    ).toEqual({ status: 200 });
  });

  it('rejects a wrong Bearer token', () => {
    expect(
      authorizeCronRequest({ authorization: 'Bearer nope' }, bothSecrets)
    ).toEqual({ status: 401, error: 'Unauthorized' });
  });

  it('works when ONLY CRON_SECRET is configured', () => {
    expect(
      authorizeCronRequest(
        { authorization: `Bearer ${VERCEL}` },
        { vercelCronSecret: VERCEL }
      )
    ).toEqual({ status: 200 });
  });

  it('works when ONLY AUTOMATION_CRON_SECRET is configured', () => {
    expect(
      authorizeCronRequest(
        { xCronSecret: AUTOMATION },
        { automationCronSecret: AUTOMATION }
      )
    ).toEqual({ status: 200 });
  });

  it('does not allow secrets to cross transports', () => {
    // The automation secret must not be accepted as a Bearer token, and
    // the Vercel secret must not be accepted via x-cron-secret. A leak in
    // one channel must not silently authorize the other.
    expect(
      authorizeCronRequest(
        { authorization: `Bearer ${AUTOMATION}` },
        { automationCronSecret: AUTOMATION }
      )
    ).toEqual({ status: 401, error: 'Unauthorized' });

    expect(
      authorizeCronRequest(
        { xCronSecret: VERCEL },
        { vercelCronSecret: VERCEL }
      )
    ).toEqual({ status: 401, error: 'Unauthorized' });
  });
});
