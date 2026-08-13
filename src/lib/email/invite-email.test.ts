import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================
// Proves the gate is enforced at the top of sendInviteEmail:
// with delivery off, NO provider is contacted at all — not the
// workspace's SMTP, not platform Resend, and no network call.
// ============================================================

// `vi.mock` is hoisted above these declarations, so the fns must be
// created inside `vi.hoisted` to exist by the time the factory runs.
const { getInviteDeliveryMode, sendEmail } = vi.hoisted(() => ({
  getInviteDeliveryMode: vi.fn(),
  sendEmail: vi.fn(),
}));
vi.mock('./invite-delivery-mode', () => ({ getInviteDeliveryMode }));
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
