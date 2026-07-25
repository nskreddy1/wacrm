'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import type { AccountMember } from '@/types';
import {
  PROVIDER_PRESETS,
  STARTER_PROMPT,
  type ClientAgent,
} from '../lib/agent-meta';

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
  const [replyCap, setReplyCap] = useState(
    Number(settings.replyCap) >= 1 ? Number(settings.replyCap) : 3
  );
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
  const [saving, setSaving] = useState(false);

  const preset = PROVIDER_PRESETS.find((p) => p.id === provider);

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
        system_prompt: prompt,
      };
      // Key: only sent when replaced — the stored one is never echoed.
      if (apiKey.trim()) body.api_key = apiKey.trim();
      if (preset?.needsBaseUrl || provider === 'ollama') {
        body.base_url = baseUrl.trim() || undefined;
      }
      body.settings = {
        replyCap,
        scheduleStart: scheduleStart || null,
        scheduleEnd: scheduleEnd || null,
        timezone: scheduleStart ? timezone : null,
        handoffAgentId: handoff || null,
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="cfg-model"
                className="text-foreground mb-1 block text-sm font-medium"
              >
                Model
              </label>
              <input
                id="cfg-model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 font-mono text-sm"
              />
            </div>
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
        </div>
      </section>

      <section
        aria-labelledby="cfg-persona"
        className="border-border bg-card rounded-xl border p-5"
      >
        <h3 id="cfg-persona" className="text-foreground mb-1 text-sm font-semibold">
          Personality &amp; instructions
        </h3>
        <p className="text-muted-foreground mb-4 text-xs">
          One persona for both jobs — how the agent talks when drafting for
          your team and when replying to customers on its own.
        </p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={6}
          aria-label="Agent instructions"
          placeholder={STARTER_PROMPT}
          className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm leading-relaxed"
        />
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
              <input
                id="cfg-cap"
                type="number"
                min={1}
                max={20}
                value={replyCap}
                onChange={(e) => setReplyCap(Number(e.target.value) || 3)}
                className="border-border bg-background text-foreground w-24 rounded-md border px-3 py-2 text-sm"
              />
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
