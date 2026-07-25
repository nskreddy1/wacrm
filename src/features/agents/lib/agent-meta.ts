import type { LucideIcon } from 'lucide-react';
import { MessageCircleReply, Sparkles } from 'lucide-react';
import type {
  AgentKind,
  ClientAgent,
} from '@/features/assistant/lib/ai/agents';
import type { AiProvider } from '@/features/assistant/lib/ai/types';
import {
  AI_PROVIDER_DEFAULT_MODEL,
  OLLAMA_DEFAULT_BASE_URL,
} from '@/features/assistant/lib/ai/defaults';

// ============================================================
// Client-side metadata for the AI Agents console: what each agent
// kind is, and the provider picker presets. Types come from the
// server lib via type-only imports (erased at build).
// ============================================================

export type { AgentKind, ClientAgent };

export interface AgentKindMeta {
  kind: AgentKind;
  name: string;
  tagline: string;
  description: string;
  icon: LucideIcon;
  /** Pre-filled persona prompt in the wizard — a working starting
   *  point the client can keep, not a placeholder. */
  starterPrompt: string;
}

export const AGENT_KIND_META: Record<AgentKind, AgentKindMeta> = {
  copilot: {
    kind: 'copilot',
    name: 'Support Copilot',
    tagline: 'Drafts replies for your team',
    description:
      'Assists your team inside the inbox — drafts suggested replies from the conversation history and your knowledge base. Suggestions are never sent without a person approving them.',
    icon: Sparkles,
    starterPrompt:
      'You help our support team reply to customers. Match our tone: friendly, professional, and brief. If you are unsure about specifics, say so in the draft so the agent can fill them in.',
  },
  autoreply: {
    kind: 'autoreply',
    name: 'Auto-Reply Agent',
    tagline: 'Answers customers automatically',
    description:
      'Replies to incoming WhatsApp messages on its own using your business context and knowledge base. Hands the conversation to your team whenever a customer asks for a human or it is unsure.',
    icon: MessageCircleReply,
    starterPrompt:
      'You answer customers of our business on WhatsApp. Be warm and concise. Only answer questions about our business. If the customer wants a human, is upset, or you are not sure, hand off to the team.',
  },
};

export const AGENT_KIND_ORDER: readonly AgentKind[] = ['copilot', 'autoreply'];

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
