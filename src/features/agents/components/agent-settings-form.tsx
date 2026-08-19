'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  isAutoReplyLimitMode,
  isReasoningMode,
  DEFAULT_REASONING_MODE,
  type AiProvider,
  type AutoReplyLimitMode,
  type ReasoningMode,
} from '@/features/assistant/lib/ai/types';
import { reasoningSupport } from '@/features/assistant/lib/ai/reasoning-controls';
import { ModelPicker } from '@/features/assistant/components/model-picker';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import type { AccountMember } from '@/types';
import {
  PROVIDER_PRESETS,
  STARTER_PROMPT,
  type ClientAgent,
} from '../lib/agent-meta';
import { readPersonaConfig } from '@/features/assistant/lib/ai/persona';
import { emptyPersonaDraft, PersonaBuilder } from './persona-builder';

// ============================================================
// Configuration tab for the account's single AI agent — one provider
// connection, one persona, plus guardrails for the auto-reply
// capability (reply cap, active hours, escalation). Saved via
// PATCH /api/ai/agents/[id]; the API key is only sent when replaced.
// ============================================================

interface AgentSettingsFormProps {
  agent: ClientAgent;
  canManage: boolean;
  onSaved: (agent: ClientAgent) => void;
}

export function AgentSettingsForm({
  agent,
  canManage,
  onSaved,
}: AgentSettingsFormProps) {
  const settings = agent.settings as Record<string, unknown>;

  const [provider, setProvider] = useState(agent.provider ?? 'openai');
  const [model, setModel] = useState(agent.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(agent.baseUrl ?? '');
  const [prompt, setPrompt] = useState(agent.systemPrompt ?? '');
  // Guided persona: saved answers re-open the same form. Clients who
  // never saw a prompt in their life stay in guided mode; experts can
  // switch to the raw prompt.
  const savedPersona = readPersonaConfig(settings.personaConfig);
  const [personaMode, setPersonaMode] = useState<'guided' | 'expert'>(
    savedPersona || !agent.systemPrompt ? 'guided' : 'expert'
  );
  const [personaDraft, setPersonaDraft] = useState(
    savedPersona ?? emptyPersonaDraft()
  );
  const [replyCap, setReplyCap] = useState(
    Number(settings.replyCap) >= 1 ? Number(settings.replyCap) : 3
  );
  // 'never' is the engine's existing "no cap" mode — auto-reply.ts only
  // enforces a ceiling for 'per_conversation' and 'per_day'. The setup
  // wizard could already reach it, but this form couldn't, so an account
  // that wanted unlimited replies had no way to switch back to it after
  // onboarding. Exposed here as a plain toggle.
  const savedLimitMode: AutoReplyLimitMode = isAutoReplyLimitMode(
    settings.limitMode
  )
    ? settings.limitMode
    : 'per_conversation';
  const [limitMode, setLimitMode] =
    useState<AutoReplyLimitMode>(savedLimitMode);
  // Which bounded mode to restore when the toggle goes back off. Without
  // this an account counting per_day would silently become
  // per_conversation after one round trip through the switch.
  const [boundedMode] = useState<Exclude<AutoReplyLimitMode, 'never'>>(
    savedLimitMode === 'never' ? 'per_conversation' : savedLimitMode
  );
  const unlimited = limitMode === 'never';
  const [scheduleStart, setScheduleStart] = useState(
    typeof settings.scheduleStart === 'string' ? settings.scheduleStart : ''
  );
  const [scheduleEnd, setScheduleEnd] = useState(
    typeof settings.scheduleEnd === 'string' ? settings.scheduleEnd : ''
  );
  const [timezone, setTimezone] = useState(
    typeof settings.timezone === 'string' ? settings.timezone : 'Asia/Calcutta'
  );
  const [handoff, setHandoff] = useState(
    typeof settings.handoffAgentId === 'string' ? settings.handoffAgentId : ''
  );
  // Thinking budget. Stored per agent and shared by both capabilities,
  // because they share one provider connection. Anything unset or
  // hand-edited reads as 'off' — the pre-toggle behaviour.
  const [reasoning, setReasoning] = useState<ReasoningMode>(
    isReasoningMode(settings.reasoning)
      ? settings.reasoning
      : DEFAULT_REASONING_MODE
  );
  const [saving, setSaving] = useState(false);

  const preset = PROVIDER_PRESETS.find((p) => p.id === provider);

  // Does this provider + model pair actually have a thinking knob? The
  // switch is hidden when it doesn't: `gpt-4o` rejects the reasoning
  // field outright, so rendering the control there promised a change
  // the model can never make. Recomputed on every keystroke — it is a
  // pure table lookup, no network call.
  const reasoningCap = reasoningSupport(provider as AiProvider, model);

  // Team members for the escalation handoff picker.
  const { data: membersData } = useSWR<AccountMember[]>(
    canManage ? 'account-members' : null,
    fetchAccountMembers
  );
  const members = membersData ?? [];

  const pickProvider = (id: string) => {
    setProvider(id);
    const next = PROVIDER_PRESETS.find((p) => p.id === id);
    if (next && (!model || PROVIDER_PRESETS.some((p) => p.defaultModel === model))) {
      setModel(next.defaultModel);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        display_name: agent.displayName,
        provider,
        model: model.trim(),
      };
      // Persona: guided mode sends the answers and the SERVER composes
      // the enterprise prompt; expert mode sends the raw prompt and
      // clears any stored guided answers.
      if (personaMode === 'guided' && personaDraft.businessName.trim()) {
        body.persona_config = {
          ...personaDraft,
          keyFacts: (personaDraft.keyFacts ?? []).filter((f) => f.trim()),
          neverDo: (personaDraft.neverDo ?? []).filter((f) => f.trim()),
        };
      } else {
        body.system_prompt = prompt;
        if (savedPersona) body.persona_config = null;
      }
      // Key: only sent when replaced — the stored one is never echoed.
      if (apiKey.trim()) body.api_key = apiKey.trim();
      if (preset?.needsBaseUrl || provider === 'ollama') {
        body.base_url = baseUrl.trim() || undefined;
      }
      body.settings = {
        replyCap,
        limitMode,
        scheduleStart: scheduleStart || null,
        scheduleEnd: scheduleEnd || null,
        timezone: scheduleStart ? timezone : null,
        handoffAgentId: handoff || null,
        // A model with no knob is stored as 'off' rather than keeping a
        // stale 'on' from a previous model — otherwise switching back
        // to a reasoning model would silently re-enable thinking.
        reasoning: reasoningCap.supported ? reasoning : 'off',
      };

      const res = await fetch(`/api/ai/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? 'Save failed');
      toast.success('Configuration saved');
      setApiKey('');
      onSaved(payload.agent as ClientAgent);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) {
    return (
      <div className="border-border rounded-lg border border-dashed px-4 py-10 text-center">
        <p className="text-muted-foreground text-sm">
          Only admins can change this agent&apos;s configuration.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="cfg-provider"
        className="border-border bg-card rounded-xl border p-5"
      >
        <h3 id="cfg-provider" className="text-foreground mb-1 text-sm font-semibold">
          Model &amp; provider
        </h3>
        <p className="text-muted-foreground mb-4 text-xs">
          One connection powers both capabilities — AI suggestions and
          auto-reply share this provider, key, and model.
        </p>

        <div className="flex flex-col gap-4">
          <fieldset>
            <legend className="text-foreground mb-2 text-sm font-medium">
              AI Provider
            </legend>
            <div className="flex flex-wrap gap-2">
              {PROVIDER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickProvider(p.id)}
                  className={
                    provider === p.id
                      ? 'border-primary bg-primary/5 text-foreground rounded-md border px-3 py-1.5 text-sm font-medium'
                      : 'border-border text-muted-foreground hover:border-primary/40 rounded-md border px-3 py-1.5 text-sm'
                  }
                  aria-pressed={provider === p.id}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </fieldset>

          {/* Key BEFORE model (ADR-005 D1): the model list is only real
              once a key exists, so asking for the model first would offer
              a list the provider never vouched for. */}
          <div className="grid gap-4 sm:grid-cols-2">
            {!preset?.keyOptional ? (
              <div>
                <label
                  htmlFor="cfg-key"
                  className="text-foreground mb-1 block text-sm font-medium"
                >
                  API Key
                </label>
                <input
                  id="cfg-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    agent.hasApiKey
                      ? '•••••••• saved — enter to replace'
                      : 'Paste your provider API key'
                  }
                  autoComplete="off"
                  className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm"
                />
              </div>
            ) : null}
            <div>
              <label
                htmlFor="cfg-model"
                className="text-foreground mb-1 block text-sm font-medium"
              >
                Model
              </label>
              {/* Live list from the provider, still typeable — see
                  ModelPicker: a model released this morning must not be
                  unreachable because our bundle predates it. The
                  in-progress key is handed over so switching provider and
                  pasting a new key lists models BEFORE save (D5). */}
              <ModelPicker
                id="cfg-model"
                provider={provider as AiProvider}
                value={model}
                onChange={setModel}
                baseUrl={baseUrl}
                draftApiKey={apiKey}
              />
            </div>
          </div>

          {preset?.needsBaseUrl || provider === 'ollama' ? (
            <div>
              <label
                htmlFor="cfg-base"
                className="text-foreground mb-1 block text-sm font-medium"
              >
                Base URL {provider === 'ollama' ? '(optional)' : ''}
              </label>
              <input
                id="cfg-base"
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={
                  provider === 'ollama'
                    ? 'http://localhost:11434/v1'
                    : 'https://your-endpoint.example.com/v1'
                }
                className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm"
              />
            </div>
          ) : null}

          {/* One switch, matching every other capability control on this
              page. 'auto' (send no instruction at all) stays reachable
              through the API for support, but an operator only ever needs
              the on/off decision — and an untouched 'auto' config is
              preserved on save because state starts from the stored value.

              Rendered ONLY where the chosen model has a real knob: on
              gpt-4o the reasoning field is a 400, so a switch there
              promised a change the model can never make. */}
          {reasoningCap.supported ? (
            <div className="border-border flex flex-col gap-2 rounded-lg border p-3.5">
              <div className="flex items-center justify-between gap-4">
                <label
                  htmlFor="cfg-reasoning"
                  className="flex flex-col gap-0.5 text-sm leading-tight"
                >
                  <span className="text-foreground font-medium">
                    Think before replying
                  </span>
                  <span className="text-muted-foreground text-xs">
                    The model reasons privately before answering. Better on
                    multi-step questions; slower and costs more tokens.
                  </span>
                </label>
                <Switch
                  id="cfg-reasoning"
                  checked={reasoning === 'on'}
                  onCheckedChange={(next) => setReasoning(next ? 'on' : 'off')}
                  aria-label="Think before replying"
                />
              </div>
              {reasoningCap.note ? (
                <p className="text-muted-foreground border-border border-t pt-2 text-xs leading-relaxed">
                  {reasoningCap.note}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section
        aria-labelledby="cfg-persona"
        className="border-border bg-card rounded-xl border p-5"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3
              id="cfg-persona"
              className="text-foreground mb-1 text-sm font-semibold"
            >
              Personality &amp; instructions
            </h3>
            <p className="text-muted-foreground text-xs">
              {personaMode === 'guided'
                ? 'Answer a few questions — we generate enterprise-grade instructions for you.'
                : 'One persona for both jobs — how the agent talks when drafting for your team and when replying to customers on its own.'}
            </p>
          </div>
          <div className="border-border flex rounded-md border p-0.5" role="tablist" aria-label="Persona editing mode">
            <button
              type="button"
              role="tab"
              aria-selected={personaMode === 'guided'}
              onClick={() => setPersonaMode('guided')}
              className={
                personaMode === 'guided'
                  ? 'bg-primary text-primary-foreground rounded px-2.5 py-1 text-xs font-medium'
                  : 'text-muted-foreground rounded px-2.5 py-1 text-xs'
              }
            >
              Guided
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={personaMode === 'expert'}
              onClick={() => setPersonaMode('expert')}
              className={
                personaMode === 'expert'
                  ? 'bg-primary text-primary-foreground rounded px-2.5 py-1 text-xs font-medium'
                  : 'text-muted-foreground rounded px-2.5 py-1 text-xs'
              }
            >
              Expert
            </button>
          </div>
        </div>

        {personaMode === 'guided' ? (
          <PersonaBuilder value={personaDraft} onChange={setPersonaDraft} />
        ) : (
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            aria-label="Agent instructions"
            placeholder={STARTER_PROMPT}
            className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm leading-relaxed"
          />
        )}
      </section>

      <section
        aria-labelledby="cfg-behavior"
          className="border-border bg-card rounded-xl border p-5"
        >
          <h3
            id="cfg-behavior"
            className="text-foreground mb-1 text-sm font-semibold"
          >
            Automatic reply behavior
          </h3>
          <p className="text-muted-foreground mb-4 text-xs">
            Guardrails for unattended replies — they apply only when the
            auto-reply capability is on.
          </p>

          <div className="flex flex-col gap-4">
            <div>
              <label
                htmlFor="cfg-cap"
                className="text-foreground mb-1 block text-sm font-medium"
              >
                Max replies per conversation
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id="cfg-cap"
                  type="number"
                  min={1}
                  max={20}
                  value={replyCap}
                  disabled={unlimited}
                  onChange={(e) => setReplyCap(Number(e.target.value) || 3)}
                  className="border-border bg-background text-foreground w-24 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                />
                <div className="flex items-center gap-2">
                  <Switch
                    id="cfg-unlimited"
                    checked={unlimited}
                    onCheckedChange={(next) =>
                      setLimitMode(next ? 'never' : boundedMode)
                    }
                  />
                  <label
                    htmlFor="cfg-unlimited"
                    className="text-foreground text-sm"
                  >
                    No limit
                  </label>
                </div>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                {unlimited
                  ? 'The agent replies every time, with no per-conversation ceiling. Active hours and escalation below still apply.'
                  : boundedMode === 'per_day'
                    ? 'Counted per day, resetting at midnight in the timezone below.'
                    : 'After this many replies the conversation waits for your team.'}
              </p>
            </div>

            <div>
              <span className="text-foreground mb-1 block text-sm font-medium">
                Active hours
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="cfg-start" className="sr-only">
                  Start time
                </label>
                <input
                  id="cfg-start"
                  type="time"
                  value={scheduleStart}
                  onChange={(e) => setScheduleStart(e.target.value)}
                  className="border-border bg-background text-foreground rounded-md border px-3 py-2 text-sm"
                />
                <span className="text-muted-foreground text-sm">to</span>
                <label htmlFor="cfg-end" className="sr-only">
                  End time
                </label>
                <input
                  id="cfg-end"
                  type="time"
                  value={scheduleEnd}
                  onChange={(e) => setScheduleEnd(e.target.value)}
                  className="border-border bg-background text-foreground rounded-md border px-3 py-2 text-sm"
                />
                <label htmlFor="cfg-tz" className="sr-only">
                  Timezone
                </label>
                <input
                  id="cfg-tz"
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="Asia/Calcutta"
                  className="border-border bg-background text-foreground w-40 rounded-md border px-3 py-2 text-sm"
                />
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                Leave empty to reply around the clock. Outside these hours,
                conversations wait for your team.
              </p>
            </div>

            <div>
              <label
                htmlFor="cfg-handoff"
                className="text-foreground mb-1 block text-sm font-medium"
              >
                Escalation handoff
              </label>
              <select
                id="cfg-handoff"
                value={handoff}
                onChange={(e) => setHandoff(e.target.value)}
                className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm"
              >
                <option value="">Shared queue (unassigned)</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {memberLabel(m)}
                  </option>
                ))}
              </select>
              <p className="text-muted-foreground mt-1 text-xs">
                When a customer asks for a human or the agent is unsure, the
                conversation is assigned here with an AI-written summary.
              </p>
            </div>
          </div>
      </section>

      <div>
        <Button onClick={save} disabled={saving || !model.trim()}>
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Verifying &amp; saving…
            </>
          ) : (
            'Save configuration'
          )}
        </Button>
      </div>
    </div>
  );
}
