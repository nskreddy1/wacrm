'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Bot, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  CAPABILITY_META,
  CAPABILITY_ORDER,
  DEFAULT_AGENT_NAME,
  PROVIDER_PRESETS,
  STARTER_PROMPT,
  providerLabel,
  type ClientAgent,
} from '../lib/agent-meta';
import { emptyPersonaDraft, PersonaBuilder } from './persona-builder';

// ============================================================
// Guided 3-step setup for the account's single AI agent:
// 1) provider + key + model, 2) personality + which capabilities to
// switch on (AI suggestions / Auto-reply — separate columns, both
// powered by this one config), 3) review & create. The API validates
// the key live against the provider before anything is stored, so a
// typo'd key fails HERE — not at 2am in a customer chat.
// ============================================================

const STEPS = ['Provider', 'Personality', 'Review'] as const;

interface AgentSetupWizardProps {
  onCreated: (agent: ClientAgent) => void;
  onCancel?: () => void;
}

export function AgentSetupWizard({ onCreated, onCancel }: AgentSetupWizardProps) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 1 — provider.
  const [provider, setProvider] = useState<string>('openai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(
    PROVIDER_PRESETS.find((p) => p.id === 'openai')?.defaultModel ?? ''
  );
  const [baseUrl, setBaseUrl] = useState('');

  // Step 2 — personality + capabilities. Guided is the default: new
  // clients answer plain questions and WE compose the enterprise
  // prompt server-side; the expert textarea stays one click away.
  const [personaMode, setPersonaMode] = useState<'guided' | 'expert'>(
    'guided'
  );
  const [personaDraft, setPersonaDraft] = useState(emptyPersonaDraft());
  const [prompt, setPrompt] = useState(STARTER_PROMPT);
  const [replyCap, setReplyCap] = useState(3);
  const [suggestionsOn, setSuggestionsOn] = useState(true);
  const [autoreplyOn, setAutoreplyOn] = useState(true);

  const preset = PROVIDER_PRESETS.find((p) => p.id === provider);

  const pickProvider = (id: string) => {
    setProvider(id);
    const next = PROVIDER_PRESETS.find((p) => p.id === id);
    // Swap in the new provider's default model unless the user typed
    // their own.
    if (next && (!model || PROVIDER_PRESETS.some((p) => p.defaultModel === model))) {
      setModel(next.defaultModel);
    }
  };

  const step1Valid =
    Boolean(provider) &&
    Boolean(model.trim()) &&
    (preset?.keyOptional || apiKey.trim().length > 0) &&
    (!preset?.needsBaseUrl || baseUrl.trim().length > 0);

  // Guided answers only count once the one required field is filled;
  // otherwise fall back to the expert prompt so create never sends an
  // empty persona.
  const useGuided =
    personaMode === 'guided' && personaDraft.businessName.trim().length > 0;

  const create = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/ai/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: DEFAULT_AGENT_NAME,
          provider,
          model: model.trim(),
          api_key: apiKey.trim() || undefined,
          base_url: baseUrl.trim() || undefined,
          // Guided mode: send the client's plain answers — the server
          // composes the enterprise-grade prompt. Expert mode: raw text.
          ...(useGuided
            ? {
                persona_config: {
                  ...personaDraft,
                  keyFacts: (personaDraft.keyFacts ?? []).filter((f) =>
                    f.trim()
                  ),
                  neverDo: (personaDraft.neverDo ?? []).filter((f) =>
                    f.trim()
                  ),
                },
              }
            : { system_prompt: prompt.trim() || undefined }),
          is_enabled: suggestionsOn || autoreplyOn,
          suggestions_enabled: suggestionsOn,
          autoreply_enabled: autoreplyOn,
          settings: { replyCap },
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error ?? 'Could not create the agent');
      }
      toast.success('Your AI agent is ready');
      onCreated(payload.agent as ClientAgent);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create agent');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-border bg-card rounded-xl border p-6">
      <div className="mb-1 flex items-center gap-2">
        <Bot className="text-primary size-5" aria-hidden />
        <h2 className="text-foreground font-serif text-xl">
          Set up your AI agent
        </h2>
      </div>
      <p className="text-muted-foreground mb-6 text-sm">
        One agent, two jobs — it can draft replies for your team and answer
        customers automatically. You pick which below.
      </p>

      {/* Stepper */}
      <ol className="mb-6 flex items-center gap-2" aria-label="Setup steps">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full text-xs font-medium',
                i < step
                  ? 'bg-primary text-primary-foreground'
                  : i === step
                    ? 'border-primary text-primary border-2'
                    : 'border-border text-muted-foreground border'
              )}
            >
              {i < step ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span
              className={cn(
                'text-sm',
                i === step ? 'text-foreground font-medium' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 ? (
              <span className="bg-border h-px w-6" aria-hidden />
            ) : null}
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="flex flex-col gap-4">
          <fieldset>
            <legend className="text-foreground mb-2 text-sm font-medium">
              AI Provider
            </legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {PROVIDER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickProvider(p.id)}
                  className={cn(
                    'rounded-md border px-3 py-2 text-left text-sm transition-colors',
                    provider === p.id
                      ? 'border-primary bg-primary/5 text-foreground font-medium'
                      : 'border-border text-muted-foreground hover:border-primary/40'
                  )}
                  aria-pressed={provider === p.id}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {preset ? (
              <p className="text-muted-foreground mt-2 text-xs">{preset.hint}</p>
            ) : null}
          </fieldset>

          {!preset?.keyOptional ? (
            <div>
              <label
                htmlFor="wiz-key"
                className="text-foreground mb-1 block text-sm font-medium"
              >
                API Key
              </label>
              <input
                id="wiz-key"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your provider API key"
                autoComplete="off"
                className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm"
              />
              <p className="text-muted-foreground mt-1 text-xs">
                Checked live with {providerLabel(provider)} before saving,
                then stored encrypted.
              </p>
            </div>
          ) : null}

          {preset?.needsBaseUrl || provider === 'ollama' ? (
            <div>
              <label
                htmlFor="wiz-base"
                className="text-foreground mb-1 block text-sm font-medium"
              >
                Base URL {provider === 'ollama' ? '(optional)' : ''}
              </label>
              <input
                id="wiz-base"
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

          <div>
            <label
              htmlFor="wiz-model"
              className="text-foreground mb-1 block text-sm font-medium"
            >
              Model
            </label>
            <input
              id="wiz-model"
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 font-mono text-sm"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              We picked a sensible default — change it if you prefer another
              model.
            </p>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-foreground text-sm font-medium">
                How should your agent behave?
              </span>
              <div
                className="border-border flex rounded-md border p-0.5"
                role="tablist"
                aria-label="Persona editing mode"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={personaMode === 'guided'}
                  onClick={() => setPersonaMode('guided')}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs',
                    personaMode === 'guided'
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'text-muted-foreground'
                  )}
                >
                  Guided
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={personaMode === 'expert'}
                  onClick={() => setPersonaMode('expert')}
                  className={cn(
                    'rounded px-2.5 py-1 text-xs',
                    personaMode === 'expert'
                      ? 'bg-primary text-primary-foreground font-medium'
                      : 'text-muted-foreground'
                  )}
                >
                  Expert
                </button>
              </div>
            </div>
            {personaMode === 'guided' ? (
              <>
                <p className="text-muted-foreground mb-3 text-xs">
                  Answer a few plain questions — no AI knowledge needed. We
                  turn them into enterprise-grade instructions for you.
                </p>
                <PersonaBuilder
                  value={personaDraft}
                  onChange={setPersonaDraft}
                />
              </>
            ) : (
              <>
                <textarea
                  id="wiz-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={6}
                  aria-label="Agent instructions"
                  className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm leading-relaxed"
                />
                <p className="text-muted-foreground mt-1 text-xs">
                  Describe your business, tone, and rules in plain language.
                  We filled in a starting point — edit anything.
                </p>
              </>
            )}
          </div>

          <fieldset>
            <legend className="text-foreground mb-2 text-sm font-medium">
              What should it do?
            </legend>
            <div className="flex flex-col gap-2">
              {CAPABILITY_ORDER.map((cap) => {
                const m = CAPABILITY_META[cap];
                const checked = cap === 'suggestions' ? suggestionsOn : autoreplyOn;
                const setChecked =
                  cap === 'suggestions' ? setSuggestionsOn : setAutoreplyOn;
                return (
                  <label
                    key={cap}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors',
                      checked
                        ? 'border-primary/40 bg-primary/5'
                        : 'border-border hover:border-primary/30'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setChecked(e.target.checked)}
                      className="accent-primary mt-0.5 size-4"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="text-foreground text-sm font-medium">
                        {m.name}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {m.tagline}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Both are separate switches you can flip anytime — they share
              this one provider connection.
            </p>
          </fieldset>

          {autoreplyOn ? (
            <div>
              <label
                htmlFor="wiz-cap"
                className="text-foreground mb-1 block text-sm font-medium"
              >
                Max automatic replies per conversation
              </label>
              <input
                id="wiz-cap"
                type="number"
                min={1}
                max={20}
                value={replyCap}
                onChange={(e) => setReplyCap(Number(e.target.value) || 3)}
                className="border-border bg-background text-foreground w-24 rounded-md border px-3 py-2 text-sm"
              />
              <p className="text-muted-foreground mt-1 text-xs">
                After this many replies the conversation waits for your team —
                the bot never spams customers.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <dl className="border-border divide-border divide-y rounded-md border text-sm">
          {[
            ['Provider', providerLabel(provider)],
            ['Model', model],
            ...(baseUrl ? [['Base URL', baseUrl] as [string, string]] : []),
            [
              'AI suggestions',
              suggestionsOn ? 'On — drafts for your team' : 'Off',
            ],
            [
              'Auto-reply',
              autoreplyOn ? `On — max ${replyCap} replies / conversation` : 'Off',
            ],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-4 py-2.5">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-foreground max-w-[60%] truncate font-medium">
                {v}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mt-6 flex items-center justify-between">
        <div>
          {step > 0 ? (
            <Button
              variant="ghost"
              onClick={() => setStep((s) => s - 1)}
              disabled={saving}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </Button>
          ) : onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
        {step < 2 ? (
          <Button
            onClick={() => setStep((s) => s + 1)}
            disabled={step === 0 && !step1Valid}
          >
            Continue
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        ) : (
          <Button onClick={create} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Verifying key…
              </>
            ) : (
              'Create agent'
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
