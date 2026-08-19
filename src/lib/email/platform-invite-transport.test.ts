// Tests for the platform-only invite transport.
//
// The security properties under test are the reason this module
// exists, so they are asserted explicitly rather than implied:
//   1. The summary that reaches the browser carries NO secret.
//   2. Secrets are encrypted before they touch the database.
//   3. An operator can edit host/port/From without re-entering the
//      password, but switching provider forces a fresh secret.
//   4. Validation rejects malformed input before any write happens.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { upsert, maybeSingle, encryptEmailCredentials, decrypt } = vi.hoisted(
  () => ({
    upsert: vi.fn(),
    maybeSingle: vi.fn(),
    encryptEmailCredentials: vi.fn(),
    decrypt: vi.fn(),
  })
);

// A chainable stub shaped like the postgrest builder the module uses.
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      upsert,
      delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }),
    }),
  }),
}));

vi.mock('@/lib/crypto/secrets', () => ({ decrypt }));
vi.mock('./mailer', () => ({ encryptEmailCredentials }));

import {
  getPlatformTransport,
  getPlatformTransportSummary,
  resetPlatformTransportCache,
  savePlatformTransport,
  validateTransportInput,
} from './platform-invite-transport';

/** A stored SMTP row as it would come back from platform_settings. */
const STORED_SMTP = {
  value: {
    provider: 'smtp',
    fromEmail: 'invites@platform.test',
    fromName: 'Axon',
    host: 'smtp.platform.test',
    port: 587,
    secure: false,
    username: 'ops',
    credentialsEncrypted: 'enc:blob',
  },
  updated_at: '2026-01-01T00:00:00.000Z',
};

const EMPTY_SUMMARY = {
  configured: false,
  provider: null as null | string,
  hasSecret: false,
};

beforeEach(() => {
  upsert.mockReset().mockResolvedValue({ error: null });
  maybeSingle.mockReset().mockResolvedValue({ data: null, error: null });
  encryptEmailCredentials.mockReset().mockReturnValue('enc:new-blob');
  decrypt.mockReset().mockReturnValue(
    JSON.stringify({
      host: 'smtp.platform.test',
      port: 587,
      secure: false,
      username: 'ops',
      password: 'stored-password',
    })
  );
  vi.spyOn(console, 'error').mockImplementation(() => {});
  resetPlatformTransportCache();
});

describe('getPlatformTransportSummary — no secret leakage', () => {
  it('returns an unconfigured summary when nothing is stored', async () => {
    const summary = await getPlatformTransportSummary();
    expect(summary).toMatchObject(EMPTY_SUMMARY);
  });

  it('never includes the password or key in the summary', async () => {
    maybeSingle.mockResolvedValue({ data: STORED_SMTP, error: null });
    const summary = await getPlatformTransportSummary();

    expect(summary.configured).toBe(true);
    expect(summary.provider).toBe('smtp');
    expect(summary.host).toBe('smtp.platform.test');
    expect(summary.hasSecret).toBe(true);

    // The whole point: serialising the summary must not expose secrets.
    const serialised = JSON.stringify(summary);
    expect(serialised).not.toContain('stored-password');
    expect(serialised).not.toContain('enc:blob');
    expect(serialised).not.toContain('credentialsEncrypted');
  });
});

describe('getPlatformTransport — server-side resolution', () => {
  it('decrypts credentials for sending', async () => {
    maybeSingle.mockResolvedValue({ data: STORED_SMTP, error: null });
    const transport = await getPlatformTransport();
    expect(transport?.provider).toBe('smtp');
    expect(transport?.fromEmail).toBe('invites@platform.test');
    expect(transport?.credentials).toMatchObject({
      host: 'smtp.platform.test',
      password: 'stored-password',
    });
  });

  it('returns null when decryption fails instead of throwing', async () => {
    maybeSingle.mockResolvedValue({ data: STORED_SMTP, error: null });
    decrypt.mockImplementation(() => {
      throw new Error('key rotated');
    });
    // A rotated ENCRYPTION_KEY must degrade to "not configured" so
    // invites fall back to link mode rather than 500-ing the request.
    await expect(getPlatformTransport()).resolves.toBeNull();
  });
});

describe('validateTransportInput', () => {
  it('rejects a malformed From address', () => {
    const errors = validateTransportInput(
      {
        provider: 'resend',
        fromEmail: 'not-an-email',
        secret: 're_key',
      },
      { hasSecret: false, provider: null } as never
    );
    expect(errors.some((e) => e.field === 'fromEmail')).toBe(true);
  });

  it('requires host, port and username for SMTP', () => {
    const errors = validateTransportInput(
      { provider: 'smtp', fromEmail: 'a@b.com', secret: 'pw' },
      { hasSecret: false, provider: null } as never
    );
    const fields = errors.map((e) => e.field);
    expect(fields).toContain('host');
    expect(fields).toContain('port');
    expect(fields).toContain('username');
  });

  it('rejects an out-of-range port', () => {
    const errors = validateTransportInput(
      {
        provider: 'smtp',
        fromEmail: 'a@b.com',
        host: 'smtp.test',
        port: 99999,
        username: 'u',
        secret: 'pw',
      },
      { hasSecret: false, provider: null } as never
    );
    expect(errors.some((e) => e.field === 'port')).toBe(true);
  });

  it('requires a secret when none is stored yet', () => {
    const errors = validateTransportInput(
      { provider: 'resend', fromEmail: 'a@b.com' },
      { hasSecret: false, provider: null } as never
    );
    expect(errors.some((e) => e.field === 'secret')).toBe(true);
  });

  it('allows a blank secret when one is already stored', () => {
    const errors = validateTransportInput(
      { provider: 'resend', fromEmail: 'a@b.com' },
      { hasSecret: true, provider: 'resend' } as never
    );
    expect(errors.some((e) => e.field === 'secret')).toBe(false);
  });

  it('requires a fresh secret when the provider changes', () => {
    // Switching smtp -> resend cannot reuse an SMTP password as an
    // API key, so the operator must supply the new credential.
    const errors = validateTransportInput(
      { provider: 'resend', fromEmail: 'a@b.com' },
      { hasSecret: true, provider: 'smtp' } as never
    );
    expect(errors.some((e) => e.field === 'secret')).toBe(true);
  });
});

describe('savePlatformTransport', () => {
  it('encrypts credentials before writing to the database', async () => {
    const res = await savePlatformTransport({
      provider: 'smtp',
      fromEmail: 'invites@platform.test',
      host: 'smtp.platform.test',
      port: 587,
      secure: false,
      username: 'ops',
      secret: 'super-secret',
    });

    expect(res.ok).toBe(true);
    expect(encryptEmailCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'super-secret' })
    );

    // The row written must carry only the encrypted blob.
    const row = upsert.mock.calls[0][0];
    expect(row.value.credentialsEncrypted).toBe('enc:new-blob');
    expect(JSON.stringify(row)).not.toContain('super-secret');
  });

  it('reuses the stored secret when the field is left blank', async () => {
    maybeSingle.mockResolvedValue({ data: STORED_SMTP, error: null });
    const res = await savePlatformTransport({
      provider: 'smtp',
      fromEmail: 'invites@platform.test',
      host: 'smtp.platform.test',
      // Operator changed the port only.
      port: 465,
      secure: true,
      username: 'ops',
    });

    expect(res.ok).toBe(true);
    expect(encryptEmailCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ password: 'stored-password', port: 465 })
    );
  });

  it('does not write when validation fails', async () => {
    const res = await savePlatformTransport({
      provider: 'smtp',
      fromEmail: 'bad',
      secret: 'pw',
    });
    expect(res.ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('surfaces a database error instead of reporting success', async () => {
    upsert.mockResolvedValue({ error: { message: 'permission denied' } });
    const res = await savePlatformTransport({
      provider: 'resend',
      fromEmail: 'a@b.com',
      secret: 're_key',
    });
    expect(res.ok).toBe(false);
  });
});
