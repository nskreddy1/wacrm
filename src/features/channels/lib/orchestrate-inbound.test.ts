import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatchInboundToFlows: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
}));

vi.mock('@/features/flows/lib/engine', () => ({
  dispatchInboundToFlows: mocks.dispatchInboundToFlows,
}));
vi.mock('@/features/automations/lib/engine', () => ({
  runAutomationsForTrigger: mocks.runAutomationsForTrigger,
}));
vi.mock('@/features/assistant/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: mocks.dispatchInboundToAiReply,
}));

import { orchestrateInboundChannelMessage } from './orchestrate-inbound';

const baseInput = {
  accountId: 'account-1',
  conversationId: 'conversation-1',
  contactId: 'contact-1',
  externalMessageId: 'provider-message-1',
  text: 'Hello there',
  contentType: 'text' as const,
  contactCreated: false,
  isFirstInboundMessage: false,
  configOwnerUserId: 'user-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dispatchInboundToFlows.mockResolvedValue({
    consumed: false,
    outcome: 'no_match',
  });
  mocks.runAutomationsForTrigger.mockResolvedValue(undefined);
  mocks.dispatchInboundToAiReply.mockResolvedValue(undefined);
});

describe('orchestrateInboundChannelMessage', () => {
  it('stops after a deterministic Flow consumes the inbound message', async () => {
    mocks.dispatchInboundToFlows.mockResolvedValue({
      consumed: true,
      outcome: 'started',
    });

    await orchestrateInboundChannelMessage(baseInput);

    expect(mocks.dispatchInboundToFlows).toHaveBeenCalledWith({
      accountId: 'account-1',
      userId: 'user-1',
      contactId: 'contact-1',
      conversationId: 'conversation-1',
      isFirstInboundMessage: false,
      message: {
        kind: 'text',
        text: 'Hello there',
        meta_message_id: 'provider-message-1',
      },
    });
    expect(mocks.runAutomationsForTrigger).not.toHaveBeenCalled();
    expect(mocks.dispatchInboundToAiReply).not.toHaveBeenCalled();
  });

  it('runs content and lifecycle automations before AI when unconsumed', async () => {
    const input = {
      ...baseInput,
      contactCreated: true,
      isFirstInboundMessage: true,
    };

    await orchestrateInboundChannelMessage(input);

    const context = {
      message_text: 'Hello there',
      conversation_id: 'conversation-1',
    };
    expect(
      mocks.runAutomationsForTrigger.mock.calls.map(([call]) => call)
    ).toEqual([
      {
        accountId: 'account-1',
        triggerType: 'new_message_received',
        contactId: 'contact-1',
        context,
      },
      {
        accountId: 'account-1',
        triggerType: 'keyword_match',
        contactId: 'contact-1',
        context,
      },
      {
        accountId: 'account-1',
        triggerType: 'new_contact_created',
        contactId: 'contact-1',
        context,
      },
      {
        accountId: 'account-1',
        triggerType: 'first_inbound_message',
        contactId: 'contact-1',
        context,
      },
    ]);
    expect(mocks.dispatchInboundToAiReply).toHaveBeenCalledWith({
      accountId: 'account-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      configOwnerUserId: 'user-1',
    });
    expect(
      mocks.runAutomationsForTrigger.mock.invocationCallOrder.at(-1)
    ).toBeLessThan(mocks.dispatchInboundToAiReply.mock.invocationCallOrder[0]);
  });

  it('does not invoke AI for non-text or blank text messages', async () => {
    await orchestrateInboundChannelMessage({
      ...baseInput,
      contentType: 'image',
    });
    await orchestrateInboundChannelMessage({ ...baseInput, text: '   ' });

    expect(mocks.dispatchInboundToAiReply).not.toHaveBeenCalled();
  });

  it('contains downstream failures so provider acknowledgments are unaffected', async () => {
    mocks.dispatchInboundToFlows.mockRejectedValue(
      new Error('flow unavailable')
    );
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await expect(
      orchestrateInboundChannelMessage(baseInput)
    ).resolves.toBeUndefined();

    expect(mocks.runAutomationsForTrigger).not.toHaveBeenCalled();
    expect(mocks.dispatchInboundToAiReply).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
