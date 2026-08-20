import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// ADR-006: the orchestrator is the single choke point, so the 24h window and
// consent guard must fire HERE — not in routes — for every caller (dashboard,
// flow, AI reply, broadcast). These tests drive sendChannelMessage end to end
// against a mocked Supabase admin client and a mocked Meta adapter, and
// assert the three load-bearing properties:
//
//   1. A closed window rejects free-form sends with OutboundBlockedError
//      BEFORE any provider call or DB write happens.
//   2. Templates pass a closed window; nothing passes an opted-out contact.
//   3. The guard adds ZERO extra DB reads — it consumes columns on the two
//      selects the orchestrator already makes (scale invariant: the hot send
//      path must not gain a query).
// ---------------------------------------------------------------------------

const NOW = new Date('2026-08-20T12:00:00.000Z');
const OPEN_WINDOW = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(); // 1h ago
const CLOSED_WINDOW = new Date(
  NOW.getTime() - 25 * 60 * 60 * 1000
).toISOString(); // 25h ago

// Per-test scenario toggles.
let conversationRow: Record<string, unknown> | null = null;
let contactRow: Record<string, unknown> | null = null;
let connectionRow: Record<string, unknown> | null = null;

// Spies on side effects.
const messageInserts: Array<Record<string, unknown>> = [];
let fromCalls: string[] = [];
const adapterSend = vi.fn(async () => ({ externalMessageId: 'wamid.SENT' }));

function makeSupabaseMock() {
  function builder(table: string) {
    fromCalls.push(table);
    let didInsert = false;
    const terminal = () => {
      if (didInsert) {
        return { data: { id: 'msg-db-1' }, error: null };
      }
      switch (table) {
        case 'conversations':
          return { data: conversationRow, error: null };
        case 'contacts':
          return { data: contactRow, error: null };
        case 'channel_connections':
          return { data: connectionRow, error: null };
        default:
          return { data: null, error: null };
      }
    };
    const b: Record<string, unknown> = {};
    for (const m of [
      'select',
      'eq',
      'order',
      'limit',
      'update',
      'insert',
    ]) {
      b[m] = vi.fn((...mArgs: unknown[]) => {
        if (m === 'insert' && table === 'messages') {
          didInsert = true;
          messageInserts.push(mArgs[0] as Record<string, unknown>);
        }
        if (m === 'insert') didInsert = true;
        return b;
      });
    }
    b.single = vi.fn(async () => terminal());
    b.maybeSingle = vi.fn(async () => terminal());
    // update(...).eq(...) is awaited directly.
    b.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(terminal()).then(resolve);
    return b;
  }
  return { from: vi.fn((table: string) => builder(table)) };
}

let supabaseMock: ReturnType<typeof makeSupabaseMock>;

vi.mock('@/lib/supabase/admin', () => ({
  channelAdmin: () => supabaseMock,
}));

vi.mock('@/features/channels/lib/adapters', () => ({
  createChannelAdapter: () => ({ send: adapterSend }),
}));

import { sendChannelMessage } from './outbound';
import { OutboundBlockedError } from './window-guard';

const BASE_ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  senderType: 'agent' as const,
};

const WHATSAPP_CONNECTION = {
  id: 'conn-1',
  account_id: 'acct-1',
  provider: 'meta',
  channel: 'whatsapp',
  is_enabled: true,
};

function whatsappConversation(lastInboundAt: string | null) {
  return {
    id: 'conv-1',
    contact_id: 'contact-1',
    channel: 'whatsapp',
    channel_connection_id: 'conn-1',
    last_inbound_at: lastInboundAt,
  };
}

function contact(overrides: Record<string, unknown> = {}) {
  return {
    id: 'contact-1',
    phone: '15551234567',
    whatsapp_opted_out: false,
    sms_opted_out: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  supabaseMock = makeSupabaseMock();
  fromCalls = [];
  messageInserts.length = 0;
  adapterSend.mockClear();
  connectionRow = WHATSAPP_CONNECTION;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sendChannelMessage window guard (ADR-006)', () => {
  it('sends free-form text inside an open window', async () => {
    conversationRow = whatsappConversation(OPEN_WINDOW);
    contactRow = contact();

    const result = await sendChannelMessage({
      ...BASE_ARGS,
      payload: { kind: 'text', text: 'hello' },
    });

    expect(result.externalMessageId).toBe('wamid.SENT');
    expect(adapterSend).toHaveBeenCalledTimes(1);
    expect(messageInserts).toHaveLength(1);
  });

  it('rejects free-form text on a closed window with 409 window_closed, before any provider call or DB write', async () => {
    conversationRow = whatsappConversation(CLOSED_WINDOW);
    contactRow = contact();

    const attempt = sendChannelMessage({
      ...BASE_ARGS,
      payload: { kind: 'text', text: 'hello' },
    });

    await expect(attempt).rejects.toBeInstanceOf(OutboundBlockedError);
    await attempt.catch((err: OutboundBlockedError) => {
      expect(err.code).toBe('window_closed');
      expect(err.status).toBe(409);
    });
    expect(adapterSend).not.toHaveBeenCalled();
    expect(messageInserts).toHaveLength(0);
  });

  it('rejects free-form text when the contact has never messaged (NULL window)', async () => {
    conversationRow = whatsappConversation(null);
    contactRow = contact();

    await expect(
      sendChannelMessage({
        ...BASE_ARGS,
        payload: { kind: 'text', text: 'hello' },
      })
    ).rejects.toMatchObject({ code: 'window_closed' });
    expect(adapterSend).not.toHaveBeenCalled();
  });

  it('allows a template through a closed window', async () => {
    conversationRow = whatsappConversation(CLOSED_WINDOW);
    contactRow = contact();

    const result = await sendChannelMessage({
      ...BASE_ARGS,
      payload: {
        kind: 'template',
        templateName: 'order_update',
        language: 'en',
      },
    });

    expect(result.externalMessageId).toBe('wamid.SENT');
    expect(adapterSend).toHaveBeenCalledTimes(1);
  });

  it('rejects even templates for an opted-out contact', async () => {
    conversationRow = whatsappConversation(OPEN_WINDOW);
    contactRow = contact({ whatsapp_opted_out: true });

    await expect(
      sendChannelMessage({
        ...BASE_ARGS,
        payload: {
          kind: 'template',
          templateName: 'order_update',
          language: 'en',
        },
      })
    ).rejects.toMatchObject({ code: 'contact_opted_out', status: 409 });
    expect(adapterSend).not.toHaveBeenCalled();
    expect(messageInserts).toHaveLength(0);
  });

  it('does not apply the window to SMS conversations, but does apply SMS consent', async () => {
    conversationRow = {
      ...whatsappConversation(null),
      channel: 'sms',
    };
    connectionRow = { ...WHATSAPP_CONNECTION, channel: 'sms' };

    // No window on SMS: NULL last_inbound_at still sends.
    contactRow = contact();
    const ok = await sendChannelMessage({
      ...BASE_ARGS,
      payload: { kind: 'text', text: 'hello' },
    });
    expect(ok.externalMessageId).toBe('wamid.SENT');

    // But an sms_opted_out contact is still refused.
    contactRow = contact({ sms_opted_out: true });
    await expect(
      sendChannelMessage({
        ...BASE_ARGS,
        payload: { kind: 'text', text: 'hello' },
      })
    ).rejects.toMatchObject({ code: 'contact_opted_out' });
  });

  it('adds zero extra DB reads: rejection happens after exactly the two selects the orchestrator already made', async () => {
    conversationRow = whatsappConversation(CLOSED_WINDOW);
    contactRow = contact();

    await sendChannelMessage({
      ...BASE_ARGS,
      payload: { kind: 'text', text: 'hello' },
    }).catch(() => undefined);

    // conversations + contacts only — no third query before the guard fires.
    expect(fromCalls).toEqual(['conversations', 'contacts']);
  });
});
