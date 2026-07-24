'use client';

// ============================================================
// Lumis-style Configuration tab for the AI Agents console.
//
// Replaces the embedded legacy settings form with a 1:1 match of the
// reference design: a "System Prompt" card with an inset panel, and an
// "AI Configuration" card with labeled field groups (model pills,
// dropdowns) and Test / Save buttons at the bottom.
//
// Auto-reply scheduling, handoff and knowledge settings are NOT
// duplicated here — saving preserves them by passing through the
// currently stored values, so this tab only touches what it shows.
// ============================================================

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { Loader2, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { fetchAccountMembers, memberLabel } from '@/lib/account/members';
import type { AccountMember } from '@/types';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// Providers surfaced as pills (the reference shows four). The rest stay
// reachable through the "More" select so nothing is lost.
const PILL_PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'groq', label: 'Groq' },
] as const;

const MORE_PROVIDERS = [
  { value: 'nvidia', label: 'NVIDIA' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'together', label: 'Together' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'xai', label: 'xAI (Grok)' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'custom', label: 'Custom endpoint' },
] as const;

// Sentinel for "route to the shared queue" in the handoff select —
// Radix Select can't represent an empty-string value.
const HANDOFF_QUEUE = '__queue__';

// Location-based timezone list (IANA zones from the runtime). Same
// source Settings uses — the browser's resolved zone is the default so
// the picker "just works" for the user's location, and every global
// zone stays selectable for teams operating elsewhere.
function supportedTimezones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    // Older runtimes: minimal useful fallback.
    return ['UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London'];
  }
}

function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

interface AiConfigData {
  configured: boolean;
  has_key?: boolean;
  has_embeddings_key?: boolean;
  provider?: string;
  model?: string;
  base_url?: string | null;
  system_prompt?: string | null;
  is_active?: boolean;
  auto_reply_enabled?: boolean;
  auto_reply_max_per_conversation?: number;
  auto_reply_limit_mode?: string;
  auto_reply_schedule_start?: string | null;
  auto_reply_schedule_end?: string | null;
  auto_reply_timezone?: string | null;
  handoff_agent_id?: string | null;
}

export function AgentConfiguration() {
  const {
    data: config,
    isLoading,
    mutate,
  } = useSWR<AiConfigData>('/api/ai/config', fetcher);
  // Members populate the handoff-target picker. Best-effort — if the
  // endpoint is unavailable the picker still offers the shared queue.
  const { data: members } = useSWR<AccountMember[]>(
    'account-members',
    () => fetchAccountMembers(),
    { revalidateOnFocus: false }
  );

  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [scheduleStart, setScheduleStart] = useState('');
  const [scheduleEnd, setScheduleEnd] = useState('');
  const [timezone, setTimezone] = useState('');
  // Empty string = route handoffs to the shared queue (round-robin).
  const [handoffAgentId, setHandoffAgentId] = useState('');
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  // Render-time hydration once the config arrives (and re-hydration if
  // a different config object is fetched after save).
  const hydrationKey = config
    ? `${config.provider}|${config.model}|${config.system_prompt ?? ''}|${config.auto_reply_schedule_start ?? ''}|${config.auto_reply_schedule_end ?? ''}|${config.handoff_agent_id ?? ''}`
    : null;
  if (config?.configured && hydrationKey && hydratedFor !== hydrationKey) {
    setHydratedFor(hydrationKey);
    setProvider(config.provider ?? 'openai');
    setModel(config.model ?? '');
    setBaseUrl(config.base_url ?? '');
    setSystemPrompt(config.system_prompt ?? '');
    // Postgres `time` serializes as 'HH:MM:SS'; the inputs use 'HH:MM'.
    setScheduleStart((config.auto_reply_schedule_start ?? '').slice(0, 5));
    setScheduleEnd((config.auto_reply_schedule_end ?? '').slice(0, 5));
    setTimezone(config.auto_reply_timezone ?? '');
    setHandoffAgentId(config.handoff_agent_id ?? '');
    setApiKey('');
  }

  const needsBaseUrl = provider === 'custom' || provider === 'ollama';
  const isPillProvider = PILL_PROVIDERS.some((p) => p.value === provider);

  async function testAgent() {
    if (!model.trim()) {
      toast.error('Enter a model name first');
      return;
    }
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          ...(baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Provider test failed');
      toast.success('Agent responded — configuration works');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Provider test failed');
    } finally {
      setTesting(false);
    }
  }

  async function saveConfiguration() {
    if (!model.trim()) {
      toast.error('Enter a model name first');
      return;
    }
    if (provider === 'custom' && !baseUrl.trim()) {
      toast.error('Base URL is required for the custom provider');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          ...(needsBaseUrl && baseUrl.trim()
            ? { base_url: baseUrl.trim() }
            : {}),
          system_prompt: systemPrompt,
          auto_reply_schedule_start: scheduleStart,
          auto_reply_schedule_end: scheduleEnd,
          // Location-based default: if the user never picked a zone,
          // persist the browser-detected one so the schedule matches
          // their local hours.
          auto_reply_timezone: timezone.trim() || detectedTimezone(),
          handoff_agent_id: handoffAgentId || null,
          // Pass-through: settings this tab doesn't show must survive a
          // save untouched.
          is_active: config?.is_active === true,
          auto_reply_enabled: config?.auto_reply_enabled === true,
          auto_reply_max_per_conversation:
            config?.auto_reply_max_per_conversation ?? 3,
          auto_reply_limit_mode:
            config?.auto_reply_limit_mode ?? 'per_conversation',
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(body?.error ?? 'Failed to save configuration');
      toast.success('Configuration saved');
      setApiKey('');
      await mutate();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save configuration'
      );
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* System Prompt card */}
      <section className="border-border bg-muted/40 rounded-lg border p-4">
        <CardLabel>System Prompt</CardLabel>
        <div className="border-border bg-card mt-3 rounded-md border p-1">
          <Textarea
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            rows={5}
            placeholder="You are a helpful support assistant for our business. Answer briefly and politely, in the customer's language. If you don't know the answer, say a teammate will follow up."
            aria-label="System prompt"
            className="min-h-28 resize-y border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </div>
      </section>

      {/* AI Configuration card */}
      <section className="border-border bg-muted/40 rounded-lg border p-4">
        <CardLabel>AI Configuration</CardLabel>

        <div className="border-border bg-card mt-3 flex flex-col rounded-md border">
          {/* Model name */}
          <FieldGroup label="Model Name">
            <Input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="e.g. gpt-4o-mini"
              aria-label="Model name"
            />
          </FieldGroup>

          {/* Provider pills */}
          <FieldGroup label="AI Provider">
            <div className="flex flex-wrap items-center gap-2">
              {PILL_PROVIDERS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setProvider(p.value)}
                  aria-pressed={provider === p.value}
                  className={cn(
                    'rounded-md border px-3.5 py-1.5 text-sm font-medium transition-colors',
                    provider === p.value
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-card text-foreground hover:bg-muted'
                  )}
                >
                  {p.label}
                </button>
              ))}
              <Select
                value={isPillProvider ? '' : provider}
                onValueChange={(value) => value && setProvider(value)}
              >
                <SelectTrigger
                  aria-label="More providers"
                  className={cn(
                    'w-auto min-w-28',
                    !isPillProvider &&
                      'border-foreground bg-foreground text-background'
                  )}
                >
                  <SelectValue placeholder="More…" />
                </SelectTrigger>
                <SelectContent>
                  {MORE_PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </FieldGroup>

          {/* API key */}
          <FieldGroup label="API Key">
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                config?.has_key
                  ? '•••••••• saved — enter to replace'
                  : 'Paste your provider API key'
              }
              autoComplete="off"
              aria-label="Provider API key"
            />
          </FieldGroup>

          {/* Base URL (custom / ollama only) */}
          {needsBaseUrl ? (
            <FieldGroup label="Base URL">
              <Input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={
                  provider === 'ollama'
                    ? 'http://localhost:11434 (optional)'
                    : 'https://your-endpoint.example.com/v1'
                }
                aria-label="Base URL"
              />
            </FieldGroup>
          ) : null}

          {/* Business hours — WhatsApp etiquette: auto-reply runs inside
              this window; after-hours messages wait for a human. Leave
              empty to reply around the clock. */}
          <FieldGroup label="Active Hours (auto-reply window)">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                type="time"
                value={scheduleStart}
                onChange={(event) => setScheduleStart(event.target.value)}
                aria-label="Auto-reply start time"
                className="w-32"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <Input
                type="time"
                value={scheduleEnd}
                onChange={(event) => setScheduleEnd(event.target.value)}
                aria-label="Auto-reply end time"
                className="w-32"
              />
              <Select
                value={timezone || detectedTimezone()}
                onValueChange={(value) => value && setTimezone(value)}
              >
                <SelectTrigger aria-label="Timezone" className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {supportedTimezones().map((zone) => (
                    <SelectItem key={zone} value={zone}>
                      {zone.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="text-muted-foreground text-xs">
              Leave empty to reply around the clock. Outside these hours,
              conversations wait for your team.
            </span>
          </FieldGroup>

          {/* Escalation & handoff — the "escape hatch". The agent
              already detects when a human is needed (explicit request,
              low confidence) and writes a conversation summary; this
              picks WHO that conversation is routed to. */}
          <FieldGroup label="Escalation Handoff" last>
            <Select
              value={handoffAgentId || HANDOFF_QUEUE}
              onValueChange={(value) =>
                value && setHandoffAgentId(value === HANDOFF_QUEUE ? '' : value)
              }
            >
              <SelectTrigger
                aria-label="Escalation handoff target"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={HANDOFF_QUEUE}>
                  Shared queue (round-robin)
                </SelectItem>
                {(members ?? []).map((member) => (
                  <SelectItem key={member.user_id} value={member.user_id}>
                    {memberLabel(member)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-xs">
              When a customer asks for a human or the agent is unsure, the
              conversation is assigned here with an AI-written summary — the
              customer never repeats themselves.
            </span>
          </FieldGroup>
        </div>

        {/* Actions */}
        <div className="mt-4 flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void testAgent()}
            disabled={testing || saving}
          >
            {testing ? (
              <Loader2
                data-icon="inline-start"
                className="animate-spin"
                aria-hidden
              />
            ) : (
              <PlugZap data-icon="inline-start" aria-hidden />
            )}
            Test Agent
          </Button>
          <Button
            onClick={() => void saveConfiguration()}
            disabled={saving || testing}
          >
            {saving ? (
              <Loader2
                data-icon="inline-start"
                className="animate-spin"
                aria-hidden
              />
            ) : null}
            Save Configuration
          </Button>
        </div>
      </section>
    </div>
  );
}

// Square-bullet card label matching the reference's "■ System Prompt".
function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-foreground flex items-center gap-2 text-sm font-semibold">
      <span className="bg-foreground size-1.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

// Labeled field row inside the AI Configuration inset — stacked label +
// control with a dashed divider between rows, like the reference.
function FieldGroup({
  label,
  last = false,
  children,
}: {
  label: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 px-4 py-3.5',
        !last && 'border-border border-b border-dashed'
      )}
    >
      <span className="text-foreground text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}
