'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  AGENT_KIND_META,
  PROVIDER_PRESETS,
  providerLabel,
  type AgentKind,
  type ClientAgent,
} from '../lib/agent-meta';

// ============================================================
// Guided 3-step agent creation: 1) provider + key + model,
// 2) personality + behavior, 3) review & create. The API validates
// the key live against the provider before anything is stored, so a
// typo'd key fails HERE — not at 2am in a customer chat.
// ============================================================

const STEPS = ['Provider', 'Personality', 'Review'] as const;

interface AgentSetupWizardProps {
  kind: AgentKind;
  onCreated: (agent: ClientAgent) => void;
  onCancel?: () => void;
}

export function AgentSetupWizard({
  kind,
  onCreated,
  onCancel,
}: AgentSetupWizardProps) {
  const meta = AGENT_KIND_META[kind];
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 1 — provider.
  const [provider, setProvider] = useState<string>('openai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(
    PROVIDER_PRESETS.find((p) => p.id === 'openai')?.defaultModel ?? ''
  );
  const [baseUrl, setBaseUrl] = useState('');

  // Step 2 — personality + behavior.
  const [prompt, setPrompt] = useState(meta.starterPrompt);
  const [replyCap, setReplyCap] = useState(3);
  const [enableNow, setEnableNow] = useState(true);

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

  const create = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/ai/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          display_name: meta.name,
          provider,
          model: model.trim(),
          api_key: apiKey.trim() || undefined,
          base_url: baseUrl.trim() || undefined,
          system_prompt: prompt.trim() || undefined,
          is_enabled: enableNow,
          settings: kind === 'autoreply' ? { replyCap } : {},
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload.error ?? 'Could not create the agent');
      }
      toast.success(`${meta.name} is ready`);
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
        <meta.icon className="text-primary size-5" aria-hidden />
        <h2 className="text-foreground font-serif text-xl">
          Set up {meta.name}
        </h2>
      </div>
      <p className="text-muted-foreground mb-6 text-sm">{meta.tagline}</p>

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
              className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm font-mono"
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
            <label
              htmlFor="wiz-prompt"
              className="text-foreground mb-1 block text-sm font-medium"
            >
              How should this agent behave?
            </label>
            <textarea
              id="wiz-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm leading-relaxed"
            />
            <p className="text-muted-foreground mt-1 text-xs">
              Describe your business, tone, and rules in plain language. We
              filled in a starting point — edit anything.
            </p>
          </div>

          {kind === 'autoreply' ? (
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

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enableNow}
              onChange={(e) => setEnableNow(e.target.checked)}
              className="accent-primary size-4"
            />
            <span className="text-foreground">
              Turn the agent on right after it&apos;s created
            </span>
          </label>
        </div>
      ) : null}

      {step === 2 ? (
        <dl className="border-border divide-border divide-y rounded-md border text-sm">
          {[
            ['Agent', meta.name],
            ['Provider', providerLabel(provider)],
            ['Model', model],
            ...(baseUrl ? [['Base URL', baseUrl] as [string, string]] : []),
            ...(kind === 'autoreply'
              ? [['Reply cap', `${replyCap} / conversation`] as [string, string]]
              : []),
            ['Starts', enableNow ? 'Enabled immediately' : 'Off until you enable it'],
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
