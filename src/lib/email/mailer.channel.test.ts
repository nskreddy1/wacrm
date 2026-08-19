// ============================================================
// Regression tests: sendEmail() must resolve the workspace's
// CONNECTED EMAIL CHANNEL, not only the legacy
// account_email_settings row.
//
// The bug these lock down: this module used to read only
// `account_email_settings`, a table written exclusively by an API
// route whose UI panel is mounted nowhere. Settings → Channels →
// Email writes `channel_connections` instead. So an admin could
// fully configure and test SMTP in the UI, flip the platform to
// "email" invites, and still have every invitation silently fall
// through to the platform env keys (unset) and never send.
// ============================================================

import { describe, expect, it, vi, beforeEach } from 'vitest';

const ENC_KEY = '0'.repeat(64);

// Deterministic "encryption" so fixtures stay readable: the real
// AES-256-GCM helper is exercised by its own test suite.
vi.mock('@/lib/crypto/secrets', () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) =>
    v.startsWith('enc:') ? v.slice(4) : (() => { throw new Error('bad'); })(),
}));

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));

process.env.ENCRYPTION_KEY = ENC_KEY;

/**
 * Minimal Supabase stub: resolves the single-row query used by each
 * loader. `channel` decides which table returns data.
 */
function dbWith(opts: {
  channelRow?: Record<string, unknown> | null;
  legacyRow?: Record<string, unknown> | null;
}) {
  return {
    from(table: string) {
      const row =
        table === 'channel_connections'
          ? (opts.channelRow ?? null)
          : (opts.legacyRow ?? null);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'limit']) {
        chain[m] = () => chain;
      }
      chain.maybeSingle = () => Promise.resolve({ data: row, error: null });
      return chain;
    },
  } as never;
}

const smtpChannelRow = {
  provider: 'smtp',
  external_identity: 'crm@acme.test',
  status: 'connected',
  configuration: { host: 'smtp.acme.test', port: 587, secure: false, fromName: 'Acme CRM' },
  credentials_encrypted: `enc:${JSON.stringify({
    provider: 'smtp',
    value: { username: 'u', password: 'p' },
  })}`,
};

describe('sendEmail — connected email channel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMail.mockResolvedValue({ messageId: 'ok' });
    delete process.env.RESEND_API_KEY;
    delete process.env.MAILTRAP_API_TOKEN;
  });

  it('sends through the connected SMTP channel when no legacy row exists', async () => {
    const { sendEmail } = await import('./mailer');
    const result = await sendEmail(
      dbWith({ channelRow: smtpChannelRow, legacyRow: null }),
      'acct-1',
      { to: 'invitee@example.test', subject: 'You are invited', html: '<p>hi</p>' }
    );

    // The regression: this used to be { sent: false, provider: null }.
    expect(result).toEqual({ sent: true, provider: 'smtp' });
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.acme.test', port: 587, secure: false })
    );
    // fromName from the channel configuration must reach the envelope.
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Acme CRM <crm@acme.test>' })
    );
  });

  it('ignores channels that are not fully connected', async () => {
    // status is filtered in the query, so a pending row arrives as null.
    const { sendEmail } = await import('./mailer');
    const result = await sendEmail(dbWith({ channelRow: null }), 'acct-1', {
      to: 'x@example.test',
      subject: 's',
      html: '<p>h</p>',
    });
    expect(result.sent).toBe(false);
    expect(result.error).toBe('no email provider configured');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('falls back to the platform key when the tenant transport fails', async () => {
    sendMail.mockRejectedValueOnce(new Error('EAUTH'));
    process.env.RESEND_API_KEY = 're_test';
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, text: () => Promise.resolve('') });
    vi.stubGlobal('fetch', fetchMock);

    const { sendEmail } = await import('./mailer');
    const result = await sendEmail(
      dbWith({ channelRow: smtpChannelRow }),
      'acct-1',
      { to: 'y@example.test', subject: 's', html: '<p>h</p>' }
    );

    expect(result).toEqual({ sent: true, provider: 'platform_resend' });
    vi.unstubAllGlobals();
  });

  it('rejects a channel whose credential blob does not match its provider', async () => {
    const { sendEmail } = await import('./mailer');
    const tampered = {
      ...smtpChannelRow,
      credentials_encrypted: `enc:${JSON.stringify({
        provider: 'resend',
        value: { apiKey: 'k' },
      })}`,
    };
    const result = await sendEmail(dbWith({ channelRow: tampered }), 'acct-1', {
      to: 'z@example.test',
      subject: 's',
      html: '<p>h</p>',
    });
    // Mismatch must not be coerced into a send.
    expect(result.sent).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
