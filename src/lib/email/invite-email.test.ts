import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Proves the gate is enforced at the top of sendInviteEmail:
// with delivery off, NO provider is contacted at all — not the
// workspace's SMTP, not platform Resend, and no network call.
// ============================================================

// `vi.mock` is hoisted above these declarations, so the fns must be
// created inside `vi.hoisted` to exist by the time the factory runs.
const {
  getInviteDeliveryMode,
  recordInviteDeliveryFailure,
  resetInviteDeliveryFailures,
  sendEmail,
} = vi.hoisted(() => ({
  getInviteDeliveryMode: vi.fn(),
  recordInviteDeliveryFailure: vi.fn(),
  resetInviteDeliveryFailures: vi.fn(),
  sendEmail: vi.fn(),
}));
vi.mock('./invite-delivery-mode', () => ({
  getInviteDeliveryMode,
  recordInviteDeliveryFailure,
  resetInviteDeliveryFailures,
}));
vi.mock('./mailer', () => ({ sendEmail }));

import { sendInviteEmail } from './invite-email';

const params = {
  to: 'invitee@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  accountName: 'Acme Agency',
  inviterName: 'Grace',
  inviteUrl: 'https://app.example.com/join/tok123',
  expiresInDays: 7,
};

describe('sendInviteEmail — platform gate', () => {
  beforeEach(() => {
    getInviteDeliveryMode.mockReset();
    sendEmail.mockReset();
    recordInviteDeliveryFailure.mockReset().mockResolvedValue({
      tripped: false,
    });
    resetInviteDeliveryFailures.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn());
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends nothing when delivery is link_only', async () => {
    getInviteDeliveryMode.mockResolvedValue('link_only');
    const res = await sendInviteEmail(params);
    expect(res).toEqual({
      sent: false,
      provider: null,
      reason: 'link_only',
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not touch the workspace provider when link_only', async () => {
    getInviteDeliveryMode.mockResolvedValue('link_only');
    // Even with a workspace SMTP configured, the operator gate wins.
    await sendInviteEmail({
      ...params,
      workspace: { db: {} as never, accountId: 'acct-1' },
    });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('ignores a platform Resend key when link_only', async () => {
    getInviteDeliveryMode.mockResolvedValue('link_only');
    process.env.RESEND_API_KEY = 're_test_key';
    const res = await sendInviteEmail(params);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('link_only');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the workspace provider when delivery is enabled', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    sendEmail.mockResolvedValue({ sent: true, provider: 'smtp' });
    const res = await sendInviteEmail({
      ...params,
      workspace: { db: {} as never, accountId: 'acct-1' },
    });
    expect(res).toEqual({ sent: true, provider: 'smtp', reason: 'sent' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('reports no_provider when enabled but nothing is configured', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    const res = await sendInviteEmail(params);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('no_provider');
    // Crucially it does NOT fall back to creating an auth user.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to platform Resend when the workspace send fails', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    sendEmail.mockResolvedValue({ sent: false, provider: null });
    process.env.RESEND_API_KEY = 're_test_key';
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => '',
    } as Response);
    const res = await sendInviteEmail({
      ...params,
      workspace: { db: {} as never, accountId: 'acct-1' },
    });
    expect(res).toEqual({ sent: true, provider: 'resend', reason: 'sent' });
  });

  it('reports send_failed when the enabled provider bounces', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    process.env.RESEND_API_KEY = 're_test_key';
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => 'unverified domain',
    } as Response);
    const res = await sendInviteEmail(params);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('send_failed');
  });

  it('escapes HTML in the rendered email (no injection via names)', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    sendEmail.mockResolvedValue({ sent: true, provider: 'smtp' });
    await sendInviteEmail({
      ...params,
      accountName: '<script>alert(1)</script>',
      workspace: { db: {} as never, accountId: 'acct-1' },
    });
    const html = sendEmail.mock.calls[0][2].html as string;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

// ============================================================
// Auto-disable bookkeeping. The counting/threshold logic lives in
// SQL (verified against the live DB); these tests pin the wiring:
// which outcomes count as failures, which reset the streak, and
// which must be ignored entirely.
// ============================================================
describe('sendInviteEmail — delivery health bookkeeping', () => {
  beforeEach(() => {
    getInviteDeliveryMode.mockReset();
    sendEmail.mockReset();
    recordInviteDeliveryFailure.mockReset().mockResolvedValue({
      tripped: false,
    });
    resetInviteDeliveryFailures.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn());
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('clears the failure streak after a successful send', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    sendEmail.mockResolvedValue({ sent: true, provider: 'smtp' });
    await sendInviteEmail({
      ...params,
      workspace: { db: {} as never, accountId: 'acct-1' },
    });
    expect(resetInviteDeliveryFailures).toHaveBeenCalledOnce();
    expect(recordInviteDeliveryFailure).not.toHaveBeenCalled();
  });

  it('records a failure when the workspace provider rejects the send', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    // provider is non-null => a real configured provider that failed.
    sendEmail.mockResolvedValue({
      sent: false,
      provider: 'smtp',
      error: 'Invalid login: 535 auth failed',
    });
    const res = await sendInviteEmail({
      ...params,
      workspace: { db: {} as never, accountId: 'acct-1' },
    });
    expect(res.reason).toBe('send_failed');
    expect(recordInviteDeliveryFailure).toHaveBeenCalledWith(
      'Invalid login: 535 auth failed'
    );
  });

  it('does NOT count a workspace that simply has no provider configured', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    // This is what mailer returns when the tenant never set up SMTP:
    // a setup state, not a broken provider. Counting it would let one
    // unconfigured workspace disable email platform-wide.
    sendEmail.mockResolvedValue({
      sent: false,
      provider: null,
      error: 'no email provider configured',
    });
    const res = await sendInviteEmail({
      ...params,
      workspace: { db: {} as never, accountId: 'acct-1' },
    });
    expect(res.reason).toBe('no_provider');
    expect(recordInviteDeliveryFailure).not.toHaveBeenCalled();
  });

  it('records a failure when platform Resend bounces', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    process.env.RESEND_API_KEY = 're_test_key';
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'revoked key',
    } as Response);
    await sendInviteEmail(params);
    expect(recordInviteDeliveryFailure).toHaveBeenCalledWith('resend 401');
  });

  it('still returns a result when bookkeeping itself fails', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    process.env.RESEND_API_KEY = 're_test_key';
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    } as Response);
    recordInviteDeliveryFailure.mockRejectedValue(new Error('db down'));
    // Health bookkeeping is secondary — it must never turn a failed
    // send into a thrown exception that 500s the invite API.
    await expect(sendInviteEmail(params)).resolves.toMatchObject({
      sent: false,
      reason: 'send_failed',
    });
  });
});
