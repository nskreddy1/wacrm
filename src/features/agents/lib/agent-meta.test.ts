// ============================================================
// ADR-005 D8 — the single agent-status definition.
//
// These tests exist because the four hand-rolled copies of this logic
// had already drifted in exactly one way: `provider && model` without
// `hasApiKey`, which labelled an unusable agent "Paused". The
// no-key case below is that regression.
// ============================================================

import { describe, expect, it } from 'vitest';

import type { ClientAgent } from './agent-meta';
import { isAgentConfigured, isAutoReplyLive } from './agent-meta';

function agent(overrides: Partial<ClientAgent> = {}): ClientAgent {
  return {
    id: 'agent-1',
    kind: 'default',
    displayName: 'AI Assistant',
    provider: 'openai',
    model: 'gpt-4o-mini',
    hasApiKey: true,
    baseUrl: null,
    systemPrompt: 'You are helpful.',
    routeDescription: null,
    isEnabled: true,
    suggestionsEnabled: true,
    autoreplyEnabled: true,
    settings: {},
    hasEmbeddingsKey: false,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  };
}

describe('isAgentConfigured', () => {
  it('is false for a missing agent', () => {
    expect(isAgentConfigured(null)).toBe(false);
    expect(isAgentConfigured(undefined)).toBe(false);
  });

  it('is true for provider + model + key', () => {
    expect(isAgentConfigured(agent())).toBe(true);
  });

  it('is FALSE with a provider and model but no key (the drift being fixed)', () => {
    expect(isAgentConfigured(agent({ hasApiKey: false }))).toBe(false);
  });

  it('is true for Ollama without a key — it needs none', () => {
    expect(
      isAgentConfigured(
        agent({ provider: 'ollama', model: 'llama3.1', hasApiKey: false })
      )
    ).toBe(true);
  });

  it('is false without a model, even with a key', () => {
    expect(isAgentConfigured(agent({ model: null }))).toBe(false);
  });

  it('is false without a provider', () => {
    expect(isAgentConfigured(agent({ provider: null }))).toBe(false);
  });

  it('ignores the enable switches — configured is not the same as running', () => {
    expect(
      isAgentConfigured(
        agent({ isEnabled: false, autoreplyEnabled: false })
      )
    ).toBe(true);
  });
});

describe('isAutoReplyLive', () => {
  it('is true only when configured, enabled and auto-reply is on', () => {
    expect(isAutoReplyLive(agent())).toBe(true);
  });

  it('is false when the master switch is off', () => {
    expect(isAutoReplyLive(agent({ isEnabled: false }))).toBe(false);
  });

  it('is false when the auto-reply capability is off', () => {
    expect(isAutoReplyLive(agent({ autoreplyEnabled: false }))).toBe(false);
  });

  it('is false when the agent is not configured, whatever the switches say', () => {
    expect(isAutoReplyLive(agent({ hasApiKey: false }))).toBe(false);
  });

  it('is false for a missing agent', () => {
    expect(isAutoReplyLive(null)).toBe(false);
  });
});
