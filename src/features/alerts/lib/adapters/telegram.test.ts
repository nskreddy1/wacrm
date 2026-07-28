import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The value of these tests is almost entirely in the retryable/permanent
 * classification. Get it wrong in one direction and we hammer Telegram
 * for half an hour on an error that can never succeed; wrong in the other
 * and a transient blip permanently silences a tenant's alerting. Neither
 * shows up in manual testing, so each branch is pinned here.
 */

vi.mock('@/features/whatsapp/lib/encryption', () => ({
  decrypt: vi.fn((v: string) => {
    if (v === 'corrupt') throw new Error('bad ciphertext');
    return 'BOT-TOKEN';
  }),
}));

import { telegramAlertAdapter } from './telegram';
import type { AlertDestination, AlertPayload } from '../types';

const payload: AlertPayload = {
  title: 'AI handed off a conversation',
  body: 'Customer asked about refunds.',
  url: 'https://app.example.com/c/1',
  notification_type: 'ai_handoff',
};

function dest(
  overrides: Partial<AlertDestination> = {}
): AlertDestination {
  return {
    id: 'd1',
    account_id: 'a1',
    provider: 'telegram',
    display_name: 'Telegram',
    config: { chat_id: '-100123' },
    credentials_encrypted: 'cipher',
    event_types: ['ai_handoff'],
    enabled: true,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('telegram adapter — success path', () => {
  it('posts to sendMessage and reports ok', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    const result = await telegramAlertAdapter.send(dest(), payload);
    expect(result).toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botBOT-TOKEN/sendMessage');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.chat_id).toBe('-100123');
    expect(body.text).toContain('AI handed off a conversation');
    expect(body.parse_mode).toBe('HTML');
  });

  it('escapes HTML so a body with markup cannot break parse_mode', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await telegramAlertAdapter.send(dest(), {
      ...payload,
      body: 'Order <b>#5</b> & co',
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.text).toContain('&lt;b&gt;#5&lt;/b&gt; &amp; co');
  });

  it('truncates messages beyond Telegram 4096-char limit', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await telegramAlertAdapter.send(dest(), {
      ...payload,
      body: 'x'.repeat(6000),
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.text.length).toBeLessThanOrEqual(4096);
    expect(body.text.endsWith('…')).toBe(true);
  });
});

describe('telegram adapter — config guards (never retried)', () => {
  it('dead-letters when no chat is configured', async () => {
    const result = await telegramAlertAdapter.send(
      dest({ config: {} }),
      payload
    );
    expect(result).toEqual({
      ok: false,
      retryable: false,
      error: 'No chat configured',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dead-letters when the token is missing', async () => {
    const result = await telegramAlertAdapter.send(
      dest({ credentials_encrypted: null }),
      payload
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dead-letters on undecryptable credentials without leaking detail', async () => {
    const result = await telegramAlertAdapter.send(
      dest({ credentials_encrypted: 'corrupt' }),
      payload
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(false);
      // Must not echo cipher internals into a stored error string.
      expect(result.error).not.toContain('ciphertext');
    }
  });
});

describe('telegram adapter — permanent failures', () => {
  it.each([
    [401, 'Unauthorized'],
    [403, 'Forbidden: bot was blocked by the user'],
    [404, 'Not Found'],
    [400, 'Bad Request: chat not found'],
    [400, 'Bad Request: not enough rights to send text messages'],
  ])('dead-letters on %i %s', async (status, description) => {
    fetchMock.mockResolvedValue(
      jsonResponse(status, { ok: false, description })
    );

    const result = await telegramAlertAdapter.send(dest(), payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(false);
  });
});

describe('telegram adapter — retryable failures', () => {
  it('retries on 429 and surfaces retry_after', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, {
        ok: false,
        description: 'Too Many Requests',
        parameters: { retry_after: 30 },
      })
    );

    const result = await telegramAlertAdapter.send(dest(), payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.error).toContain('30s');
    }
  });

  it('retries on a Telegram 5xx outage', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(502, { ok: false, description: 'Bad Gateway' })
    );

    const result = await telegramAlertAdapter.send(dest(), payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
  });

  it('retries on network failure or timeout', async () => {
    fetchMock.mockRejectedValue(new Error('socket hang up'));

    const result = await telegramAlertAdapter.send(dest(), payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.retryable).toBe(true);
  });

  it('falls back to the status code when the body is not JSON', async () => {
    // Proxies return HTML error pages; must not crash the whole tick.
    fetchMock.mockResolvedValue(
      new Response('<html>503</html>', { status: 503 })
    );

    const result = await telegramAlertAdapter.send(dest(), payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.retryable).toBe(true);
      expect(result.error).toContain('503');
    }
  });

  it('treats HTTP 200 with ok:false as a failure, not a success', async () => {
    // Telegram always returns a JSON envelope; the envelope wins.
    fetchMock.mockResolvedValue(
      jsonResponse(200, { ok: false, description: 'Internal Server Error' })
    );

    const result = await telegramAlertAdapter.send(dest(), payload);
    expect(result.ok).toBe(false);
  });
});

describe('telegram adapter — request hygiene', () => {
  it('bounds the request with a timeout signal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await telegramAlertAdapter.send(dest(), payload);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    // A hung socket must not stall the whole cron tick.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('disables link preview to keep group alerts compact', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await telegramAlertAdapter.send(dest(), payload);
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.disable_web_page_preview).toBe(true);
  });
});
