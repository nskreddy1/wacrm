import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  listProviderModels,
  resetModelCatalogCache,
} from './model-catalog';
import { AiError } from './types';

// ============================================================
// The model catalogue's regressions are all SHAPE regressions: a
// provider that answers a bare array instead of `{data}`, a paged
// listing read one page deep, a key that travels somewhere it must
// not. None of those throw — they silently produce an empty or
// truncated list, which reads to an operator as "my key has no
// models". So the per-provider response shapes are pinned here, along
// with the cache contract the 1-instance-many-tenants case depends on.
// ============================================================

const fetchMock = vi.fn();

/** One canned JSON response. */
function jsonOnce(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

/** URLs the code under test asked for, in order. */
function requestedUrls(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

function headersOf(call: number): Record<string, string> {
  return (fetchMock.mock.calls[call]?.[1]?.headers ?? {}) as Record<
    string,
    string
  >;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  resetModelCatalogCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetModelCatalogCache();
});

describe('listProviderModels — OpenAI', () => {
  it('reads the `{data: […]}` envelope and drops non-chat endpoints', async () => {
    jsonOnce({
      data: [
        { id: 'gpt-4o' },
        { id: 'text-embedding-3-small' },
        { id: 'whisper-1' },
        { id: 'dall-e-3' },
        { id: 'sora-2' },
        { id: 'gpt-4o-realtime-preview' },
        { id: 'gpt-3.5-turbo-instruct' },
        { id: 'davinci-002' },
        { id: 'omni-moderation-latest' },
      ],
    });

    const models = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-test-key-1234',
    });

    expect(models.map((m) => m.id)).toEqual(['gpt-4o']);
    expect(requestedUrls()[0]).toBe('https://api.openai.com/v1/models');
    expect(headersOf(0).Authorization).toBe('Bearer sk-test-key-1234');
  });

  it('annotates reasoning capability and sorts thinking models first', async () => {
    jsonOnce({
      data: [{ id: 'gpt-4o' }, { id: 'o3-mini' }, { id: 'gpt-5.1' }],
    });

    const models = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-test-key-1234',
    });

    expect(models).toEqual([
      { id: 'gpt-5.1', label: 'gpt-5.1', reasoning: true },
      { id: 'o3-mini', label: 'o3-mini', reasoning: true },
      { id: 'gpt-4o', label: 'gpt-4o', reasoning: false },
    ]);
  });

  it('dedupes repeated ids and prefers the vendor display name', async () => {
    jsonOnce({
      data: [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o', name: 'GPT-4o (dupe)' },
      ],
    });

    const models = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-test-key-1234',
    });

    expect(models).toEqual([
      { id: 'gpt-4o', label: 'GPT-4o', reasoning: false },
    ]);
  });
});

describe('listProviderModels — OpenAI-compatible presets', () => {
  it('accepts a BARE ARRAY body (Together) as well as `{data}`', async () => {
    jsonOnce([
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
      { id: 'BAAI/bge-large-en-v1.5' },
    ]);

    const models = await listProviderModels({
      provider: 'together',
      apiKey: 'together-key-abcd',
    });

    // The embedding model is filtered; the chat model survives — before
    // this fix the whole list read as empty.
    expect(models.map((m) => m.id)).toEqual([
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    ]);
    expect(requestedUrls()[0]).toBe('https://api.together.xyz/v1/models');
  });

  it('keeps NVIDIA `-instruct` chat models (they are not completions models)', async () => {
    jsonOnce({
      data: [
        { id: 'meta/llama-3.3-70b-instruct' },
        { id: 'nvidia/llama-3.2-nv-embedqa-1b-v2' },
        { id: 'nvidia/llama-3.3-nemotron-super-49b-v1' },
      ],
    });

    const models = await listProviderModels({
      provider: 'nvidia',
      apiKey: 'nvapi-test-key',
    });

    expect(models.map((m) => m.id)).toEqual([
      // Nemotron is a hybrid thinker, so it sorts first.
      'nvidia/llama-3.3-nemotron-super-49b-v1',
      'meta/llama-3.3-70b-instruct',
    ]);
    expect(models[0].reasoning).toBe(true);
    expect(models[1].reasoning).toBe(false);
    expect(requestedUrls()[0]).toBe(
      'https://integrate.api.nvidia.com/v1/models'
    );
  });

  it('marks the DeepSeek reasoner as thinking and `deepseek-chat` as not', async () => {
    jsonOnce({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] });

    const models = await listProviderModels({
      provider: 'deepseek',
      apiKey: 'sk-deepseek-key',
    });

    expect(models).toEqual([
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner', reasoning: true },
      { id: 'deepseek-chat', label: 'deepseek-chat', reasoning: false },
    ]);
    expect(requestedUrls()[0]).toBe('https://api.deepseek.com/models');
  });
});

describe('listProviderModels — Anthropic', () => {
  it('uses x-api-key + a version header and the display_name label', async () => {
    jsonOnce({
      data: [
        { id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' },
        { id: 'claude-3-5-haiku-20241022', display_name: 'Claude Haiku 3.5' },
      ],
    });

    const models = await listProviderModels({
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key',
    });

    expect(models).toEqual([
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        reasoning: true,
      },
      {
        id: 'claude-3-5-haiku-20241022',
        label: 'Claude Haiku 3.5',
        reasoning: false,
      },
    ]);
    expect(headersOf(0)['x-api-key']).toBe('sk-ant-test-key');
    expect(headersOf(0)['anthropic-version']).toBe('2023-06-01');
  });
});

describe('listProviderModels — Gemini', () => {
  it('authenticates by header and never puts the key in the URL', async () => {
    jsonOnce({
      models: [
        {
          name: 'models/gemini-flash-latest',
          displayName: 'Gemini Flash',
          supportedGenerationMethods: ['generateContent'],
        },
      ],
    });

    const models = await listProviderModels({
      provider: 'gemini',
      apiKey: 'AIza-secret-key',
    });

    expect(models).toEqual([
      { id: 'gemini-flash-latest', label: 'Gemini Flash', reasoning: true },
    ]);
    expect(headersOf(0)['x-goog-api-key']).toBe('AIza-secret-key');
    // The whole point of the header: URLs land in logs.
    for (const url of requestedUrls()) {
      expect(url).not.toContain('AIza-secret-key');
      expect(url).not.toContain('key=');
    }
  });

  it('follows nextPageToken so the list is complete', async () => {
    jsonOnce({
      models: [
        {
          name: 'models/gemini-2.5-flash',
          supportedGenerationMethods: ['generateContent'],
        },
      ],
      nextPageToken: 'page-2',
    });
    jsonOnce({
      models: [
        {
          name: 'models/gemini-2.5-pro',
          supportedGenerationMethods: ['generateContent'],
        },
        // Embedding-only model: excluded by the method filter, not the
        // name filter.
        {
          name: 'models/text-bison-001',
          supportedGenerationMethods: ['generateText'],
        },
      ],
    });

    const models = await listProviderModels({
      provider: 'gemini',
      apiKey: 'AIza-secret-key',
    });

    expect(models.map((m) => m.id)).toEqual([
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedUrls()[1]).toContain('pageToken=page-2');
  });

  it('stops after the page cap even if the provider keeps paging', async () => {
    for (let i = 0; i < 8; i += 1) {
      jsonOnce({
        models: [
          {
            name: `models/gemini-2.5-flash-${i}`,
            supportedGenerationMethods: ['generateContent'],
          },
        ],
        nextPageToken: `page-${i + 1}`,
      });
    }

    const models = await listProviderModels({
      provider: 'gemini',
      apiKey: 'AIza-secret-key',
    });

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(models).toHaveLength(5);
  });
});

describe('listProviderModels — provider requirements', () => {
  it('refuses to call out without a key (except Ollama)', async () => {
    await expect(
      listProviderModels({ provider: 'openai', apiKey: '' })
    ).rejects.toMatchObject({ code: 'missing_key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('needs a base URL for the custom provider', async () => {
    await expect(
      listProviderModels({ provider: 'custom', apiKey: 'k', baseUrl: '  ' })
    ).rejects.toMatchObject({ code: 'missing_base_url' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists a keyless Ollama daemon at its base URL', async () => {
    jsonOnce({ data: [{ id: 'qwen3:0.6b' }] });

    const models = await listProviderModels({
      provider: 'ollama',
      apiKey: '',
      baseUrl: 'http://127.0.0.1:11434/v1/',
    });

    expect(models[0]).toMatchObject({ id: 'qwen3:0.6b', reasoning: true });
    expect(requestedUrls()[0]).toBe('http://127.0.0.1:11434/v1/models');
  });
});

describe('listProviderModels — error mapping', () => {
  it.each([
    [401, 'invalid_key'],
    [403, 'invalid_key'],
    [429, 'rate_limited'],
    [404, 'not_supported'],
    [500, 'provider_error'],
  ])('maps HTTP %i to code %s', async (status, code) => {
    jsonOnce({ error: 'nope' }, status);

    await expect(
      listProviderModels({ provider: 'openai', apiKey: 'sk-a-key-1234' })
    ).rejects.toMatchObject({ code });
  });

  it('maps an aborted request to `timeout`', async () => {
    const timeout = new Error('The operation was aborted');
    timeout.name = 'TimeoutError';
    fetchMock.mockRejectedValueOnce(timeout);

    await expect(
      listProviderModels({ provider: 'openai', apiKey: 'sk-a-key-1234' })
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('maps unreadable JSON to `bad_response`', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    });

    await expect(
      listProviderModels({ provider: 'openai', apiKey: 'sk-a-key-1234' })
    ).rejects.toMatchObject({ code: 'bad_response' });
  });

  it('always throws AiError, never a bare provider error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));

    const err = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-a-key-1234',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe('network_error');
  });
});

describe('listProviderModels — cache', () => {
  it('serves a repeat listing from cache', async () => {
    jsonOnce({ data: [{ id: 'gpt-4o' }] });

    const first = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-a-key-1234',
    });
    const second = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-a-key-1234',
    });

    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keys on the API key, so a rotated key re-lists', async () => {
    jsonOnce({ data: [{ id: 'gpt-4o' }] });
    jsonOnce({ data: [{ id: 'gpt-4o' }, { id: 'gpt-5.1' }] });

    await listProviderModels({ provider: 'openai', apiKey: 'sk-old-key-1111' });
    const after = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-new-key-2222',
    });

    expect(after).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('negative-caches a failure instead of re-hitting the provider', async () => {
    jsonOnce({ error: 'bad key' }, 401);

    const first = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-a-key-1234',
    }).catch((e) => e);
    const second = await listProviderModels({
      provider: 'openai',
      apiKey: 'sk-a-key-1234',
    }).catch((e) => e);

    expect(first).toBeInstanceOf(AiError);
    // Same error object replayed — a remembered 401 is indistinguishable
    // from a fresh one to the caller.
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent identical listings into one upstream call', async () => {
    let release: (() => void) | null = null;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: [{ id: 'gpt-4o' }] }),
            });
        })
    );

    const a = listProviderModels({
      provider: 'openai',
      apiKey: 'sk-a-key-1234',
    });
    const b = listProviderModels({
      provider: 'openai',
      apiKey: 'sk-a-key-1234',
    });
    // Both are in flight before any response lands.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release?.();

    expect(await a).toEqual(await b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
