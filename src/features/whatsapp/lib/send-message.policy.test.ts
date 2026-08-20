import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { OutboundBlockedError } from '@/features/channels/lib/orchestration/window-guard';

// The orchestrator is the boundary under test's collaborator: it raises the
// policy error, and this file asserts the send core translates it instead of
// flattening it into a provider failure (ADR-006 D4, plan Task 6).
const sendChannelMessage = vi.fn();
vi.mock('@/features/channels/lib/orchestration/outbound', () => ({
  sendChannelMessage: (...args: unknown[]) => sendChannelMessage(...args),
}));

// Flow-pause side effect is best-effort and irrelevant here.
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }),
      }),
    }),
  }),
}));

import { sendMessageToConversation, SendMessageError } from './send-message';

/** Minimal RLS-scoped client: one conversation row with a phoned contact. */
function dbWithOpenThread(): SupabaseClient {
  return {
    from(table: string) {
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () =>
          table === 'conversations'
            ? Promise.resolve({
                data: {
                  id: 'cv-1',
                  account_id: 'acct-1',
                  contact: { id: 'ct-1', phone: '919876543210' },
                },
                error: null,
              })
            : Promise.resolve({ data: null, error: new Error('no row') }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe('policy refusals surface as typed 409s (ADR-006 D4/D8)', () => {
  beforeEach(() => {
    sendChannelMessage.mockReset();
  });

  it('maps window_closed verbatim at 409, not as a provider 502', async () => {
    sendChannelMessage.mockRejectedValue(
      new OutboundBlockedError('window_closed', 'The 24-hour window is closed.')
    );

    await expect(
      sendMessageToConversation(dbWithOpenThread(), 'acct-1', {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'hello',
      })
    ).rejects.toMatchObject({
      name: 'SendMessageError',
      code: 'window_closed',
      status: 409,
    });
  });

  it('maps contact_opted_out at 409 for a template send', async () => {
    sendChannelMessage.mockRejectedValue(
      new OutboundBlockedError('contact_opted_out', 'This contact opted out.')
    );

    await expect(
      sendMessageToConversation(dbWithOpenThread(), 'acct-1', {
        conversationId: 'cv-1',
        messageType: 'template',
        templateName: 'appointment_reminder',
      })
    ).rejects.toMatchObject({ code: 'contact_opted_out', status: 409 });
  });

  it('still maps a genuine provider failure to 502', async () => {
    sendChannelMessage.mockRejectedValue(new Error('meta rejected the send'));

    await expect(
      sendMessageToConversation(dbWithOpenThread(), 'acct-1', {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'hello',
      })
    ).rejects.toMatchObject({ code: 'meta_error', status: 502 });
  });

  it('does not swallow SendMessageError instances thrown downstream', async () => {
    sendChannelMessage.mockRejectedValue(
      new SendMessageError('db_error', 'DB insert failed', 500)
    );

    await expect(
      sendMessageToConversation(dbWithOpenThread(), 'acct-1', {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'hello',
      })
    ).rejects.toMatchObject({ code: 'db_error', status: 500 });
  });
});
