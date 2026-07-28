import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn() }));

vi.mock('@/lib/email/mailer', () => ({ sendEmail: sendEmailMock }));
vi.mock('@/features/flows/lib/admin-client', () => ({
  supabaseAdmin: () => ({}) as never,
}));

import { emailAlertAdapter } from './email';
import type { AlertDestination, AlertPayload } from '../types';

const payload: AlertPayload = {
  title: 'AI handed off a conversation',
  body: 'Customer asked about refunds.',
  url: 'https://app.example.com/c/1',
  notification_type: 'ai_handoff',
};

function dest(config: Record<string, unknown>): AlertDestination {
  return {
    id: 'd1',
    account_id: 'a1',
    provider: 'email',
    display_name: 'Email',
    config,
    event_types: ['ai_handoff'],
    enabled: true,
  };
}

beforeEach(() => {
  sendEmailMock.mockReset();
  sendEmailMock.mockResolvedValue({ sent: true, provider: 'platform_resend' });
});

describe('email adapter — success path', () => {
  it('sends one email to the configured recipient', async () => {
    const result = await emailAlertAdapter.send(
      dest({ recipient: 'oncall@example.com' }),
      payload
    );

    expect(result).toEqual({ ok: true });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const [, accountId, msg] = sendEmailMock.mock.calls[0];
    expect(accountId).toBe('a1');
    expect(msg.to).toBe('oncall@example.com');
    expect(msg.subject).toBe(payload.title);
  });

  it('includes a plain-text alternative alongside the HTML', async () => {
    // Text-only clients and spam scoring both want this.
    await emailAlertAdapter.send(
      dest({ recipient: 'oncall@example.com' }),
      payload
    );
    const [, , msg] = sendEmailMock.mock.calls[0];
    expect(msg.text).toContain(payload.body);
    expect(msg.html).toContain('<');
  });

  it('renders the deep link as a button when a url is present', async () => {
    await emailAlertAdapter.send(
      dest({ recipient: 'oncall@example.com' }),
      payload
    );
    const [, , msg] = sendEmailMock.mock.calls[0];
    expect(msg.html).toContain('https://app.example.com/c/1');
    expect(msg.html).toContain('Open conversation');
  });

  it('omits the button entirely when there is no url', async () => {
    await emailAlertAdapter.send(dest({ recipient: 'oncall@example.com' }), {
      ...payload,
      url: undefined,
    });
    const [, , msg] = sendEmailMock.mock.calls[0];
    expect(msg.html).not.toContain('Open conversation');
  });

  it('escapes HTML in the payload so alert content cannot inject markup', async () => {
    // Alert bodies contain customer text — treat as untrusted.
    await emailAlertAdapter.send(dest({ recipient: 'oncall@example.com' }), {
      ...payload,
      body: '<script>alert(1)</script>',
    });
    const [, , msg] = sendEmailMock.mock.calls[0];
    expect(msg.html).not.toContain('<script>');
    expect(msg.html).toContain('&lt;script&gt;');
  });
});

describe('email adapter — config guards (never retried)', () => {
  it.each([
    [{}, 'missing'],
    [{ recipient: '   ' }, 'blank'],
    [{ recipient: 'not-an-email' }, 'no @'],
    [{ recipient: 'a@b' }, 'no TLD'],
    [{ recipient: 'a@b.com, c@d.com' }, 'comma-separated list'],
  ])('dead-letters on %o (%s)', async (config) => {
    const result = await emailAlertAdapter.send(dest(config), payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(false);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe('email adapter — delivery failure', () => {
  it('retries when every provider in the fallback chain refused', async () => {
    sendEmailMock.mockResolvedValue({
      sent: false,
      provider: null,
      error: 'rate limited',
    });

    const result = await emailAlertAdapter.send(
      dest({ recipient: 'oncall@example.com' }),
      payload
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.error).toBe('rate limited');
    }
  });

  it('never sends twice for one delivery row, so a retry cannot duplicate', async () => {
    // The single-recipient design exists precisely to keep this atomic.
    await emailAlertAdapter.send(
      dest({ recipient: 'oncall@example.com' }),
      payload
    );
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});
