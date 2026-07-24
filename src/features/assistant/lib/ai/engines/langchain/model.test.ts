import { describe, it, expect } from 'vitest';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { normalizeLcUsage, resolveChatModel } from './model';
import { providerLabel, toAiError } from '../../errors';
import { AiError, type AiConfig, type AiProvider } from '../../types';

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
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

describe('resolveChatModel', () => {
  it('dispatches native providers to their LangChain class', () => {
    expect(resolveChatModel(config({ provider: 'openai' }))).toBeInstanceOf(
      ChatOpenAI
    );
    expect(
      resolveChatModel(config({ provider: 'anthropic', model: 'claude-test' }))
    ).toBeInstanceOf(ChatAnthropic);
    expect(
      resolveChatModel(config({ provider: 'gemini', model: 'gemini-test' }))
    ).toBeInstanceOf(ChatGoogleGenerativeAI);
  });

  it('serves OpenAI-compatible presets through ChatOpenAI', () => {
    for (const provider of ['groq', 'nvidia', 'openrouter', 'xai'] as const) {
      expect(resolveChatModel(config({ provider }))).toBeInstanceOf(ChatOpenAI);
    }
  });

  it('serves a custom endpoint through ChatOpenAI when a base URL is set', () => {
    expect(
      resolveChatModel(
        config({ provider: 'custom', baseUrl: 'https://gw.example.com/v1' })
      )
    ).toBeInstanceOf(ChatOpenAI);
  });

  it('throws missing_base_url for custom without a base URL', () => {
    for (const baseUrl of [undefined, null, '', '   ']) {
      expect(() =>
        resolveChatModel(config({ provider: 'custom', baseUrl }))
      ).toThrowError(
        expect.objectContaining({ code: 'missing_base_url', status: 400 })
      );
    }
  });

  it('throws unsupported_provider for an unknown provider', () => {
    expect(() =>
      resolveChatModel(config({ provider: 'nope' as AiProvider }))
    ).toThrowError(
      expect.objectContaining({ code: 'unsupported_provider', status: 400 })
    );
  });
});

describe('providerLabel', () => {
  it('maps providers to human-readable names', () => {
    expect(providerLabel('openai')).toBe('OpenAI');
    expect(providerLabel('nvidia')).toBe('NVIDIA');
    expect(providerLabel('custom')).toBe('Custom endpoint');
  });
});

describe('normalizeLcUsage', () => {
  it('maps LangChain usage_metadata to AiUsage', () => {
    expect(
      normalizeLcUsage({ input_tokens: 42, output_tokens: 8, total_tokens: 50 })
    ).toEqual({ promptTokens: 42, completionTokens: 8, totalTokens: 50 });
  });

  it('sums input + output when total is missing', () => {
    expect(normalizeLcUsage({ input_tokens: 30, output_tokens: 6 })).toEqual({
      promptTokens: 30,
      completionTokens: 6,
      totalTokens: 36,
    });
  });

  it('returns null when nothing usable is reported', () => {
    expect(normalizeLcUsage(undefined)).toBeNull();
    expect(normalizeLcUsage(null)).toBeNull();
    expect(normalizeLcUsage({})).toBeNull();
    expect(
      normalizeLcUsage({ input_tokens: 0, output_tokens: 0, total_tokens: 0 })
    ).toBeNull();
  });

  it('ignores negative / non-finite counts', () => {
    expect(
      normalizeLcUsage({
        input_tokens: -5,
        output_tokens: Number.NaN,
        total_tokens: 12,
      })
    ).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 12 });
  });
});

describe('toAiError', () => {
  const status = (n: number) =>
    Object.assign(new Error(`http ${n}`), { status: n });

  it('passes an existing AiError through untouched', () => {
    const original = new AiError('boom', { code: 'rate_limited', status: 502 });
    expect(toAiError(original, 'OpenAI')).toBe(original);
  });

  it('maps 401/403 to invalid_key with HTTP 401', () => {
    for (const s of [401, 403]) {
      const err = toAiError(status(s), 'OpenAI');
      expect(err).toMatchObject({ code: 'invalid_key', status: 401 });
      expect(err.message).toContain('OpenAI rejected the API key');
    }
  });

  it('maps 429 to rate_limited', () => {
    expect(toAiError(status(429), 'Groq')).toMatchObject({
      code: 'rate_limited',
      status: 502,
    });
  });

  it('maps other HTTP statuses to provider_error', () => {
    expect(toAiError(status(500), 'Anthropic')).toMatchObject({
      code: 'provider_error',
      status: 502,
    });
  });

  it('reads statusCode when status is absent', () => {
    const err = Object.assign(new Error('nope'), { statusCode: 401 });
    expect(toAiError(err, 'Gemini')).toMatchObject({ code: 'invalid_key' });
  });

  it('maps timeout/abort errors to timeout with HTTP 504', () => {
    expect(
      toAiError(new DOMException('timed out', 'TimeoutError'), 'OpenAI')
    ).toMatchObject({ code: 'timeout', status: 504 });
    expect(
      toAiError(new DOMException('aborted', 'AbortError'), 'OpenAI')
    ).toMatchObject({ code: 'timeout', status: 504 });
  });

  it('maps everything else to network_error', () => {
    expect(toAiError(new Error('ECONNREFUSED'), 'OpenAI')).toMatchObject({
      code: 'network_error',
      status: 502,
    });
    expect(toAiError('weird string failure', 'OpenAI')).toMatchObject({
      code: 'network_error',
      status: 502,
    });
  });
});
