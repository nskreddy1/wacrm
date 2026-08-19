import type { LucideIcon } from 'lucide-react';
import { MessageCircleReply, Sparkles } from 'lucide-react';
import type {
  AgentCapability,
  ClientAgent,
} from '@/features/assistant/lib/ai/agents';
import type { AiProvider } from '@/features/assistant/lib/ai/types';
import {
  AI_PROVIDER_DEFAULT_MODEL,
  OLLAMA_DEFAULT_BASE_URL,
} from '@/features/assistant/lib/ai/defaults';

// ============================================================
// Client-side metadata for the AI Agents console. ONE default agent
// per account (single ai_agents row / single config) with two
// independently toggleable capabilities — AI suggestions (inbox
// drafts) and Auto-reply — each mapping to its own DB column.
// Types come from the server lib via type-only imports (erased at
// build).
// ============================================================

export type { AgentCapability, ClientAgent };

export const DEFAULT_AGENT_NAME = 'AI Assistant';

/** Working starting-point persona shown pre-filled in the wizard. */
export const STARTER_PROMPT =
  'You represent our business with customers on WhatsApp. Be warm, professional, and concise. Only answer questions about our business. If the customer wants a human, is upset, or you are not sure, hand off to the team.';

export interface CapabilityMeta {
  capability: AgentCapability;
  /** ClientAgent boolean that backs this capability's toggle. */
  field: 'suggestionsEnabled' | 'autoreplyEnabled';
  name: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  /** The ai_usage_log.mode this capability's runs are recorded
   *  under — scopes Run History / Usage filters. */
  mode: 'draft' | 'auto_reply';
}

export const CAPABILITY_META: Record<AgentCapability, CapabilityMeta> = {
  suggestions: {
    capability: 'suggestions',
    field: 'suggestionsEnabled',
    name: 'AI suggestions',
    tagline: 'Drafts replies for your team',
    description:
      'Assists your team inside the inbox — drafts suggested replies from the conversation history and your knowledge base. Suggestions are never sent without a person approving them.',
    icon: Sparkles,
    mode: 'draft',
  },
  autoreply: {
    capability: 'autoreply',
    field: 'autoreplyEnabled',
    name: 'Auto-reply',
    tagline: 'Answers customers automatically',
    description:
      'Replies to incoming WhatsApp messages on its own using your business context and knowledge base. Hands the conversation to your team whenever a customer asks for a human or it is unsure.',
    icon: MessageCircleReply,
    mode: 'auto_reply',
  },
};

export const CAPABILITY_ORDER: readonly AgentCapability[] = [
  'suggestions',
  'autoreply',
];

export interface ProviderPreset {
  id: AiProvider;
  label: string;
  /** One-line hint shown under the picker. */
  hint: string;
  defaultModel: string;
  needsBaseUrl?: boolean;
  /** Ollama needs no API key. */
  keyOptional?: boolean;
}

/** Ordered for the picker: mainstream first, self-hosted last. */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', hint: 'GPT models — platform.openai.com' },
  { id: 'anthropic', label: 'Claude', hint: 'Anthropic — console.anthropic.com' },
  { id: 'gemini', label: 'Gemini', hint: 'Google AI Studio key' },
  { id: 'groq', label: 'Groq', hint: 'Fast open models — console.groq.com' },
  { id: 'nvidia', label: 'NVIDIA', hint: 'build.nvidia.com API key' },
  { id: 'openrouter', label: 'OpenRouter', hint: 'One key, many models' },
  { id: 'together', label: 'Together AI', hint: 'Open models — api.together.xyz' },
  { id: 'mistral', label: 'Mistral', hint: 'console.mistral.ai key' },
  { id: 'deepseek', label: 'DeepSeek', hint: 'platform.deepseek.com key' },
  { id: 'xai', label: 'xAI (Grok)', hint: 'console.x.ai key' },
  {
    id: 'ollama',
    label: 'Ollama',
    hint: `Self-hosted, no key — default ${OLLAMA_DEFAULT_BASE_URL}`,
    keyOptional: true,
  },
  {
    id: 'custom',
    label: 'Custom',
    hint: 'Any OpenAI-compatible https endpoint',
    needsBaseUrl: true,
  },
].map((p) => ({
  ...p,
  defaultModel: AI_PROVIDER_DEFAULT_MODEL[p.id as AiProvider],
})) as ProviderPreset[];

// ============================================================
// Agent status — ONE definition (ADR-005 D8).
//
// "Is this agent usable" used to be recomputed in four places and had
// already drifted: the Playground required a key, the console rail did
// not, so a key-less agent read as "Paused" instead of "Not
// configured". Both helpers below are the single source every surface
// (console rail, Configuration header, Playground banner, inbox
// auto-reply banner) derives from, so they cannot disagree again.
//
// The definition is deliberately the STRICTEST of the four: a provider
// and a model are not enough, because generation fails without a key.
// Ollama is the one provider that needs none.
// ============================================================

/** Has this agent everything it needs to produce a reply at all? */
export function isAgentConfigured(
  agent: ClientAgent | null | undefined
): boolean {
  return Boolean(
    agent?.provider &&
      agent?.model &&
      (agent?.hasApiKey || agent?.provider === 'ollama')
  );
}

/**
 * Is auto-reply actually answering customers right now? Configured,
 * plus the master switch, plus the capability's own column — the same
 * gating `loadAgentConfig` applies on the server.
 *
 * Per-conversation state (a paused thread, an active human) is NOT part
 * of this: that is a property of the conversation, not the agent.
 */
export function isAutoReplyLive(
  agent: ClientAgent | null | undefined
): boolean {
  return Boolean(
    isAgentConfigured(agent) && agent?.isEnabled && agent?.autoreplyEnabled
  );
}

export function providerLabel(id: string | null): string {
  return PROVIDER_PRESETS.find((p) => p.id === id)?.label ?? id ?? '—';
}

/** Shared SWR fetcher that surfaces API error messages. */
export async function swrJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (payload as { error?: string }).error ?? 'Request failed'
    );
  }
  return payload as T;
}
