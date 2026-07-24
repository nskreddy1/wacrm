import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatchInboundToFlows: vi.fn(),
  dispatchEventToFlows: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
}));

vi.mock('@/features/flows/lib/engine', () => ({
  dispatchInboundToFlows: mocks.dispatchInboundToFlows,
  dispatchEventToFlows: mocks.dispatchEventToFlows,
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
  mocks.dispatchEventToFlows.mockResolvedValue({ started: 0 });
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
    expect(mocks.dispatchEventToFlows).not.toHaveBeenCalled();
    expect(mocks.dispatchInboundToAiReply).not.toHaveBeenCalled();
  });

  it('raises new_contact_created to flows before AI when unconsumed', async () => {
    const input = {
      ...baseInput,
      contactCreated: true,
      isFirstInboundMessage: true,
    };

    await orchestrateInboundChannelMessage(input);

    expect(mocks.dispatchEventToFlows).toHaveBeenCalledWith({
      accountId: 'account-1',
      contactId: 'contact-1',
      conversationId: 'conversation-1',
      event: { type: 'new_contact_created' },
      messageText: 'Hello there',
    });
    expect(mocks.dispatchInboundToAiReply).toHaveBeenCalledWith({
      accountId: 'account-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      configOwnerUserId: 'user-1',
    });
    expect(
      mocks.dispatchEventToFlows.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.dispatchInboundToAiReply.mock.invocationCallOrder[0]);
  });

  it('skips the contact-created event for existing contacts', async () => {
    await orchestrateInboundChannelMessage(baseInput);

    expect(mocks.dispatchEventToFlows).not.toHaveBeenCalled();
    expect(mocks.dispatchInboundToAiReply).toHaveBeenCalled();
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

    expect(mocks.dispatchEventToFlows).not.toHaveBeenCalled();
    expect(mocks.dispatchInboundToAiReply).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
