import { describe, expect, it } from 'vitest';
import {
  AI_PROVIDER_OPTIONS,
  getProviderCapabilities,
  normalizeProviderBaseUrl,
} from './providers';

describe('AI provider metadata', () => {
  it('lists every supported provider in the settings order', () => {
    expect(AI_PROVIDER_OPTIONS.map(({ value }) => value)).toEqual([
      'openai',
      'anthropic',
      'gemini',
      'nvidia',
      'groq',
      'openrouter',
      'together',
      'mistral',
      'deepseek',
      'xai',
      'ollama',
      'custom',
    ]);
  });

  it('marks Ollama as keyless with base URL support', () => {
    expect(getProviderCapabilities('ollama')).toMatchObject({
      requiresApiKey: false,
      supportsBaseUrl: true,
    });
  });

  it('only retains base URLs for providers that support them', () => {
    expect(normalizeProviderBaseUrl('ollama', '')).toBe(
      'http://localhost:11434'
    );
    expect(normalizeProviderBaseUrl('custom', ' https://ai.example/v1 ')).toBe(
      'https://ai.example/v1'
    );
    expect(
      normalizeProviderBaseUrl('openai', 'https://ignored.example')
    ).toBeNull();
  });
});
