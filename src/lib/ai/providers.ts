import type { AiProvider } from './types';

export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434';

export interface AiProviderOption {
  value: AiProvider;
  label: string;
  requiresApiKey: boolean;
  supportsBaseUrl: boolean;
  keyPlaceholder: string;
}

export const AI_PROVIDER_OPTIONS: readonly AiProviderOption[] = [
  {
    value: 'openai',
    label: 'OpenAI',
    requiresApiKey: true,
    supportsBaseUrl: false,
    keyPlaceholder: 'sk-...',
  },
  {
    value: 'anthropic',
    label: 'Anthropic (Claude)',
    requiresApiKey: true,
    supportsBaseUrl: false,
    keyPlaceholder: 'sk-ant-...',
  },
  {
    value: 'gemini',
    label: 'Google (Gemini)',
    requiresApiKey: true,
    supportsBaseUrl: false,
    keyPlaceholder: 'AIza...',
  },
  {
    value: 'nvidia',
    label: 'NVIDIA (NIM)',
    requiresApiKey: true,
    supportsBaseUrl: false,
    keyPlaceholder: 'nvapi-...',
  },
  {
    value: 'groq',
    label: 'Groq',
    requiresApiKey: true,
    supportsBaseUrl: false,
    keyPlaceholder: 'gsk_...',
  },
  {
    value: 'openrouter',
    label: 'OpenRouter',
    requiresApiKey: true,
    supportsBaseUrl: false,
    keyPlaceholder: 'sk-or-...',
  },
  {
    value: 'together',
    label: 'Together AI',
    requiresApiKey: true,
    supportsBaseUrl: false,
    keyPlaceholder: 'API key',
  },
  {
    value: 'mistral',
    label: 'Mistral',
    requiresApiKey: true,
    supportsBaseUrl: false,
    keyPlaceholder: 'API key',
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    requiresApiKey: true,
    supportsBaseUrl: false,
    keyPlaceholder: 'sk-...',
  },
  {
    value: 'xai',
    label: 'xAI (Grok)',
    requiresApiKey: true,
    supportsBaseUrl: false,
    keyPlaceholder: 'xai-...',
  },
  {
    value: 'ollama',
    label: 'Ollama (self-hosted)',
    requiresApiKey: false,
    supportsBaseUrl: true,
    keyPlaceholder: '',
  },
  {
    value: 'custom',
    label: 'Custom (OpenAI-compatible)',
    requiresApiKey: true,
    supportsBaseUrl: true,
    keyPlaceholder: 'API key',
  },
];

const PROVIDERS_BY_VALUE = new Map(
  AI_PROVIDER_OPTIONS.map((option) => [option.value, option])
);

export function getProviderCapabilities(
  provider: AiProvider
): AiProviderOption {
  const option = PROVIDERS_BY_VALUE.get(provider);
  if (!option) throw new Error(`Unsupported AI provider: ${provider}`);
  return option;
}

export function normalizeProviderBaseUrl(
  provider: AiProvider,
  baseUrl: string
): string | null {
  if (!getProviderCapabilities(provider).supportsBaseUrl) return null;
  const normalized = baseUrl.trim();
  if (provider === 'ollama') return normalized || OLLAMA_DEFAULT_BASE_URL;
  return normalized || null;
}
