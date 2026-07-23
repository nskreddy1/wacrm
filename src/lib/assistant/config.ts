import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { LanguageModel } from 'ai'
import { decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/ai/admin-client'

// ============================================================
// Platform assistant config — the in-app helper agent.
//
// Unlike workspace `ai_configs` (per-tenant BYO keys), the helper
// agent runs on ONE platform-wide key owned by the founder/support
// team. It lives in `platform_settings` under `assistant_config`,
// with the API key encrypted at rest using the same AES-256-GCM
// helper as tenant keys. The table has RLS with no policies, so the
// only path to it is the service-role client behind super-admin (for
// writes) or server-only code (for reads here).
// ============================================================

export const ASSISTANT_SETTING_KEY = 'assistant_config'

export type AssistantProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'nvidia'
  | 'ollama'
  | 'groq'
  | 'mistral'
  | 'deepseek'
  | 'xai'

export const ASSISTANT_PROVIDERS: readonly AssistantProvider[] = [
  'openai',
  'anthropic',
  'gemini',
  'nvidia',
  'ollama',
  'groq',
  'mistral',
  'deepseek',
  'xai',
]

export const ASSISTANT_DEFAULT_MODEL: Record<AssistantProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini: 'gemini-2.0-flash',
  nvidia: 'meta/llama-3.1-8b-instruct',
  ollama: 'llama3.1',
  groq: 'llama-3.3-70b-versatile',
  mistral: 'mistral-small-latest',
  deepseek: 'deepseek-chat',
  xai: 'grok-3-mini',
}

/**
 * OpenAI-compatible providers are served through `@ai-sdk/openai`
 * pointed at their own base URL. Ollama's default targets a local
 * server; admins override it with their hosted URL via `base_url`.
 */
const OPENAI_COMPATIBLE_BASE_URL: Partial<Record<AssistantProvider, string>> = {
  nvidia: 'https://integrate.api.nvidia.com/v1',
  ollama: 'http://localhost:11434/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  xai: 'https://api.x.ai/v1',
}

/** Ollama servers typically require no API key. */
export function providerRequiresKey(p: AssistantProvider): boolean {
  return p !== 'ollama'
}

export interface AssistantConfig {
  provider: AssistantProvider
  model: string
  /** Decrypted, ready to use. Never serialize back to the client. */
  apiKey: string
  /** Custom endpoint override (mainly for self-hosted Ollama/NIM). */
  baseUrl: string | null
  enabled: boolean
}

interface StoredAssistantConfig {
  provider?: unknown
  model?: unknown
  api_key?: unknown
  base_url?: unknown
  enabled?: unknown
}

export function isAssistantProvider(v: unknown): v is AssistantProvider {
  return (
    typeof v === 'string' &&
    (ASSISTANT_PROVIDERS as readonly string[]).includes(v)
  )
}

/**
 * Load + decrypt the platform assistant config. Returns null when the
 * assistant is not configured or explicitly disabled — callers treat
 * both as "helper agent unavailable".
 */
export async function loadAssistantConfig(): Promise<AssistantConfig | null> {
  const { data, error } = await supabaseAdmin()
    .from('platform_settings')
    .select('value')
    .eq('key', ASSISTANT_SETTING_KEY)
    .maybeSingle()

  if (error || !data?.value) return null
  const v = data.value as StoredAssistantConfig
  if (v.enabled === false) return null
  if (!isAssistantProvider(v.provider)) return null

  const hasStoredKey = typeof v.api_key === 'string' && v.api_key.length > 0
  if (!hasStoredKey && providerRequiresKey(v.provider)) return null

  let apiKey = ''
  if (hasStoredKey) {
    try {
      apiKey = decrypt(v.api_key as string)
    } catch {
      // Rotated/mismatched ENCRYPTION_KEY — surface in logs, treat as
      // unconfigured rather than crashing every chat request.
      console.error(
        '[assistant config] platform key could not be decrypted — check ENCRYPTION_KEY; the helper agent is disabled until the key is re-entered.',
      )
      return null
    }
  }

  return {
    provider: v.provider,
    model:
      typeof v.model === 'string' && v.model.trim().length > 0
        ? v.model.trim()
        : ASSISTANT_DEFAULT_MODEL[v.provider],
    apiKey,
    baseUrl:
      typeof v.base_url === 'string' && v.base_url.trim().length > 0
        ? v.base_url.trim()
        : null,
    enabled: true,
  }
}

/** Resolve an AI SDK model instance for the stored provider + key. */
export function resolveAssistantModel(config: AssistantConfig): LanguageModel {
  switch (config.provider) {
    case 'openai':
      return createOpenAI({ apiKey: config.apiKey })(config.model)
    case 'anthropic':
      return createAnthropic({ apiKey: config.apiKey })(config.model)
    case 'gemini':
      return createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model)
    default: {
      // OpenAI-compatible providers (NVIDIA NIM, Ollama, Groq,
      // Mistral, DeepSeek, xAI): reuse the OpenAI SDK against the
      // provider's endpoint, with optional admin-set base URL override.
      // IMPORTANT: use .chat() — the default callable targets OpenAI's
      // Responses API (/v1/responses), which these servers don't
      // implement (NVIDIA returns "404 page not found" for it).
      const baseURL =
        config.baseUrl ?? OPENAI_COMPATIBLE_BASE_URL[config.provider]
      return createOpenAI({
        apiKey: config.apiKey || 'ollama', // some servers reject empty keys
        baseURL,
      }).chat(config.model)
    }
  }
}
