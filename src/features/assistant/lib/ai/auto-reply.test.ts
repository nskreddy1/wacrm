import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiConfig } from './types';

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAgentConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  sendChannelMessage: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
  },
}));

vi.mock('./agents', () => ({ loadAgentConfig: h.loadAgentConfig }));
// CRM grounding is best-effort context — not what these tests cover.
vi.mock('./crm-context', () => ({
  buildCrmContext: vi.fn().mockResolvedValue(null),
}));
// Router pass-through: no specialists → default agent answers. The
// router's own matching logic is unit-tested in router.test.ts.
vi.mock('./router', () => ({
  routeConversation: vi
    .fn()
    .mockImplementation(
      (_db: unknown, _accountId: unknown, config: unknown) =>
        Promise.resolve({ config, specialist: null })
    ),
}));
vi.mock('./context', () => ({
  buildConversationContext: h.buildConversationContext,
}));
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }));
vi.mock('./generate', () => ({ generateReply: h.generateReply }));
vi.mock('@/features/admin/lib/orchestration/outbound', () => ({
  sendChannelMessage: h.sendChannelMessage,
}));
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'flows') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        };
        return chain;
      }
      // conversations
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: h.state.conv, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload;
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: h.state.claim, error: null });
    },
  }),
}));

import { dispatchInboundToAiReply } from './auto-reply';

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
};

type WorkerConfig = AiConfig & { agentId: string };

function aiConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    agentId: 'agent-row-1',
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 3,
    autoReplyLimitMode: 'per_conversation',
    autoReplyScheduleStart: null,
    autoReplyScheduleEnd: null,
    autoReplyTimezone: null,
    handoffAgentId: null,
    embeddingsApiKey: null,
    keySource: 'account',
    ...overrides,
  };
}

beforeEach(() => {
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  };
  h.state.autoResponders = [];
  h.state.claim = true;
  h.state.updatePayload = null;
  h.state.rpcCalls = [];
  h.loadAgentConfig.mockResolvedValue(aiConfig());
  h.buildConversationContext.mockResolvedValue([
    { role: 'user', content: 'hi' },
  ]);
  h.retrieveKnowledge.mockResolvedValue([]);
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false });
  h.sendChannelMessage.mockResolvedValue({ messageId: 'm1' });
});

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS);
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ]);
    expect(h.sendChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        payload: { kind: 'text', text: 'Hello!' },
        senderType: 'bot',
        aiGenerated: true,
      })
    );
  });

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.']);
    await dispatchInboundToAiReply(ARGS);
    expect(h.retrieveKnowledge).toHaveBeenCalled();
    // Knowledge rides in the cache-aligned volatile tail (final user
    // turn), NOT in the stable system prefix — that separation is what
    // keeps the provider's prefix cache valid across retrievals.
    const call = h.generateReply.mock.calls[0][0] as {
      promptParts: { systemBlocks: string[]; volatileContext: string | null };
      cacheKey?: string;
    };
    expect(call.promptParts.volatileContext).toContain(
      'Returns accepted within 30 days.'
    );
    expect(call.promptParts.systemBlocks.join('\n\n')).not.toContain(
      'Returns accepted within 30 days.'
    );
    expect(call.cacheKey).toBe('conv-1');
  });

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }];
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).not.toHaveBeenCalled();
    expect(h.sendChannelMessage).not.toHaveBeenCalled();
  });

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false;
    await dispatchInboundToAiReply(ARGS);
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1);
    expect(h.sendChannelMessage).not.toHaveBeenCalled();
  });

  it('skips when AI is off / not configured', async () => {
    h.loadAgentConfig.mockResolvedValue(null);
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).not.toHaveBeenCalled();
    expect(h.sendChannelMessage).not.toHaveBeenCalled();
  });

  it('skips when auto-reply is disabled for the account', async () => {
    // Capability gating lives in loadAgentConfig now: with the
    // autoreply_enabled column off it resolves null, not a config.
    h.loadAgentConfig.mockResolvedValue(null);
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).not.toHaveBeenCalled();
    expect(h.sendChannelMessage).not.toHaveBeenCalled();
  });

  it('stays silent once a human has actually replied', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      // Set by the close_handoff_on_agent_message trigger.
      ai_handoff_state: 'human_active',
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.sendChannelMessage).not.toHaveBeenCalled();
  });

  // Assignment alone must NOT silence the bot. Treating "a name is
  // attached" as "a person replied" is what left escalated customers
  // talking to nobody.
  it('still replies when assigned but no human has spoken yet', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
      ai_handoff_state: 'awaiting_human',
      ai_caretaker_count: 0,
      ai_last_caretaker_at: null,
      ai_escalated_at: new Date().toISOString(),
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.sendChannelMessage).toHaveBeenCalledTimes(1);
  });

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.sendChannelMessage).not.toHaveBeenCalled();
  });

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    };
    await dispatchInboundToAiReply(ARGS);
    expect(h.sendChannelMessage).not.toHaveBeenCalled();
  });

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([]);
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).not.toHaveBeenCalled();
    expect(h.sendChannelMessage).not.toHaveBeenCalled();
  });
});

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and sends a warm bridge message on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true });
    // Round-robin finds no eligible agent (empty account).
    h.state.claim = null as unknown as boolean;
    await dispatchInboundToAiReply(ARGS);
    // Warm handoff: the customer never faces silence — the model wrote
    // no bridge text here, so the static fallback bridge is sent.
    expect(h.sendChannelMessage).toHaveBeenCalledTimes(1);
    const bridgeArg = h.sendChannelMessage.mock.calls[0]?.[0] as {
      payload: { kind: string; text: string };
      senderType: string;
    };
    expect(bridgeArg.senderType).toBe('bot');
    expect(bridgeArg.payload.kind).toBe('text');
    expect(bridgeArg.payload.text).toContain('looping in');
    // No handoff target configured → one round-robin RPC attempt.
    expect(h.state.rpcCalls).toHaveLength(1);
    expect(h.state.rpcCalls[0]?.name).toBe('claim_round_robin_agent');
    // Escalation enters the caretaker phase. It must NOT set the
    // operator kill-switch: that flag is reserved for "Resume AI", and
    // setting it here is what muted the assistant permanently.
    expect(h.state.updatePayload).toMatchObject({
      ai_handoff_state: 'awaiting_human',
    });
    expect(h.state.updatePayload).not.toHaveProperty('ai_autoreply_disabled');
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off'
    );
    // Round-robin came back empty → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id');
  });

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAgentConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }));
    h.generateReply.mockResolvedValue({ text: '', handoff: true });
    await dispatchInboundToAiReply(ARGS);
    expect(h.state.updatePayload).toMatchObject({
      ai_handoff_state: 'awaiting_human',
      assigned_agent_id: 'agent-7',
    });
  });
});

/*
 * Caretaker phase.
 *
 * These are the tests that would have caught the original defect. The
 * previous suite only ever asserted what escalation *wrote to the row*,
 * which passed happily while the customer-visible outcome — silence on
 * the very next message — was broken.
 */
describe('dispatchInboundToAiReply — caretaker', () => {
  const escalatedConv = {
    assigned_agent_id: 'agent-9',
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
    ai_handoff_state: 'awaiting_human',
    ai_caretaker_count: 0,
    ai_last_caretaker_at: null,
    ai_escalated_at: new Date().toISOString(),
    ai_escalation_reason: 'needs_account_data',
  };

  it('replies to the customer after a handoff instead of going silent', async () => {
    h.state.conv = { ...escalatedConv };
    h.generateReply.mockResolvedValue({
      text: 'Thanks for waiting — I have added that to the thread.',
      handoff: false,
    });
    await dispatchInboundToAiReply(ARGS);
    expect(h.sendChannelMessage).toHaveBeenCalledTimes(1);
    const arg = h.sendChannelMessage.mock.calls[0]?.[0] as {
      payload: { text: string };
      senderType: string;
    };
    expect(arg.senderType).toBe('bot');
    expect(arg.payload.text).toContain('Thanks for waiting');
  });

  it('claims a caretaker slot before spending a provider call', async () => {
    h.state.conv = { ...escalatedConv };
    await dispatchInboundToAiReply(ARGS);
    expect(h.state.rpcCalls[0]?.name).toBe('claim_ai_caretaker_slot');
  });

  it('stays silent when the caretaker budget is spent', async () => {
    h.state.conv = { ...escalatedConv };
    h.state.claim = false; // RPC denies the slot
    await dispatchInboundToAiReply(ARGS);
    expect(h.generateReply).not.toHaveBeenCalled();
    expect(h.sendChannelMessage).not.toHaveBeenCalled();
  });

  it('sends the static fallback when generation fails', async () => {
    h.state.conv = { ...escalatedConv };
    h.generateReply.mockRejectedValue(new Error('provider down'));
    await dispatchInboundToAiReply(ARGS);
    // A caretaker turn must never end in silence.
    expect(h.sendChannelMessage).toHaveBeenCalledTimes(1);
  });

  it('ignores the per-conversation cap while waiting on a human', async () => {
    h.state.conv = { ...escalatedConv, ai_reply_count: 99 };
    await dispatchInboundToAiReply(ARGS);
    expect(h.sendChannelMessage).toHaveBeenCalledTimes(1);
  });

  it('obeys the operator kill-switch even while awaiting a human', async () => {
    h.state.conv = { ...escalatedConv, ai_autoreply_disabled: true };
    await dispatchInboundToAiReply(ARGS);
    expect(h.sendChannelMessage).not.toHaveBeenCalled();
  });
});
