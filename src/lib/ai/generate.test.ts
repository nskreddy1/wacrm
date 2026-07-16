import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { generateReply, parseGeneration } from './generate'
import { AiError, type AiConfig } from './types'

// Mock only the chat-model factory — usage normalization, provider
// labels, and error mapping stay real so the tests exercise the same
// code paths production does.
const { resolveChatModelMock } = vi.hoisted(() => ({
  resolveChatModelMock: vi.fn(),
}))
vi.mock('./model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./model')>()
  return { ...actual, resolveChatModel: resolveChatModelMock }
})

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    keySource: 'account',
    ...overrides,
  }
}

/** Fake LangChain chat model whose `invoke` we control per test. */
function fakeModel(invoke: ReturnType<typeof vi.fn>) {
  return { invoke } as unknown
}

function aiMessage(content: unknown, usage_metadata?: unknown) {
  return { content, usage_metadata }
}

beforeEach(() => {
  resolveChatModelMock.mockReset()
})

describe('parseGeneration', () => {
  it('returns text with no handoff', () => {
    expect(parseGeneration('Hello there')).toEqual({
      text: 'Hello there',
      handoff: false,
      usage: null,
      sentiment: 'neutral',
      escalationReason: null,
    })
  })

  it('detects + strips the handoff sentinel', () => {
    expect(parseGeneration('[[HANDOFF]]')).toMatchObject({
      text: '',
      handoff: true,
    })
    expect(parseGeneration('Let me get a human [[HANDOFF]]')).toMatchObject({
      text: 'Let me get a human',
      handoff: true,
    })
  })

  it('passes usage straight through', () => {
    const usage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    expect(parseGeneration('Hi', usage)).toMatchObject({ text: 'Hi', usage })
  })

  it('parses and strips the [[META]] tail', () => {
    const res = parseGeneration(
      'I will get a person to help.\n[[META]]{"sentiment":"angry","escalate":true,"reason":"angry_customer"}',
    )
    expect(res).toEqual({
      text: 'I will get a person to help.',
      handoff: true,
      usage: null,
      sentiment: 'angry',
      escalationReason: 'angry_customer',
    })
  })

  it('degrades gracefully on malformed meta', () => {
    const res = parseGeneration('Hi there\n[[META]]{not json')
    expect(res).toEqual({
      text: 'Hi there',
      handoff: false,
      usage: null,
      sentiment: 'neutral',
      escalationReason: null,
    })
  })
})

describe('generateReply', () => {
  it('invokes the resolved model and returns the parsed reply + usage', async () => {
    const invoke = vi.fn().mockResolvedValue(
      aiMessage('Sure — happy to help!', {
        input_tokens: 42,
        output_tokens: 8,
        total_tokens: 50,
      }),
    )
    resolveChatModelMock.mockReturnValue(fakeModel(invoke))

    const res = await generateReply({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hi' }],
    })

    expect(res).toMatchObject({
      text: 'Sure — happy to help!',
      handoff: false,
      usage: { promptTokens: 42, completionTokens: 8, totalTokens: 50 },
    })
    // System prompt first, then the customer turn.
    const msgs = invoke.mock.calls[0][0]
    expect(msgs[0]).toBeInstanceOf(SystemMessage)
    expect(msgs[0].content).toBe('sys')
    expect(msgs[1]).toBeInstanceOf(HumanMessage)
    expect(msgs[1].content).toBe('Hi')
  })

  it('joins array content parts and sums usage without a total', async () => {
    const invoke = vi.fn().mockResolvedValue(
      aiMessage([{ type: 'text', text: 'Hi ' }, { type: 'text', text: 'there!' }], {
        input_tokens: 30,
        output_tokens: 6,
      }),
    )
    resolveChatModelMock.mockReturnValue(fakeModel(invoke))

    const res = await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(res).toMatchObject({
      text: 'Hi there!',
      usage: { promptTokens: 30, completionTokens: 6, totalTokens: 36 },
    })
  })

  it('detects handoff in the model output', async () => {
    const invoke = vi.fn().mockResolvedValue(aiMessage('[[HANDOFF]]'))
    resolveChatModelMock.mockReturnValue(fakeModel(invoke))

    const res = await generateReply({
      config: config(),
      systemPrompt: 'sys',
      messages: [{ role: 'user', content: 'I want to speak to a person' }],
    })
    expect(res.handoff).toBe(true)
    expect(res.text).toBe('')
  })

  it('merges consecutive same-role turns', async () => {
    const invoke = vi.fn().mockResolvedValue(aiMessage('ok'))
    resolveChatModelMock.mockReturnValue(fakeModel(invoke))

    await generateReply({
      config: config(),
      systemPrompt: 'sys',
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'user', content: 'Anyone there?' },
      ],
    })

    const msgs = invoke.mock.calls[0][0]
    expect(msgs).toHaveLength(2) // system + one merged user turn
    expect(msgs[1].content).toBe('Hi\n\nAnyone there?')
  })

  it('drops a leading assistant turn for Anthropic so the transcript starts on the customer', async () => {
    const invoke = vi.fn().mockResolvedValue(aiMessage('ok'))
    resolveChatModelMock.mockReturnValue(fakeModel(invoke))

    await generateReply({
      config: config({ provider: 'anthropic' }),
      systemPrompt: 'sys',
      messages: [
        { role: 'assistant', content: 'Welcome!' },
        { role: 'user', content: 'Hi' },
      ],
    })

    const msgs = invoke.mock.calls[0][0]
    expect(msgs).toHaveLength(2) // system + user only
    expect(msgs[1]).toBeInstanceOf(HumanMessage)
    expect(msgs[1].content).toBe('Hi')
  })

  it('maps a 401 provider failure to an invalid_key AiError', async () => {
    const err = Object.assign(new Error('Incorrect API key'), { status: 401 })
    resolveChatModelMock.mockReturnValue(fakeModel(vi.fn().mockRejectedValue(err)))

    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
  })

  it('throws on an empty completion', async () => {
    resolveChatModelMock.mockReturnValue(fakeModel(vi.fn().mockResolvedValue(aiMessage('   '))))

    await expect(
      generateReply({
        config: config(),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'empty_response' })
  })

  it('propagates config AiErrors from the model factory untouched', async () => {
    resolveChatModelMock.mockImplementation(() => {
      throw new AiError('A base URL is required for the custom OpenAI-compatible provider.', {
        code: 'missing_base_url',
        status: 400,
      })
    })

    await expect(
      generateReply({
        config: config({ provider: 'custom' }),
        systemPrompt: 'sys',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toMatchObject({ code: 'missing_base_url', status: 400 })
  })
})
