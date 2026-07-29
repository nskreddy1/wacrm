import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The critical invariant here is that alerts go out as a TEMPLATE. Meta
 * only permits free-form text inside a 24-hour window opened by the
 * recipient, which a proactive staff alert is essentially never inside —
 * so a plain-text implementation would fail intermittently (working only
 * just after a teammate happened to message the business number). That is
 * a nightmare to diagnose in production, so it is pinned by test.
 */

const { sendTemplateMock, configResult } = vi.hoisted(() => ({
  sendTemplateMock: vi.fn(),
  configResult: { value: null as unknown },
}));

vi.mock('@/features/whatsapp/lib/meta-api', () => ({
  sendTemplateMessage: sendTemplateMock,
}));
vi.mock('@/features/whatsapp/lib/encryption', () => ({
  decrypt: vi.fn((v: string) => {
    if (v === 'corrupt') throw new Error('bad ciphertext');
    return 'DECRYPTED-TOKEN';
  }),
}));
vi.mock('@/features/flows/lib/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => configResult.value,
        }),
      }),
    }),
  }),
}));

import { whatsappAlertAdapter } from './whatsapp';
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
    provider: 'whatsapp',
    display_name: 'WhatsApp',
    config,
    event_types: ['ai_handoff'],
    enabled: true,
  };
}

const validConfig = {
  recipient: '+919876543210',
  template_name: 'handoff_alert',
};

beforeEach(() => {
  sendTemplateMock.mockReset();
  sendTemplateMock.mockResolvedValue({ messageId: 'wamid.1' });
  configResult.value = {
    data: { phone_number_id: 'PNID', access_token: 'cipher' },
    error: null,
  };
});

describe('whatsapp adapter — success path', () => {
  it('sends a template (never free-form) using the account connection', async () => {
    const result = await whatsappAlertAdapter.send(dest(validConfig), payload);

    expect(result).toEqual({ ok: true });
    const args = sendTemplateMock.mock.calls[0][0];
    expect(args.templateName).toBe('handoff_alert');
    expect(args.phoneNumberId).toBe('PNID');
    expect(args.accessToken).toBe('DECRYPTED-TOKEN');
    expect(args.params).toEqual([payload.title, payload.body]);
  });

  it('defaults the template language to en_US', async () => {
    await whatsappAlertAdapter.send(dest(validConfig), payload);
    expect(sendTemplateMock.mock.calls[0][0].language).toBe('en_US');
  });

  it('honours an explicit template language', async () => {
    await whatsappAlertAdapter.send(
      dest({ ...validConfig, template_language: 'es_ES' }),
      payload
    );
    expect(sendTemplateMock.mock.calls[0][0].language).toBe('es_ES');
  });

  it('flattens newlines, which Meta rejects inside body variables', async () => {
    await whatsappAlertAdapter.send(dest(validConfig), {
      ...payload,
      body: 'line one\nline two\n\n   spaced',
    });
    const params = sendTemplateMock.mock.calls[0][0].params as string[];
    expect(params[1]).toBe('line one line two spaced');
    expect(params[1]).not.toContain('\n');
  });

  it('clamps an over-long body to Metas 1024-char variable limit', async () => {
    await whatsappAlertAdapter.send(dest(validConfig), {
      ...payload,
      body: 'x'.repeat(2000),
    });
    const params = sendTemplateMock.mock.calls[0][0].params as string[];
    expect(params[1].length).toBeLessThanOrEqual(1024);
  });
});

describe('whatsapp adapter — config guards (never retried)', () => {
  it('dead-letters when no recipient is set', async () => {
    const result = await whatsappAlertAdapter.send(
      dest({ template_name: 'handoff_alert' }),
      payload
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(false);
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  it('dead-letters with an actionable message when no template is set', async () => {
    const result = await whatsappAlertAdapter.send(
      dest({ recipient: '+919876543210' }),
      payload
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      // The admin must learn WHY, since this is the likeliest misconfig.
      expect(result.error).toContain('template');
    }
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  it('dead-letters when WhatsApp is not connected for the account', async () => {
    configResult.value = { data: null, error: null };
    const result = await whatsappAlertAdapter.send(dest(validConfig), payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.error).toContain('not connected');
    }
  });

  it('dead-letters on undecryptable credentials without leaking detail', async () => {
    configResult.value = {
      data: { phone_number_id: 'PNID', access_token: 'corrupt' },
      error: null,
    };
    const result = await whatsappAlertAdapter.send(dest(validConfig), payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      expect(result.error).not.toContain('ciphertext');
    }
  });

  it('retries when the config lookup itself fails (db blip)', async () => {
    configResult.value = { data: null, error: { message: 'timeout' } };
    const result = await whatsappAlertAdapter.send(dest(validConfig), payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
  });
});

describe('whatsapp adapter — permanent Meta errors', () => {
  it.each([
    'Template name does not exist in the translation',
    'The number of parameters does not match',
    'Recipient phone number not in allowed list',
    'Error validating access token: session has expired',
    'Business account is restricted from messaging',
  ])('dead-letters on: %s', async (message) => {
    sendTemplateMock.mockRejectedValue(new Error(message));
    const result = await whatsappAlertAdapter.send(dest(validConfig), payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(false);
  });
});

describe('whatsapp adapter — retryable Meta errors', () => {
  it.each([
    'Too many requests, please try again later',
    'An unexpected error occurred',
    'Service temporarily unavailable',
  ])('retries on: %s', async (message) => {
    sendTemplateMock.mockRejectedValue(new Error(message));
    const result = await whatsappAlertAdapter.send(dest(validConfig), payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
  });

  it('retries on a non-Error rejection without crashing the tick', async () => {
    sendTemplateMock.mockRejectedValue('string failure');
    const result = await whatsappAlertAdapter.send(dest(validConfig), payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
  });
});
