import { describe, it, expect, vi, beforeEach } from 'vitest';
import { embedTexts, toVectorLiteral, EMBEDDING_MODEL } from './embeddings';
import { AiError } from './types';

// Mock the LangChain OpenAI embeddings client; the module under test
// owns batching config, error mapping, and shape validation.
const { EmbeddingsCtor, embedDocumentsMock } = vi.hoisted(() => {
  const embedDocumentsMock = vi.fn();
  // A regular function (not an arrow) so `new OpenAIEmbeddings(...)` works.
  const EmbeddingsCtor = vi.fn(function () {
    return { embedDocuments: embedDocumentsMock };
  });
  return { EmbeddingsCtor, embedDocumentsMock };
});
vi.mock('@langchain/openai', () => ({ OpenAIEmbeddings: EmbeddingsCtor }));

// Pin the engine to LangChain: these tests mock the LangChain
// embeddings client. Without this, the platform flag defaults to
// 'direct' and embedTextsDirect performs real HTTP fetches.
vi.mock('./engine-flag', () => ({
  getAiEngine: async () => 'langchain' as const,
  resetEngineCache: () => {},
  DEFAULT_AI_ENGINE: 'langchain' as const,
}));

beforeEach(() => {
  EmbeddingsCtor.mockClear();
  embedDocumentsMock.mockReset();
});

describe('toVectorLiteral', () => {
  it('formats a pgvector literal', () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe('[0.1,0.2,0.3]');
  });
});

describe('embedTexts', () => {
  it('returns [] and constructs no client for empty input', async () => {
    expect(await embedTexts('sk-x', [])).toEqual([]);
    expect(EmbeddingsCtor).not.toHaveBeenCalled();
  });

  it('embeds inputs with the caller key, model, and batch size', async () => {
    embedDocumentsMock.mockResolvedValue([
      [0, 0.5],
      [1, 1.5],
      [2, 2.5],
    ]);

    const out = await embedTexts('sk-x', ['a', 'b', 'c']);
    expect(out).toEqual([
      [0, 0.5],
      [1, 1.5],
      [2, 2.5],
    ]);
    expect(embedDocumentsMock).toHaveBeenCalledWith(['a', 'b', 'c']);
    expect(EmbeddingsCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-x',
        model: EMBEDDING_MODEL,
        batchSize: 96,
        maxRetries: 0,
      })
    );
  });

  it('maps a 401 provider failure to an invalid_key AiError', async () => {
    embedDocumentsMock.mockRejectedValue(
      Object.assign(new Error('bad key'), { status: 401 })
    );
    await expect(embedTexts('sk-x', ['a'])).rejects.toMatchObject({
      code: 'invalid_key',
      status: 401,
    });
  });

  it('maps a timeout to a timeout AiError', async () => {
    embedDocumentsMock.mockRejectedValue(
      new DOMException('timed out', 'TimeoutError')
    );
    await expect(embedTexts('sk-x', ['a'])).rejects.toMatchObject({
      code: 'timeout',
      status: 504,
    });
  });

  it('throws embeddings_malformed on a count mismatch', async () => {
    embedDocumentsMock.mockResolvedValue([[0.1]]);
    await expect(embedTexts('sk-x', ['a', 'b'])).rejects.toMatchObject({
      code: 'embeddings_malformed',
    });
  });

  it('throws embeddings_malformed when a vector is missing', async () => {
    embedDocumentsMock.mockResolvedValue([[0.1], null]);
    const err = await embedTexts('sk-x', ['a', 'b']).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe('embeddings_malformed');
  });
});
