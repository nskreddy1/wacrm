import { describe, expect, it } from 'vitest';
import { outputTokensFor, reasoningPlanFor } from './reasoning-controls';
import { MAX_OUTPUT_TOKENS } from './defaults';

// The request-side half of reasoning handling. The invariant worth
// pinning down is not any single provider's spelling — those move —
// but the CONTRACT the adapters rely on: 'auto' sends nothing, 'off'
// never asks for a bigger budget, and 'on' always does.

describe("reasoningPlanFor — mode 'auto'", () => {
  it('sends no flags for any provider', () => {
    for (const provider of ['openai', 'anthropic', 'gemini', 'groq'] as const) {
      const plan = reasoningPlanFor(provider, 'whatever-model', 'auto');
      expect(plan.params).toEqual({});
      expect(plan.control).toBe('none');
      expect(plan.minOutputTokens).toBeUndefined();
    }
  });
});

describe("reasoningPlanFor — mode 'off'", () => {
  it('disables reasoning outright on gpt-5.1', () => {
    const plan = reasoningPlanFor('openai', 'gpt-5.1', 'off');
    expect(plan.params).toEqual({ reasoning_effort: 'none' });
    expect(plan.control).toBe('full');
  });

  it('clamps to the model floor rather than claiming full control', () => {
    expect(reasoningPlanFor('openai', 'gpt-5', 'off')).toMatchObject({
      params: { reasoning_effort: 'minimal' },
      control: 'reduced',
    });
    expect(reasoningPlanFor('openai', 'o3-mini', 'off')).toMatchObject({
      params: { reasoning_effort: 'low' },
      control: 'reduced',
    });
  });

  it('sends nothing to non-reasoning OpenAI models (the field 400s)', () => {
    expect(reasoningPlanFor('openai', 'gpt-4o', 'off').params).toEqual({});
    expect(reasoningPlanFor('openai', 'gpt-4.1-mini', 'off').params).toEqual({});
  });

  it('says disabled out loud on Anthropic (4.6 thinks adaptively)', () => {
    expect(reasoningPlanFor('anthropic', 'claude-sonnet-4-6', 'off')).toMatchObject(
      { params: { thinking: { type: 'disabled' } }, control: 'full' }
    );
  });

  it('always hides the scratchpad on Groq reasoning models', () => {
    const qwen = reasoningPlanFor('groq', 'qwen3-32b', 'off');
    expect(qwen.params).toEqual({
      reasoning_format: 'hidden',
      reasoning_effort: 'none',
    });
    const distill = reasoningPlanFor('groq', 'deepseek-r1-distill-llama-70b', 'off');
    expect(distill.params).toEqual({ reasoning_format: 'hidden' });
    expect(distill.control).toBe('reduced');
    // A plain non-reasoning Llama gets the plain request.
    expect(reasoningPlanFor('groq', 'llama-3.3-70b-versatile', 'off').params).toEqual(
      {}
    );
  });

  it('excludes as well as disables on OpenRouter', () => {
    expect(reasoningPlanFor('openrouter', 'anything/at-all', 'off').params).toEqual({
      reasoning: { enabled: false, exclude: true },
    });
  });

  it('only sends enable_thinking to hybrid vLLM models', () => {
    expect(reasoningPlanFor('nvidia', 'qwen/qwen3-235b', 'off').params).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
    expect(
      reasoningPlanFor('together', 'meta-llama/Llama-3.3-70B-Instruct-Turbo', 'off')
        .params
    ).toEqual({});
  });

  it('leaves deepseek-chat alone and disables deepseek-reasoner', () => {
    expect(reasoningPlanFor('deepseek', 'deepseek-chat', 'off').params).toEqual({});
    expect(reasoningPlanFor('deepseek', 'deepseek-reasoner', 'off').params).toEqual({
      thinking: { type: 'disabled' },
    });
  });

  it('never asks for a larger output budget', () => {
    const providers = [
      'openai',
      'anthropic',
      'gemini',
      'groq',
      'openrouter',
      'nvidia',
      'together',
      'mistral',
      'deepseek',
      'xai',
      'ollama',
      'custom',
    ] as const;
    for (const provider of providers) {
      const plan = reasoningPlanFor(provider, 'gpt-5.1', 'off');
      expect(plan.minOutputTokens).toBeUndefined();
      expect(outputTokensFor(plan)).toBe(MAX_OUTPUT_TOKENS);
    }
  });

  it('reports full control for Gemini even though the knob lives elsewhere', () => {
    // gemini.ts applies thinkingConfig under generationConfig, so there
    // is nothing to merge at the top level — but it IS controllable.
    const plan = reasoningPlanFor('gemini', 'gemini-2.5-flash', 'off');
    expect(plan.params).toEqual({});
    expect(plan.control).toBe('full');
  });
});

describe("reasoningPlanFor — mode 'on'", () => {
  it('raises the output budget wherever thinking is actually enabled', () => {
    const cases = [
      ['openai', 'gpt-5.1'],
      ['anthropic', 'claude-sonnet-4-6'],
      ['groq', 'qwen3-32b'],
      ['openrouter', 'anything/at-all'],
      ['nvidia', 'qwen/qwen3-235b'],
      ['deepseek', 'deepseek-reasoner'],
      ['xai', 'grok-4-fast'],
      ['ollama', 'qwen3'],
      ['gemini', 'gemini-2.5-flash'],
    ] as const;
    for (const [provider, model] of cases) {
      const plan = reasoningPlanFor(provider, model, 'on');
      expect(plan.control).toBe('full');
      expect(outputTokensFor(plan)).toBeGreaterThan(MAX_OUTPUT_TOKENS);
    }
  });

  it('keeps the scratchpad hidden where the provider can do it', () => {
    expect(reasoningPlanFor('groq', 'qwen3-32b', 'on').params).toMatchObject({
      reasoning_format: 'hidden',
    });
    expect(reasoningPlanFor('openrouter', 'x/y', 'on').params).toEqual({
      reasoning: { enabled: true, exclude: true },
    });
  });

  it("satisfies Anthropic's budget_tokens >= 1024 and max_tokens > budget", () => {
    const plan = reasoningPlanFor('anthropic', 'claude-sonnet-4-6', 'on');
    const budget = (
      plan.params.thinking as { budget_tokens?: number } | undefined
    )?.budget_tokens;
    expect(budget).toBeGreaterThanOrEqual(1024);
    expect(outputTokensFor(plan)).toBeGreaterThan(budget as number);
  });

  it('declines to enable thinking on models that cannot do it', () => {
    // Asking a non-reasoning model to think is a 400, not a feature.
    for (const [provider, model] of [
      ['openai', 'gpt-4o'],
      ['deepseek', 'deepseek-chat'],
      ['xai', 'grok-4'],
      ['together', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
      ['mistral', 'mistral-large-latest'],
      ['custom', 'my-model'],
    ] as const) {
      const plan = reasoningPlanFor(provider, model, 'on');
      expect(plan.params).toEqual({});
      expect(plan.control).toBe('none');
      expect(outputTokensFor(plan)).toBe(MAX_OUTPUT_TOKENS);
    }
  });
});
