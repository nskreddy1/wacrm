import { AiError, type AiConfig, type ChatMessage } from '../../types'
import { OPENAI_COMPAT_BASE_URL, aiRequestTimeoutMs } from '../../defaults'
import { providerLabel } from '../../errors'
import { generateOpenAi } from './openai'
import { generateAnthropic } from './anthropic'
import { generateGemini } from './gemini'
import type { ProviderResult } from './shared'

// ============================================================
// Direct engine — the original hand-rolled fetch adapters,
// restored from the pre-LangChain implementation (8dc358b^).
// Selected when the platform `ai_engine` flag is `direct`
// (the default).
// ============================================================

export interface DirectGenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider via
 * the direct fetch adapters. Returns the raw `{ text, usage }` —
 * sentinel/meta parsing stays in the shared dispatch layer
 * (src/lib/ai/generate.ts). Throws `AiError` on any provider/network
 * failure.
 */
export async function generateReplyDirect(
  args: DirectGenerateArgs,
): Promise<ProviderResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  switch (config.provider) {
    case 'openai':
      return generateOpenAi(providerArgs)
    case 'anthropic':
      return generateAnthropic(providerArgs)
    case 'gemini':
      return generateGemini(providerArgs)
    case 'custom': {
      // Bring-your-own OpenAI-compatible endpoint, per-account base URL.
      const baseUrl = config.baseUrl?.trim()
      if (!baseUrl) {
        throw new AiError(
          'A base URL is required for the custom OpenAI-compatible provider.',
          { code: 'missing_base_url', status: 400 },
        )
      }
      return generateOpenAi(providerArgs, {
        baseUrl,
        providerLabel: providerLabel('custom'),
      })
    }
    default: {
      // OpenAI-compatible presets (NVIDIA NIM, Groq, OpenRouter, Together,
      // Mistral, DeepSeek, xAI) — same protocol, registry-provided URL.
      const baseUrl = OPENAI_COMPAT_BASE_URL[config.provider]
      if (!baseUrl) {
        throw new AiError(`Unsupported AI provider: ${config.provider}`, {
          code: 'unsupported_provider',
          status: 400,
        })
      }
      return generateOpenAi(providerArgs, {
        baseUrl,
        providerLabel: providerLabel(config.provider),
      })
    }
  }
}
