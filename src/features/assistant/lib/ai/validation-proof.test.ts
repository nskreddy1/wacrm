import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OLLAMA_PLACEHOLDER_KEY } from './defaults';
import {
  createValidationProof,
  verifyValidationProof,
} from './validation-proof';

const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  process.env.ENCRYPTION_KEY = 'test-only-validation-proof-secret';
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe('Ollama validation proof', () => {
  it('binds a keyless Ollama test to its server URL', () => {
    const args = {
      accountId: 'account-1',
      provider: 'ollama' as const,
      model: 'llama3.2',
      apiKey: OLLAMA_PLACEHOLDER_KEY,
      baseUrl: 'http://localhost:11434',
    };
    const proof = createValidationProof(args);

    expect(verifyValidationProof(proof, args)).toBe(true);
    expect(
      verifyValidationProof(proof, {
        ...args,
        baseUrl: 'http://ollama.internal:11434',
      })
    ).toBe(false);
  });

  it('rejects a proof for a different model', () => {
    const args = {
      accountId: 'account-1',
      provider: 'ollama' as const,
      model: 'llama3.2',
      apiKey: OLLAMA_PLACEHOLDER_KEY,
      baseUrl: 'http://localhost:11434',
    };
    const proof = createValidationProof(args);

    expect(verifyValidationProof(proof, { ...args, model: 'qwen3' })).toBe(
      false
    );
  });
});
