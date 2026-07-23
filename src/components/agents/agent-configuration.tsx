'use client'

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

import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Loader2, PlugZap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

const fetcher = (url: string) => fetch(url).then((res) => res.json())

// Providers surfaced as pills (the reference shows four). The rest stay
// reachable through the "More" select so nothing is lost.
const PILL_PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Claude' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'groq', label: 'Groq' },
] as const

const MORE_PROVIDERS = [
  { value: 'nvidia', label: 'NVIDIA' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'together', label: 'Together' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'xai', label: 'xAI (Grok)' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'custom', label: 'Custom endpoint' },
] as const

const LIMIT_MODES = [
  { value: 'per_conversation', label: 'Cap per conversation' },
  { value: 'per_day', label: 'Cap per day' },
  { value: 'never', label: 'No cap — always reply' },
] as const

const MAX_REPLY_OPTIONS = ['1', '2', '3', '5', '10', '20'] as const

interface AiConfigData {
  configured: boolean
  has_key?: boolean
  has_embeddings_key?: boolean
  provider?: string
  model?: string
  base_url?: string | null
  system_prompt?: string | null
  is_active?: boolean
  auto_reply_enabled?: boolean
  auto_reply_max_per_conversation?: number
  auto_reply_limit_mode?: string
  auto_reply_schedule_start?: string | null
  auto_reply_schedule_end?: string | null
  auto_reply_timezone?: string | null
}

export function AgentConfiguration() {
  const { data: config, isLoading, mutate } = useSWR<AiConfigData>(
    '/api/ai/config',
    fetcher,
  )

  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [maxReplies, setMaxReplies] = useState('3')
  const [limitMode, setLimitMode] = useState('per_conversation')
  const [hydratedFor, setHydratedFor] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  // Render-time hydration once the config arrives (and re-hydration if
  // a different config object is fetched after save).
  const hydrationKey = config
    ? `${config.provider}|${config.model}|${config.system_prompt ?? ''}|${config.auto_reply_max_per_conversation}|${config.auto_reply_limit_mode}`
    : null
  if (config?.configured && hydrationKey && hydratedFor !== hydrationKey) {
    setHydratedFor(hydrationKey)
    setProvider(config.provider ?? 'openai')
    setModel(config.model ?? '')
    setBaseUrl(config.base_url ?? '')
    setSystemPrompt(config.system_prompt ?? '')
    setMaxReplies(String(config.auto_reply_max_per_conversation ?? 3))
    setLimitMode(config.auto_reply_limit_mode ?? 'per_conversation')
    setApiKey('')
  }

  const needsBaseUrl = provider === 'custom' || provider === 'ollama'
  const isPillProvider = PILL_PROVIDERS.some((p) => p.value === provider)

  async function testAgent() {
    if (!model.trim()) {
      toast.error('Enter a model name first')
      return
    }
    setTesting(true)
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
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Provider test failed')
      toast.success('Agent responded — configuration works')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Provider test failed')
    } finally {
      setTesting(false)
    }
  }

  async function saveConfiguration() {
    if (!model.trim()) {
      toast.error('Enter a model name first')
      return
    }
    if (provider === 'custom' && !baseUrl.trim()) {
      toast.error('Base URL is required for the custom provider')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          ...(needsBaseUrl && baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
          system_prompt: systemPrompt,
          auto_reply_max_per_conversation: Number(maxReplies),
          auto_reply_limit_mode: limitMode,
          // Pass-through: settings this tab doesn't show must survive a
          // save untouched.
          is_active: config?.is_active === true,
          auto_reply_enabled: config?.auto_reply_enabled === true,
          auto_reply_schedule_start: config?.auto_reply_schedule_start ?? '',
          auto_reply_schedule_end: config?.auto_reply_schedule_end ?? '',
          auto_reply_timezone: config?.auto_reply_timezone ?? '',
        }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Failed to save configuration')
      toast.success('Configuration saved')
      setApiKey('')
      await mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* System Prompt card */}
      <section className="rounded-lg border border-border bg-muted/40 p-4">
        <CardLabel>System Prompt</CardLabel>
        <div className="mt-3 rounded-md border border-border bg-card p-1">
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
      <section className="rounded-lg border border-border bg-muted/40 p-4">
        <CardLabel>AI Configuration</CardLabel>

        <div className="mt-3 flex flex-col rounded-md border border-border bg-card">
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
                      : 'border-border bg-card text-foreground hover:bg-muted',
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
                    !isPillProvider && 'border-foreground bg-foreground text-background',
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
              placeholder={config?.has_key ? '•••••••• saved — enter to replace' : 'Paste your provider API key'}
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
                placeholder={provider === 'ollama' ? 'http://localhost:11434 (optional)' : 'https://your-endpoint.example.com/v1'}
                aria-label="Base URL"
              />
            </FieldGroup>
          ) : null}

          {/* Max replies */}
          <FieldGroup label="Max Auto-Replies">
            <Select value={maxReplies} onValueChange={(value) => value && setMaxReplies(value)}>
              <SelectTrigger aria-label="Maximum auto-replies" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MAX_REPLY_OPTIONS.map((n) => (
                  <SelectItem key={n} value={n}>
                    {n} {n === '1' ? 'reply' : 'replies'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldGroup>

          {/* Fallback behaviour */}
          <FieldGroup label="Reply Limit Behavior" last>
            <Select value={limitMode} onValueChange={(value) => value && setLimitMode(value)}>
              <SelectTrigger aria-label="Reply limit behavior" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LIMIT_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldGroup>
        </div>

        {/* Actions */}
        <div className="mt-4 flex items-center gap-2">
          <Button variant="outline" onClick={() => void testAgent()} disabled={testing || saving}>
            {testing ? (
              <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden />
            ) : (
              <PlugZap data-icon="inline-start" aria-hidden />
            )}
            Test Agent
          </Button>
          <Button onClick={() => void saveConfiguration()} disabled={saving || testing}>
            {saving ? <Loader2 data-icon="inline-start" className="animate-spin" aria-hidden /> : null}
            Save Configuration
          </Button>
        </div>
      </section>
    </div>
  )
}

// Square-bullet card label matching the reference's "■ System Prompt".
function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
      <span className="size-1.5 shrink-0 bg-foreground" aria-hidden />
      {children}
    </p>
  )
}

// Labeled field row inside the AI Configuration inset — stacked label +
// control with a dashed divider between rows, like the reference.
function FieldGroup({
  label,
  last = false,
  children,
}: {
  label: string
  last?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={cn('flex flex-col gap-2 px-4 py-3.5', !last && 'border-b border-dashed border-border')}>
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
    </div>
  )
}
