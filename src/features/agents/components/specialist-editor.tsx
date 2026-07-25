'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { ChevronDown, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import type { AccountMember } from '@/types';
import { cn } from '@/lib/utils';
import { PROVIDER_PRESETS, type ClientAgent } from '../lib/agent-meta';

// ------------------------------------------------------------------
// Custom agent editor — create + edit form for additional agents in
// the multi-agent (supervisor router) architecture. Each agent is a
// full agent: persona + routing rules, and OPTIONALLY its own model
// connection, its own on-duty schedule, its own reply cap, and its
// own escalation target. Anything left unset is inherited from the
// default agent, so a persona-only agent stays fully governed by the
// account's baseline guardrails. Admin-only (canManage).
//
// Routing cascade this form feeds (see assistant/lib/ai/router.ts):
//   1. trigger keywords (instant, free)
//   2. on-duty schedule filter
//   3. LLM match against the routing description
//   4. fallback → default agent
// ------------------------------------------------------------------

interface SpecialistEditorProps {
  /** null → create mode; otherwise edit mode for this agent. */
  specialist: ClientAgent | null;
  canManage: boolean;
  onSaved: () => Promise<unknown> | void;
  onDeleted?: () => Promise<unknown> | void;
  onCancel?: () => void;
}

export function SpecialistEditor({
  specialist,
  canManage,
  onSaved,
  onDeleted,
  onCancel,
}: SpecialistEditorProps) {
  const isCreate = specialist === null;
  const settings = (specialist?.settings ?? {}) as Record<string, unknown>;

  // ---- identity + routing ----------------------------------------
  const [name, setName] = useState(specialist?.displayName ?? '');
  const [route, setRoute] = useState(specialist?.routeDescription ?? '');
  const [keywords, setKeywords] = useState(
    Array.isArray(settings.triggerKeywords)
      ? (settings.triggerKeywords as string[]).join(', ')
      : ''
  );
  const [prompt, setPrompt] = useState(specialist?.systemPrompt ?? '');
  const [enabled, setEnabled] = useState(specialist?.isEnabled ?? true);

  // ---- optional own model connection ------------------------------
  const [ownModel, setOwnModel] = useState(Boolean(specialist?.provider));
  const [provider, setProvider] = useState(specialist?.provider ?? 'openai');
  const [model, setModel] = useState(specialist?.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(specialist?.baseUrl ?? '');
  const preset = PROVIDER_PRESETS.find((p) => p.id === provider);

  // ---- optional own guardrails ------------------------------------
  const capSet = Number.isFinite(Number(settings.replyCap));
  const [ownCap, setOwnCap] = useState(capSet);
  const [replyCap, setReplyCap] = useState(
    capSet && Number(settings.replyCap) >= 1 ? Number(settings.replyCap) : 3
  );
  const scheduleSet =
    typeof settings.scheduleStart === 'string' &&
    typeof settings.scheduleEnd === 'string';
  const [ownSchedule, setOwnSchedule] = useState(scheduleSet);
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
  const [deleting, setDeleting] = useState(false);

  // Escalation picker members (admins only reach this form).
  const { data: membersData } = useSWR<AccountMember[]>(
    canManage ? 'account-members' : null,
    fetchAccountMembers
  );
  const members = membersData ?? [];

  const valid =
    name.trim().length > 0 &&
    route.trim().length > 0 &&
    (!ownModel || model.trim().length > 0);

  const pickProvider = (id: string) => {
    setProvider(id);
    const next = PROVIDER_PRESETS.find((p) => p.id === id);
    if (
      next &&
      (!model || PROVIDER_PRESETS.some((p) => p.defaultModel === model))
    ) {
      setModel(next.defaultModel);
    }
  };

  async function save() {
    if (!canManage || !valid) return;
    setSaving(true);
    try {
      const url = isCreate
        ? '/api/ai/agents'
        : `/api/ai/agents/${specialist.id}`;

      const settingsBody: Record<string, unknown> = {
        triggerKeywords: keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
        // "Set" = overrides the default agent; null = inherit.
        replyCap: ownCap ? replyCap : null,
        scheduleStart: ownSchedule ? scheduleStart || null : null,
        scheduleEnd: ownSchedule ? scheduleEnd || null : null,
        timezone: ownSchedule && scheduleStart ? timezone : null,
        handoffAgentId: handoff || null,
      };

      const body: Record<string, unknown> = {
        display_name: name.trim(),
        route_description: route.trim(),
        system_prompt: prompt.trim() || null,
        is_enabled: enabled,
        settings: settingsBody,
      };
      if (isCreate) body.kind = 'custom';

      if (ownModel) {
        body.provider = provider;
        body.model = model.trim();
        if (apiKey.trim()) body.api_key = apiKey.trim();
        if (preset?.needsBaseUrl || provider === 'ollama') {
          body.base_url = baseUrl.trim() || undefined;
        }
      } else if (!isCreate && specialist.provider) {
        // Was on its own model, switched back to inherit.
        body.provider = null;
        body.model = null;
      }

      const res = await fetch(url, {
        method: isCreate ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? 'Failed to save agent');
      toast.success(isCreate ? 'Agent created' : 'Agent updated');
      setApiKey('');
      await onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!canManage || isCreate) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/ai/agents/${specialist.id}`, {
        method: 'DELETE',
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? 'Failed to delete agent');
      toast.success('Agent deleted');
      await onDeleted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h3 className="text-foreground text-sm font-semibold">
          {isCreate ? 'New agent' : `Edit ${specialist.displayName}`}
        </h3>
        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
          Your default agent routes each incoming conversation to the best
          matching agent — by trigger keywords first, then by topic. Anything
          you don&apos;t configure here (model, schedule, reply cap,
          escalation) is inherited from the default agent.
        </p>
      </div>

      {/* ---- Identity + routing -------------------------------- */}
      <section className="border-border bg-card flex flex-col gap-4 rounded-xl border p-5">
        <div>
          <label
            htmlFor="sp-name"
            className="text-foreground mb-1 block text-sm font-medium"
          >
            Name
          </label>
          <input
            id="sp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canManage}
            placeholder="Billing Agent"
            className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label
            htmlFor="sp-route"
            className="text-foreground mb-1 block text-sm font-medium"
          >
            When should this agent take over?
          </label>
          <textarea
            id="sp-route"
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            disabled={!canManage}
            rows={2}
            maxLength={500}
            placeholder="Billing questions, refunds, invoices, payment issues"
            className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm leading-relaxed"
          />
          <p className="text-muted-foreground mt-1 text-xs">
            The router matches incoming conversations against this
            description. Be specific — list the topics, not a personality.
          </p>
        </div>

        <div>
          <label
            htmlFor="sp-keywords"
            className="text-foreground mb-1 block text-sm font-medium"
          >
            Trigger keywords (optional)
          </label>
          <input
            id="sp-keywords"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            disabled={!canManage}
            placeholder="refund, invoice, payment failed"
            className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm"
          />
          <p className="text-muted-foreground mt-1 text-xs">
            Comma-separated. If a customer&apos;s message contains one of
            these, this agent takes over instantly — no AI routing call
            needed. Up to 20 keywords.
          </p>
        </div>

        <div>
          <label
            htmlFor="sp-prompt"
            className="text-foreground mb-1 block text-sm font-medium"
          >
            Instructions (optional)
          </label>
          <textarea
            id="sp-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={!canManage}
            rows={5}
            placeholder="You handle billing for our business. You can explain invoices and our refund policy. Never promise a refund — offer to escalate instead."
            className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm leading-relaxed"
          />
          <p className="text-muted-foreground mt-1 text-xs">
            Replaces the default agent&apos;s persona when this agent
            answers. Leave empty to keep the default persona.
          </p>
        </div>
      </section>

      {/* ---- Own model connection (optional) --------------------- */}
      <section className="border-border bg-card rounded-xl border p-5">
        <button
          type="button"
          onClick={() => canManage && setOwnModel((v) => !v)}
          aria-expanded={ownModel}
          className="flex w-full items-center justify-between text-left"
        >
          <span>
            <span className="text-foreground block text-sm font-semibold">
              Use its own AI model
            </span>
            <span className="text-muted-foreground mt-0.5 block text-xs">
              {ownModel
                ? 'This agent has its own provider connection.'
                : 'Off — inherits the default agent\u2019s provider, key, and model.'}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'text-muted-foreground size-4 shrink-0 transition-transform',
              ownModel && 'rotate-180'
            )}
            aria-hidden
          />
        </button>

        {ownModel && (
          <div className="mt-4 flex flex-col gap-4">
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
                    aria-pressed={provider === p.id}
                    className={
                      provider === p.id
                        ? 'border-primary bg-primary/5 text-foreground rounded-md border px-3 py-1.5 text-sm font-medium'
                        : 'border-border text-muted-foreground hover:border-primary/40 rounded-md border px-3 py-1.5 text-sm'
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="sp-model"
                  className="text-foreground mb-1 block text-sm font-medium"
                >
                  Model
                </label>
                <input
                  id="sp-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 font-mono text-sm"
                />
              </div>
              {!preset?.keyOptional && (
                <div>
                  <label
                    htmlFor="sp-key"
                    className="text-foreground mb-1 block text-sm font-medium"
                  >
                    API Key
                  </label>
                  <input
                    id="sp-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={
                      specialist?.hasApiKey
                        ? '•••••••• saved — enter to replace'
                        : 'Paste your provider API key'
                    }
                    autoComplete="off"
                    className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm"
                  />
                </div>
              )}
            </div>

            {(preset?.needsBaseUrl || provider === 'ollama') && (
              <div>
                <label
                  htmlFor="sp-base"
                  className="text-foreground mb-1 block text-sm font-medium"
                >
                  Base URL {provider === 'ollama' ? '(optional)' : ''}
                </label>
                <input
                  id="sp-base"
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
            )}
          </div>
        )}
      </section>

      {/* ---- Own guardrails (optional) --------------------------- */}
      <section className="border-border bg-card flex flex-col gap-4 rounded-xl border p-5">
        <div>
          <h4 className="text-foreground text-sm font-semibold">
            Guardrails
          </h4>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Overrides for when THIS agent answers. Off = inherit the default
            agent&apos;s setting.
          </p>
        </div>

        <div className="border-border flex items-center justify-between rounded-lg border px-4 py-3">
          <div>
            <p className="text-foreground text-sm font-medium">
              Own reply cap
            </p>
            <p className="text-muted-foreground text-xs">
              Max auto-replies per conversation for this agent.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {ownCap && (
              <input
                type="number"
                min={1}
                max={20}
                value={replyCap}
                onChange={(e) => setReplyCap(Number(e.target.value) || 3)}
                aria-label="Max replies per conversation"
                className="border-border bg-background text-foreground w-20 rounded-md border px-3 py-1.5 text-sm"
              />
            )}
            <Switch
              checked={ownCap}
              disabled={!canManage}
              onCheckedChange={setOwnCap}
              aria-label="Toggle own reply cap"
            />
          </div>
        </div>

        <div className="border-border rounded-lg border px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm font-medium">
                Own active hours
              </p>
              <p className="text-muted-foreground text-xs">
                This agent is only routable inside its window — e.g. a
                night-shift agent.
              </p>
            </div>
            <Switch
              checked={ownSchedule}
              disabled={!canManage}
              onCheckedChange={setOwnSchedule}
              aria-label="Toggle own active hours"
            />
          </div>
          {ownSchedule && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="sp-start" className="sr-only">
                Start time
              </label>
              <input
                id="sp-start"
                type="time"
                value={scheduleStart}
                onChange={(e) => setScheduleStart(e.target.value)}
                className="border-border bg-background text-foreground rounded-md border px-3 py-2 text-sm"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <label htmlFor="sp-end" className="sr-only">
                End time
              </label>
              <input
                id="sp-end"
                type="time"
                value={scheduleEnd}
                onChange={(e) => setScheduleEnd(e.target.value)}
                className="border-border bg-background text-foreground rounded-md border px-3 py-2 text-sm"
              />
              <label htmlFor="sp-tz" className="sr-only">
                Timezone
              </label>
              <input
                id="sp-tz"
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Asia/Calcutta"
                className="border-border bg-background text-foreground w-40 rounded-md border px-3 py-2 text-sm"
              />
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="sp-handoff"
            className="text-foreground mb-1 block text-sm font-medium"
          >
            Escalation handoff
          </label>
          <select
            id="sp-handoff"
            value={handoff}
            onChange={(e) => setHandoff(e.target.value)}
            disabled={!canManage}
            className="border-border bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="">Inherit from default agent</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {memberLabel(m)}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground mt-1 text-xs">
            Who gets the conversation when this agent escalates to a human.
          </p>
        </div>
      </section>

      <div className="border-border flex items-center justify-between rounded-lg border px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">Enabled</p>
          <p className="text-muted-foreground text-xs">
            Only enabled agents are considered by the router.
          </p>
        </div>
        <Switch
          checked={enabled}
          disabled={!canManage}
          onCheckedChange={setEnabled}
          aria-label="Toggle agent"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={!canManage || saving || !valid}>
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Saving…
            </>
          ) : isCreate ? (
            'Create agent'
          ) : (
            'Save changes'
          )}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        {!isCreate && canManage && (
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive ml-auto"
                  disabled={deleting}
                >
                  <Trash2 className="size-4" aria-hidden />
                  Delete
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete {specialist.displayName}?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Conversations will no longer be routed to this agent. Its
                  usage history is kept. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={remove}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete agent
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </div>
  );
}
