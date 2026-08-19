// ============================================================
// Per-provider reasoning controls — the REQUEST-side half of
// reasoning handling.
//
// `reasoning.ts` is the response-side half: it scrubs a scratchpad
// out of text the model already produced. That is a safety net, and
// a lossy one — by the time it runs, the thinking tokens have
// already been paid for and have already eaten into the reply
// budget. `MAX_OUTPUT_TOKENS` is a single budget shared by the
// scratchpad AND the answer, so a model that thinks for 900 tokens
// with a 1024 cap returns a truncated thought and no reply. That is
// exactly the "Here's a thinking process: 1. Analyze User Input…"
// message that reached a live WhatsApp customer.
//
// This module is the first line of defence: tell the provider up
// front how much to think. Every provider spells that differently:
//
//   OpenAI       reasoning_effort: 'none' | 'minimal' | 'low' | …
//   Anthropic    thinking: { type: 'disabled' | 'enabled', budget_tokens }
//   Gemini       thinkingConfig.thinkingBudget / thinkingLevel (see gemini.ts)
//   Groq         reasoning_format: 'hidden' + reasoning_effort
//   OpenRouter   reasoning: { enabled, effort, exclude }
//   NVIDIA NIM   chat_template_kwargs: { enable_thinking }
//   Together     chat_template_kwargs: { enable_thinking }
//   DeepSeek     thinking: { type: 'disabled' | 'enabled' }
//   xAI          reasoning_effort  (grok-3-mini / grok-4-fast only)
//   Ollama       reasoning_effort
//   Mistral      nothing portable
//
// Unknown or non-reasoning models get `{}` — send the plain request.
// Callers MUST tolerate a 400 and retry without these params, because
// the model catalogue moves faster than this table (see the retry in
// each adapter). Nothing here is ever load-bearing for correctness:
// the `reasoning.ts` guards still run on every response regardless of
// mode, so a scratchpad can never reach a customer even if a provider
// ignores us completely.
// ============================================================

import { MAX_OUTPUT_TOKENS } from './defaults';
import type { AiProvider, ReasoningMode } from './types';

/**
 * How well we can actually honour the requested mode for a given
 * provider + model pair. Surfaced to operators in the UI so "why is
 * this model still thinking?" is answerable without reading code.
 *
 *  - `full`    — the provider has a real switch and we are using it.
 *  - `reduced` — the model refuses to stop thinking entirely; we
 *                clamped it to its lowest legal setting.
 *  - `none`    — no knob exists (or the model never reasons anyway);
 *                the response-side guards are all that apply.
 */
export type ReasoningControl = 'full' | 'reduced' | 'none';

export interface ReasoningPlan {
  /**
   * Extra top-level fields to merge into the chat-completions body.
   * Empty when the provider has no knob — callers must treat `{}` as
   * "send the plain request", not as an error.
   */
  params: Record<string, unknown>;
  control: ReasoningControl;
  /**
   * Minimum output-token budget this plan needs to be viable.
   *
   * Only set when reasoning is being turned ON. Thinking tokens are
   * drawn from the same allowance as the reply, so leaving the normal
   * `MAX_OUTPUT_TOKENS` (1024) in place would let the scratchpad
   * consume the entire budget and truncate the answer — reproducing
   * the very bug this module exists to prevent. Adapters raise
   * `max_tokens` to at least this value when it is present.
   */
  minOutputTokens?: number;
}

const NOTHING: ReasoningPlan = { params: {}, control: 'none' };

const lower = (model: string) => model.trim().toLowerCase();

/**
 * Token budget when reasoning is deliberately enabled: room for a
 * short scratchpad plus a full-length reply. Anthropic additionally
 * *requires* `budget_tokens >= 1024` and `max_tokens > budget_tokens`,
 * so anything less than this simply 400s.
 */
const REASONING_BUDGET = 1024;
const REASONING_OUTPUT_TOKENS = MAX_OUTPUT_TOKENS + REASONING_BUDGET;

/* ---------------------------------------------------------- */
/* mode: 'off' — ask the provider not to think.                */
/* ---------------------------------------------------------- */

/**
 * OpenAI proper. `reasoning_effort: 'none'` landed with gpt-5.1 and is
 * the only value that disables reasoning outright; gpt-5.0 tops out at
 * `'minimal'`, and the o-series enforces a floor of `'low'`. Sending
 * the param to a non-reasoning model (gpt-4o, gpt-4.1) is a 400, so
 * those get nothing.
 */
function openAiOff(model: string): ReasoningPlan {
  const m = lower(model);
  if (/gpt-5\.[1-9]/.test(m)) {
    return { params: { reasoning_effort: 'none' }, control: 'full' };
  }
  if (/gpt-5(?:-|$)/.test(m)) {
    return { params: { reasoning_effort: 'minimal' }, control: 'reduced' };
  }
  if (/^o[1-4](?:-|$)/.test(m)) {
    return { params: { reasoning_effort: 'low' }, control: 'reduced' };
  }
  return NOTHING;
}

/**
 * Anthropic. Extended thinking is opt-in on 3.7/4.x, so omitting the
 * field would already be correct — but Claude 4.6 introduced adaptive
 * thinking that can engage on its own, so we say `disabled` out loud.
 * Older API revisions reject the field, hence the caller's 400 retry.
 */
function anthropicOff(): ReasoningPlan {
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
function groqOff(model: string): ReasoningPlan {
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
  return NOTHING;
}

/**
 * OpenRouter normalizes reasoning across every upstream it proxies:
 * `enabled: false` asks the upstream not to think, `exclude: true`
 * guarantees no scratchpad comes back even if it does anyway.
 */
function openRouterOff(): ReasoningPlan {
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
function vllmOff(model: string): ReasoningPlan {
  if (!isHybridThinker(model)) return NOTHING;
  return {
    params: { chat_template_kwargs: { enable_thinking: false } },
    control: 'full',
  };
}

/** Models that ship a switchable thinking mode in their chat template. */
function isHybridThinker(model: string): boolean {
  const m = lower(model);
  return (
    m.includes('qwen3') ||
    m.includes('nemotron') ||
    m.includes('deepseek') ||
    m.includes('r1') ||
    m.includes('qwq') ||
    m.includes('magistral') ||
    m.includes('thinking')
  );
}

/**
 * DeepSeek. `deepseek-chat` (V3 non-thinking) needs nothing;
 * `deepseek-reasoner` thinks unconditionally unless told otherwise.
 * Note that V3.2 also *ignores* `temperature` while thinking is on —
 * which is why sampling controls are only meaningful with mode 'off'.
 */
function deepSeekOff(model: string): ReasoningPlan {
  if (lower(model).includes('chat')) return NOTHING;
  return { params: { thinking: { type: 'disabled' } }, control: 'full' };
}

/**
 * xAI. Only the small Grok models expose `reasoning_effort`, and their
 * floor is 'low' — grok-4 and up always reason and reject the field.
 */
function xaiOff(model: string): ReasoningPlan {
  const m = lower(model);
  if (m.includes('mini') || m.includes('fast')) {
    return { params: { reasoning_effort: 'low' }, control: 'reduced' };
  }
  return NOTHING;
}

/**
 * Ollama exposes OpenAI's `reasoning_effort` on its /v1 shim. On a
 * thinking-capable local model Ollama turns thinking ON by default, so
 * this one matters more than most.
 */
function ollamaOff(): ReasoningPlan {
  return { params: { reasoning_effort: 'none' }, control: 'full' };
}

/* ---------------------------------------------------------- */
/* mode: 'on' — ask for thinking, and ask for it to stay hidden. */
/* ---------------------------------------------------------- */

/**
 * Turning reasoning ON never means showing it to the customer. Where a
 * provider can hide the scratchpad server-side (`exclude`, `hidden`)
 * we ask it to; where it cannot, `reasoning.ts` strips it on the way
 * out. Every branch that enables thinking also claims a bigger output
 * budget via `minOutputTokens`.
 */
function reasoningOn(provider: AiProvider, model: string): ReasoningPlan {
  const m = lower(model);
  const budgeted = (params: Record<string, unknown>): ReasoningPlan => ({
    params,
    control: 'full',
    minOutputTokens: REASONING_OUTPUT_TOKENS,
  });

  switch (provider) {
    case 'openai':
      // Only the reasoning lines accept the field at all.
      if (/gpt-5/.test(m) || /^o[1-4](?:-|$)/.test(m)) {
        return budgeted({ reasoning_effort: 'medium' });
      }
      return NOTHING;

    case 'anthropic':
      return budgeted({
        thinking: { type: 'enabled', budget_tokens: REASONING_BUDGET },
      });

    case 'groq':
      // Keep the scratchpad out of `content` even while thinking.
      return budgeted({
        reasoning_format: 'hidden',
        reasoning_effort: 'default',
      });

    case 'openrouter':
      return budgeted({ reasoning: { enabled: true, exclude: true } });

    case 'nvidia':
    case 'together':
      if (!isHybridThinker(model)) return NOTHING;
      return budgeted({ chat_template_kwargs: { enable_thinking: true } });

    case 'deepseek':
      if (m.includes('chat')) return NOTHING;
      return budgeted({ thinking: { type: 'enabled' } });

    case 'xai':
      if (m.includes('mini') || m.includes('fast')) {
        return budgeted({ reasoning_effort: 'high' });
      }
      return NOTHING;

    case 'ollama':
      return budgeted({ reasoning_effort: 'medium' });

    // Gemini's thinkingConfig lives under generationConfig, not at the
    // top level — gemini.ts owns that shape. It still needs the budget.
    case 'gemini':
      return {
        params: {},
        control: 'full',
        minOutputTokens: REASONING_OUTPUT_TOKENS,
      };

    case 'mistral':
    case 'custom':
      return NOTHING;
  }
}

/* ---------------------------------------------------------- */
/* Entry point                                                 */
/* ---------------------------------------------------------- */

/**
 * Resolve the request-body fields that express `mode` for this
 * provider + model.
 *
 * `auto` deliberately returns `{}`: it means "send no reasoning flags
 * and let the model do whatever it does by default". That is NOT the
 * same as 'off' — it is an escape hatch for models whose defaults we
 * have mapped wrongly, and it is the one mode where a scratchpad is
 * expected to show up in the response for `reasoning.ts` to strip.
 */
export function reasoningPlanFor(
  provider: AiProvider,
  model: string,
  mode: ReasoningMode
): ReasoningPlan {
  if (mode === 'auto') return NOTHING;
  if (mode === 'on') return reasoningOn(provider, model);

  switch (provider) {
    case 'openai':
      return openAiOff(model);
    case 'anthropic':
      return anthropicOff();
    case 'groq':
      return groqOff(model);
    case 'openrouter':
      return openRouterOff();
    case 'nvidia':
    case 'together':
      return vllmOff(model);
    case 'deepseek':
      return deepSeekOff(model);
    case 'xai':
      return xaiOff(model);
    case 'ollama':
      return ollamaOff();
    // Gemini's knob lives under generationConfig.thinkingConfig, which
    // gemini.ts applies (and steps down on 400). Nothing to merge at
    // the top level, but the control really is 'full' there.
    case 'gemini':
      return { params: {}, control: 'full' };
    // Mistral has no portable switch — Magistral always reasons, and
    // the rest never do. Response-side guards only.
    case 'mistral':
    case 'custom':
      return NOTHING;
  }
}

/**
 * The output-token budget to send, given a plan. Keeps the
 * "reasoning needs more room" rule in one place instead of repeating
 * the `??` in every adapter.
 */
export function outputTokensFor(plan: ReasoningPlan): number {
  return Math.max(MAX_OUTPUT_TOKENS, plan.minOutputTokens ?? 0);
}

/* ---------------------------------------------------------- */
/* Capability detection — the UI half.                         */
/* ---------------------------------------------------------- */

/**
 * Which models on each provider actually have a reasoning knob.
 *
 * `reasoningPlanFor` above answers "what do I send"; this answers the
 * different question "should an operator even be offered the choice".
 * They are deliberately separate: the plan is allowed to be optimistic
 * (a stray param that 400s is retried away by every adapter), but a
 * *switch* that silently does nothing is a lie to the operator — the
 * whole reason a `gpt-4o` account could flip "Think before replying"
 * and see no difference whatsoever.
 *
 * Matched against the lowercased model id, so both `gpt-5.1` and
 * `openai/gpt-5.1` (OpenRouter-style) hit the same rule.
 */
const REASONING_MODELS: Partial<Record<AiProvider, RegExp>> = {
  // gpt-5 line + the o-series. gpt-4o / gpt-4.1 reject the field.
  openai: /gpt-5|(?:^|\/)o[1-4](?:-|$)/,
  // Extended thinking arrived in 3.7 and is standard from 4.x on;
  // claude-3-5-* and older have no `thinking` field at all.
  anthropic: /claude-(?:3[-.]7|(?:sonnet|opus|haiku)-[4-9]|[4-9])/,
  // Thinking budgets exist on 2.5 and later. The `-latest` aliases
  // resolve to current (thinking-capable) models.
  gemini: /gemini-(?:2\.5|[3-9])|(?:flash|pro)-latest|thinking/,
  // Groq's reasoning catalogue: Qwen, gpt-oss, DeepSeek distills, QwQ.
  groq: /qwen|gpt-oss|deepseek|qwq|r1/,
  // DeepSeek: only the reasoner line thinks; `deepseek-chat` never does.
  deepseek: /reasoner|r1/,
  // Only the small Grok models expose the knob — grok-4+ always reason
  // and reject `reasoning_effort`, so there is nothing to toggle.
  xai: /mini|fast/,
};

/**
 * Providers where the knob is model-independent.
 *
 *  - `openrouter` normalizes `reasoning` across every upstream it
 *    proxies, and answers for models we've never heard of.
 *  - `ollama` serves whatever the operator pulled locally; we cannot
 *    enumerate it, and Ollama turns thinking ON by default on a
 *    thinking-capable model, so hiding the switch would be worse.
 */
const ALWAYS_TOGGLEABLE: readonly AiProvider[] = ['openrouter', 'ollama'];

/** Does this provider + model pair have a real reasoning knob? */
function modelCanReason(provider: AiProvider, model: string): boolean {
  if (ALWAYS_TOGGLEABLE.includes(provider)) return true;
  // vLLM-backed catalogues gate on the chat template, not the vendor.
  if (provider === 'nvidia' || provider === 'together') {
    return isHybridThinker(model);
  }
  const pattern = REASONING_MODELS[provider];
  return pattern ? pattern.test(lower(model)) : false;
}

/**
 * What the reasoning switch should look like for a given model.
 *
 * Consumed by the agent settings forms (tenant + super-admin console)
 * so the control is rendered only where flipping it changes something.
 */
export interface ReasoningSupport {
  /** Render the switch at all. False = no knob exists on this model. */
  supported: boolean;
  /** How completely we can honour 'on'. */
  onControl: ReasoningControl;
  /** How completely we can honour 'off' — `reduced` means the model
   *  keeps thinking a little no matter what we send. */
  offControl: ReasoningControl;
  /** Operator-facing caveat, or null when the switch is exact. */
  note: string | null;
}

/**
 * Resolve the reasoning capability of a provider + model pair.
 *
 * Never throws and never needs a network call — it is safe to run in a
 * client component on every keystroke of the model field.
 */
export function reasoningSupport(
  provider: AiProvider,
  model: string
): ReasoningSupport {
  const trimmed = model.trim();
  if (!trimmed || !modelCanReason(provider, trimmed)) {
    return {
      supported: false,
      onControl: 'none',
      offControl: 'none',
      note: null,
    };
  }

  const onControl = reasoningOn(provider, trimmed).control;
  const offControl = reasoningPlanFor(provider, trimmed, 'off').control;

  if (onControl === 'none') {
    return { supported: false, onControl, offControl, note: null };
  }

  let note: string | null = null;
  if (offControl === 'reduced') {
    note =
      'This model always reasons to some degree — turning the switch off clamps it to its lowest setting rather than disabling it.';
  } else if (offControl === 'none') {
    note =
      'This model has no off switch on the provider side; replies are still scrubbed of any visible reasoning before they are sent.';
  } else if (provider === 'ollama') {
    note =
      'Applies only if the model you pulled locally supports thinking — Ollama ignores the setting otherwise.';
  }

  return { supported: true, onControl, offControl, note };
}
