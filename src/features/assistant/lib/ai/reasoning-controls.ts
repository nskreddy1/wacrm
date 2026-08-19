import type { AiProvider } from './types';

// ============================================================
// Request-side reasoning suppression, per provider.
//
// `reasoning.ts` is the LAST line of defence — it scrubs scratchpad
// out of whatever text a provider hands back. This module is the FIRST
// one: it asks each provider not to think in the first place, which is
// strictly better, because a model that never reasons spends its whole
// output budget on the reply instead of returning a truncated thought
// with no answer (the WhatsApp incident).
//
// There is NO portable way to do this. Every provider spells it
// differently and rejects the others' spelling, so this cannot be one
// shared flag:
//
//   OpenAI       reasoning_effort: 'none' | 'minimal'
//   Anthropic    thinking: { type: 'disabled' }
//   Gemini       thinkingConfig.thinkingBudget: 0   (see gemini.ts)
//   Groq         reasoning_format: 'hidden' (+ effort)
//   OpenRouter   reasoning: { enabled: false, exclude: true }
//   NVIDIA NIM   chat_template_kwargs: { enable_thinking: false }
//   Together     chat_template_kwargs: { enable_thinking: false }
//   DeepSeek     thinking: { type: 'disabled' }
//   xAI          reasoning_effort: 'low'  (grok-3-mini only)
//   Ollama       reasoning_effort: 'none'
//   Mistral      — no knob exists
//
// Sending the wrong key is a 400, and this is a bring-your-own-key
// product where an operator can type ANY model id into settings. So
// every adapter that uses these params must retry the request without
// them on a 400 (`gemini.ts` established the pattern). That keeps an
// unknown model working while still suppressing reasoning on the ones
// we do know.
//
// Reasoning is always off — there is no user-facing toggle. A one-line
// WhatsApp reply never benefits from chain-of-thought, and an operator
// who could turn it on would only be able to break customer replies.
// Which providers can honour that is documented for operators in
// docs/ai-provider-reasoning.md.
// ============================================================

/**
 * How completely a provider/model pair can honour "do not reason".
 *
 * - `full`    — reasoning can be switched off outright.
 * - `reduced` — only lowered to a floor (the model always thinks a
 *               little); the text-level guards still matter.
 * - `none`    — no knob at all; containment is entirely after the fact.
 */
export type ReasoningControl = 'full' | 'reduced' | 'none';

export interface ReasoningSuppression {
  /**
   * Extra top-level fields to merge into the chat-completions body.
   * Empty when the provider has no knob — callers must treat `{}` as
   * "send the plain request", not as an error.
   */
  params: Record<string, unknown>;
  control: ReasoningControl;
}

const NOTHING: ReasoningSuppression = { params: {}, control: 'none' };

const lower = (model: string) => model.trim().toLowerCase();

/**
 * OpenAI proper. `reasoning_effort: 'none'` landed with gpt-5.1 and is
 * the only value that disables reasoning outright; gpt-5.0 tops out at
 * `'minimal'`, and the o-series enforces a floor of `'low'`. Sending
 * the param to a non-reasoning model (gpt-4o, gpt-4.1) is a 400, so
 * those get nothing.
 */
function openAiSuppression(model: string): ReasoningSuppression {
  const m = lower(model);

  // gpt-5.1 and every later 5.x (5.2, 5.4-mini, …) — 'none' supported.
  if (/gpt-5\.[1-9]/.test(m)) {
    return { params: { reasoning_effort: 'none' }, control: 'full' };
  }
  // gpt-5 / gpt-5-mini / gpt-5-nano — 'minimal' is the floor, but it is
  // low enough that the scratchpad does not eat the reply budget.
  if (/gpt-5(?:-|$)/.test(m) || m === 'gpt-5') {
    return { params: { reasoning_effort: 'minimal' }, control: 'reduced' };
  }
  // o1 / o3 / o4 reasoning line — always thinks; 'low' is the floor.
  if (/^o[1-4](?:-|$)/.test(m)) {
    return { params: { reasoning_effort: 'low' }, control: 'reduced' };
  }
  // gpt-4o, gpt-4.1, gpt-4o-mini … never reason. Sending the param 400s.
  return NOTHING;
}

/**
 * Anthropic. Extended thinking is opt-in on 3.7/4.x, so omitting the
 * field would already be correct — but Claude 4.6 introduced adaptive
 * thinking that can engage on its own, so we say `disabled` out loud.
 * Older API revisions reject the field, hence the caller's 400 retry.
 */
function anthropicSuppression(): ReasoningSuppression {
  return { params: { thinking: { type: 'disabled' } }, control: 'full' };
}

/**
 * Groq. `reasoning_format: 'hidden'` keeps the scratchpad out of
 * `content` for every reasoning model it serves — the single most
 * valuable knob here, because Groq's catalogue is mostly Qwen/DeepSeek
 * distills that inline `<think>` blocks. Qwen3 additionally accepts
 * `reasoning_effort: 'none'` to skip thinking entirely; gpt-oss floors
 * at 'low'.
 */
function groqSuppression(model: string): ReasoningSuppression {
  const m = lower(model);
  if (m.includes('qwen')) {
    return {
      params: { reasoning_format: 'hidden', reasoning_effort: 'none' },
      control: 'full',
    };
  }
  if (m.includes('gpt-oss')) {
    return {
      params: { reasoning_format: 'hidden', reasoning_effort: 'low' },
      control: 'reduced',
    };
  }
  if (m.includes('deepseek') || m.includes('qwq') || m.includes('r1')) {
    return { params: { reasoning_format: 'hidden' }, control: 'reduced' };
  }
  // Llama / Gemma / Mixtral on Groq don't reason at all.
  return NOTHING;
}

/**
 * OpenRouter normalizes reasoning across every upstream it proxies:
 * `enabled: false` asks the upstream not to think, `exclude: true`
 * guarantees no scratchpad comes back even if it does anyway.
 */
function openRouterSuppression(): ReasoningSuppression {
  return {
    params: { reasoning: { enabled: false, exclude: true } },
    control: 'full',
  };
}

/**
 * vLLM-backed catalogues (NVIDIA NIM, Together). Hybrid models —
 * Qwen3, Nemotron — read `enable_thinking` out of
 * `chat_template_kwargs` and skip the scratchpad when it is false.
 * Non-hybrid models ignore the field or 400 (then the retry covers us).
 */
function vllmSuppression(model: string): ReasoningSuppression {
  const m = lower(model);
  const hybrid =
    m.includes('qwen3') ||
    m.includes('nemotron') ||
    m.includes('deepseek') ||
    m.includes('r1') ||
    m.includes('qwq') ||
    m.includes('magistral') ||
    m.includes('thinking');
  if (!hybrid) return NOTHING;
  return {
    params: { chat_template_kwargs: { enable_thinking: false } },
    control: 'full',
  };
}

/**
 * DeepSeek. `deepseek-chat` (V3 non-thinking) needs nothing;
 * `deepseek-reasoner` cannot be talked out of reasoning at all — it
 * exists to reason, and returns the scratchpad on `reasoning_content`,
 * which the adapter never reads. V3.2+ accepts an explicit disable.
 */
function deepSeekSuppression(model: string): ReasoningSuppression {
  const m = lower(model);
  if (m.includes('reasoner')) return NOTHING;
  return { params: { thinking: { type: 'disabled' } }, control: 'full' };
}

/**
 * xAI. Only the small Grok models expose `reasoning_effort`, and their
 * floor is 'low'; grok-4 reasons unconditionally with no knob.
 */
function xaiSuppression(model: string): ReasoningSuppression {
  const m = lower(model);
  if (m.includes('mini') || m.includes('fast')) {
    return { params: { reasoning_effort: 'low' }, control: 'reduced' };
  }
  return NOTHING;
}

/**
 * Ollama's OpenAI-compatible `/v1` surface. Important quirk: for a
 * thinking-capable local model Ollama turns thinking ON by default, so
 * saying nothing is the wrong default here — `'none'` is what keeps a
 * local qwen3/deepseek-r1 from emitting `<think>` blocks. Older
 * daemons don't know the param and 400, which the retry absorbs.
 */
function ollamaSuppression(): ReasoningSuppression {
  return { params: { reasoning_effort: 'none' }, control: 'full' };
}

/**
 * Reasoning-suppression params for a provider/model pair.
 *
 * Callers MUST tolerate a 400 and retry without `params` — see the
 * module header. `custom` deliberately returns nothing: an unknown
 * OpenAI-compatible gateway may reject or, worse, misinterpret a
 * vendor-specific field, so those deployments rely on the text-level
 * guards and on the operator picking a non-reasoning model.
 */
export function reasoningSuppressionFor(
  provider: AiProvider,
  model: string
): ReasoningSuppression {
  switch (provider) {
    case 'openai':
      return openAiSuppression(model);
    case 'anthropic':
      return anthropicSuppression();
    case 'groq':
      return groqSuppression(model);
    case 'openrouter':
      return openRouterSuppression();
    case 'nvidia':
    case 'together':
      return vllmSuppression(model);
    case 'deepseek':
      return deepSeekSuppression(model);
    case 'xai':
      return xaiSuppression(model);
    case 'ollama':
      return ollamaSuppression();
    // Gemini has its own request shape (thinkingConfig lives under
    // generationConfig, not at top level) and is handled in gemini.ts.
    case 'gemini':
      return { params: {}, control: 'full' };
    // Mistral exposes no knob (magistral always reasons), and `custom`
    // is unknowable.
    case 'mistral':
    case 'custom':
      return NOTHING;
    default:
      return NOTHING;
  }
}
