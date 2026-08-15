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
  sendWithSettings,
  getPlatformTransport,
} = vi.hoisted(() => ({
  getInviteDeliveryMode: vi.fn(),
  recordInviteDeliveryFailure: vi.fn(),
  resetInviteDeliveryFailures: vi.fn(),
  sendWithSettings: vi.fn(),
  getPlatformTransport: vi.fn(),
}));
vi.mock('./invite-delivery-mode', () => ({
  getInviteDeliveryMode,
  recordInviteDeliveryFailure,
  resetInviteDeliveryFailures,
}));
vi.mock('./mailer', () => ({ sendWithSettings }));
vi.mock('./platform-invite-transport', () => ({ getPlatformTransport }));

/** A configured platform transport, as the operator would have saved. */
const PLATFORM_TRANSPORT = {
  provider: 'smtp' as const,
  fromEmail: 'invites@platform.test',
  fromName: 'Axon',
  credentials: {
    host: 'smtp.platform.test',
    port: 587,
    secure: false,
    username: 'ops',
    password: 'secret',
  },
};

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
    sendWithSettings.mockReset();
    getPlatformTransport.mockReset().mockResolvedValue(null);
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
    expect(sendWithSettings).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not even resolve the transport when link_only', async () => {
    getInviteDeliveryMode.mockResolvedValue('link_only');
    // Even with a transport configured, the operator gate wins — and
    // we must not read credentials we are not going to use.
    getPlatformTransport.mockResolvedValue(PLATFORM_TRANSPORT);
    await sendInviteEmail(params);
    expect(getPlatformTransport).not.toHaveBeenCalled();
    expect(sendWithSettings).not.toHaveBeenCalled();
  });

  it('ignores a platform Resend key when link_only', async () => {
    getInviteDeliveryMode.mockResolvedValue('link_only');
    process.env.RESEND_API_KEY = 're_test_key';
    const res = await sendInviteEmail(params);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('link_only');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the platform transport when delivery is enabled', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    getPlatformTransport.mockResolvedValue(PLATFORM_TRANSPORT);
    sendWithSettings.mockResolvedValue({ sent: true, provider: 'smtp' });
    const res = await sendInviteEmail(params);
    expect(res).toEqual({ sent: true, provider: 'smtp', reason: 'sent' });
    // Sent with the OPERATOR's settings, not a tenant's.
    expect(sendWithSettings).toHaveBeenCalledWith(
      PLATFORM_TRANSPORT,
      expect.objectContaining({ to: params.to })
    );
  });

  it('reports no_provider when enabled but nothing is configured', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    const res = await sendInviteEmail(params);
    expect(res.sent).toBe(false);
    expect(res.reason).toBe('no_provider');
    // Crucially it does NOT fall back to creating an auth user.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to platform Resend when the transport send fails', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    getPlatformTransport.mockResolvedValue(PLATFORM_TRANSPORT);
    sendWithSettings.mockResolvedValue({ sent: false, provider: 'smtp' });
    process.env.RESEND_API_KEY = 're_test_key';
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => '',
    } as Response);
    const res = await sendInviteEmail(params);
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
    getPlatformTransport.mockResolvedValue(PLATFORM_TRANSPORT);
    sendWithSettings.mockResolvedValue({ sent: true, provider: 'smtp' });
    await sendInviteEmail({
      ...params,
      accountName: '<script>alert(1)</script>',
    });
    const html = sendWithSettings.mock.calls[0][1].html as string;
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
    sendWithSettings.mockReset();
    getPlatformTransport.mockReset().mockResolvedValue(null);
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
    getPlatformTransport.mockResolvedValue(PLATFORM_TRANSPORT);
    sendWithSettings.mockResolvedValue({ sent: true, provider: 'smtp' });
    await sendInviteEmail(params);
    expect(resetInviteDeliveryFailures).toHaveBeenCalledOnce();
    expect(recordInviteDeliveryFailure).not.toHaveBeenCalled();
  });

  it('records a failure when the platform transport rejects the send', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    getPlatformTransport.mockResolvedValue(PLATFORM_TRANSPORT);
    // A configured transport that failed: rotted password, revoked key.
    sendWithSettings.mockResolvedValue({
      sent: false,
      provider: 'smtp',
      error: 'Invalid login: 535 auth failed',
    });
    const res = await sendInviteEmail(params);
    expect(res.reason).toBe('send_failed');
    expect(recordInviteDeliveryFailure).toHaveBeenCalledWith(
      'Invalid login: 535 auth failed'
    );
  });

  it('does NOT count an unconfigured transport as a failure', async () => {
    getInviteDeliveryMode.mockResolvedValue('email');
    // The operator switched delivery on but never saved a transport:
    // a setup state, not a broken provider. Counting it would burn the
    // breaker down on a deployment that has never sent a single mail.
    getPlatformTransport.mockResolvedValue(null);
    const res = await sendInviteEmail(params);
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
