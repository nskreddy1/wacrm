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

export type AssistantProvider = 'openai' | 'anthropic' | 'gemini'

export const ASSISTANT_PROVIDERS: readonly AssistantProvider[] = [
  'openai',
  'anthropic',
  'gemini',
]

export const ASSISTANT_DEFAULT_MODEL: Record<AssistantProvider, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
  gemini: 'gemini-2.0-flash',
}

export interface AssistantConfig {
  provider: AssistantProvider
  model: string
  /** Decrypted, ready to use. Never serialize back to the client. */
  apiKey: string
  enabled: boolean
}

interface StoredAssistantConfig {
  provider?: unknown
  model?: unknown
  api_key?: unknown
  enabled?: unknown
}

export function isAssistantProvider(v: unknown): v is AssistantProvider {
  return v === 'openai' || v === 'anthropic' || v === 'gemini'
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
  if (typeof v.api_key !== 'string' || v.api_key.length === 0) return null

  let apiKey: string
  try {
    apiKey = decrypt(v.api_key)
  } catch {
    // Rotated/mismatched ENCRYPTION_KEY — surface in logs, treat as
    // unconfigured rather than crashing every chat request.
    console.error(
      '[assistant config] platform key could not be decrypted — check ENCRYPTION_KEY; the helper agent is disabled until the key is re-entered.',
    )
    return null
  }

  return {
    provider: v.provider,
    model:
      typeof v.model === 'string' && v.model.trim().length > 0
        ? v.model.trim()
        : ASSISTANT_DEFAULT_MODEL[v.provider],
    apiKey,
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
  }
}
