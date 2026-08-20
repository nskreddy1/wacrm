import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// The provider adapter is the assertion surface: the whole point of the
// delivery-time consent re-check is that an opted-out recipient never
// reaches it. Mocked before the module under test is imported.
const sendTemplateMessage = vi.fn(
  async (_args: { to: string }) => ({ messageId: 'wamid.OK' })
);
vi.mock('@/features/whatsapp/lib/meta-api', () => ({
  sendTemplateMessage: (args: { to: string }) => sendTemplateMessage(args),
}));

const { deliverBroadcast } = await import('./broadcast-core');
type Plan = Parameters<typeof deliverBroadcast>[1];

interface RecipientUpdate {
  id: string;
  payload: Record<string, unknown>;
}

/**
 * Minimal chainable Supabase stub. `optedOutIds` is what the *delivery*
 * phase reads — set it to a contact the plan considered sendable and the
 * test reproduces exactly the race D8 cares about: the STOP arrived after
 * the plan was persisted.
 */
function makeDb(opts: {
  optedOutIds?: string[];
  consentReadFails?: boolean;
}): { db: SupabaseClient; recipientUpdates: RecipientUpdate[] } {
  const recipientUpdates: RecipientUpdate[] = [];

  const db = {
    from(table: string) {
      if (table === 'contacts') {
        const result = opts.consentReadFails
          ? { data: null, error: { message: 'connection reset' } }
          : { data: (opts.optedOutIds ?? []).map((id) => ({ id })), error: null };
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => Promise.resolve(result),
        };
        return chain;
      }

      if (table === 'broadcast_recipients') {
        return {
          update: (payload: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              recipientUpdates.push({ id, payload });
              return Promise.resolve({ error: null });
            },
          }),
        };
      }

      // broadcasts — terminal status write; irrelevant to these assertions.
      return {
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
  } as unknown as SupabaseClient;

  return { db, recipientUpdates };
}

function makePlan(): Plan {
  return {
    broadcastId: 'bc-1',
    accountId: 'acc-1',
    templateName: 'promo',
    templateLanguage: 'en_US',
    phoneNumberId: 'pn-1',
    accessToken: 'token',
    templateRow: null,
    planned: [
      { recipientRowId: 'r-quiet', contactId: 'c-quiet', phone: '14155550111', params: [] },
      { recipientRowId: 'r-stop', contactId: 'c-stop', phone: '14155550222', params: [] },
    ],
    rejected: 0,
    optedOut: 0,
  };
}

beforeEach(() => {
  sendTemplateMessage.mockClear();
});

describe('deliverBroadcast consent re-check (ADR-006 D8/D13)', () => {
  it('does not send to a contact who opted out after the plan was persisted', async () => {
    const { db, recipientUpdates } = makeDb({ optedOutIds: ['c-stop'] });

    await deliverBroadcast(db, makePlan());

    // The opted-out recipient never reached the provider…
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
    expect(sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: '14155550111' })
    );

    // …and is stamped failed with an explanation, not left pending.
    const stopped = recipientUpdates.find((u) => u.id === 'r-stop');
    expect(stopped?.payload).toMatchObject({ status: 'failed' });
    expect(String(stopped?.payload.error_message)).toMatch(/opted out/i);

    // No message id recorded for a message that was never sent.
    expect(stopped?.payload.whatsapp_message_id).toBeUndefined();
  });

  it('still delivers the whole plan when nobody has opted out', async () => {
    const { db, recipientUpdates } = makeDb({ optedOutIds: [] });

    await deliverBroadcast(db, makePlan());

    expect(sendTemplateMessage).toHaveBeenCalledTimes(2);
    expect(
      recipientUpdates.filter((u) => u.payload.status === 'sent')
    ).toHaveLength(2);
  });

  it('fails closed: an unreadable consent state sends nothing', async () => {
    const { db, recipientUpdates } = makeDb({ consentReadFails: true });

    await deliverBroadcast(db, makePlan());

    // Unproven consent is treated as no consent — a broadcast that
    // refuses to start is a retry; one that ignores STOP is an incident.
    expect(sendTemplateMessage).not.toHaveBeenCalled();
    expect(recipientUpdates).toHaveLength(2);
    for (const update of recipientUpdates) {
      expect(update.payload).toMatchObject({ status: 'failed' });
    }
  });
});
