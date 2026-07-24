'use client'

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Bot,
  Loader2,
  MessageCircleReply,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { AiPlayground } from '@/features/agents/components/ai-playground'
import { AiUsageCard } from '@/features/agents/components/ai-usage'
import { AgentConfiguration } from '@/features/agents/components/agent-configuration'
import { ConfigureAgentWizard } from '@/features/agents/components/configure-agent-wizard'
import { AiKnowledgeCard } from '@/features/settings/components/ai-knowledge'
import { useAuth } from '@/features/auth/hooks/use-auth'
import { cn } from '@/lib/utils'

// ------------------------------------------------------------------
// Lumis-style AI Agents console: serif display headings, a left rail
// grouping agents by Active/Inactive, and a right detail panel with
// underline tabs (Overview / Configuration / Playground / Usage).
// Both "agents" are views over the account's single BYO-key config:
//   - Support Copilot  -> is_active        (assistant + inbox drafts)
//   - Auto-Reply Agent -> auto_reply_enabled (requires is_active)
// ------------------------------------------------------------------

interface AiConfigData {
  configured: boolean
  env_fallback?: boolean
  auto_reply_live?: boolean
  has_key?: boolean
  has_embeddings_key?: boolean
  provider?: string
  model?: string
  is_active?: boolean
  auto_reply_enabled?: boolean
  auto_reply_max_per_conversation?: number
  auto_reply_limit_mode?: string
  auto_reply_schedule_start?: string | null
  auto_reply_schedule_end?: string | null
  auto_reply_timezone?: string | null
  system_prompt?: string | null
}

interface UsageData {
  days: number
  totals: { calls: number; total_tokens: number }
  daily: { date: string; tokens: number; calls: number }[]
}

type AgentKey = 'copilot' | 'autoreply'
type TabKey = 'overview' | 'configuration' | 'knowledge' | 'playground' | 'runs' | 'usage'

interface RunRow {
  id: string
  conversation_id: string | null
  mode: 'auto_reply' | 'draft'
  provider: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  created_at: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const AGENT_META: Record<
  AgentKey,
  { name: string; icon: typeof Bot; description: string }
> = {
  copilot: {
    name: 'Support Copilot',
    icon: Sparkles,
    description:
      'Assists your team inside the inbox — drafts suggested replies from the conversation history and your knowledge base, summarizes long threads, and answers product questions in your established tone. Suggestions are never sent without an agent approving them.',
  },
  autoreply: {
    name: 'Auto-Reply Agent',
    icon: MessageCircleReply,
    description:
      'Replies to inbound customer messages automatically when your team is away or busy — grounded in your knowledge base, capped per conversation, and restricted to your reply-hours window. Hands the conversation to a human the moment it is unsure.',
  },
}

export function AgentsConsole() {
  const { can, accountId } = useAuth()
  const canManage = can('ai:manage')

  const {
    data: config,
    isLoading,
    mutate,
  } = useSWR<AiConfigData>('/api/ai/config', fetcher)
  const { data: usage } = useSWR<UsageData>(
    canManage ? '/api/ai/usage?days=14' : null,
    fetcher,
  )

  const [selected, setSelected] = useState<AgentKey>('copilot')
  const [tab, setTab] = useState<TabKey>('overview')
  const [busyToggle, setBusyToggle] = useState<AgentKey | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  const configured = config?.configured === true
  const copilotActive = configured && config?.is_active === true
  const autoReplyActive = copilotActive && config?.auto_reply_enabled === true

  const agents = useMemo(
    () =>
      (
        [
          { key: 'copilot' as const, active: copilotActive },
          { key: 'autoreply' as const, active: autoReplyActive },
        ]
      ).map((a) => ({
        ...a,
        ...AGENT_META[a.key],
        modelLabel: configured
          ? `${config?.model ?? ''}`
          : 'Not configured',
      })),
    [configured, copilotActive, autoReplyActive, config?.model],
  )
  const activeAgents = agents.filter((a) => a.active)
  const inactiveAgents = agents.filter((a) => !a.active)
  const current = agents.find((a) => a.key === selected) ?? agents[0]

  /**
   * The enable/disable fix: toggles go through PATCH (toggle-only
   * endpoint) instead of the full-form POST that required the API key
   * to be re-validated. Enabling auto-reply also enables the assistant
   * (it depends on it); disabling the assistant pauses auto-reply too.
   */
  async function toggleAgent(key: AgentKey, next: boolean) {
    if (!canManage) return
    if (!configured) {
      toast.error('Set up the AI agent first — add your provider and API key.')
      setTab('configuration')
      return
    }
    setBusyToggle(key)
    try {
      const patch =
        key === 'copilot'
          ? next
            ? { is_active: true }
            : { is_active: false }
          : next
            ? { is_active: true, auto_reply_enabled: true }
            : { auto_reply_enabled: false }
      const res = await fetch('/api/ai/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error ?? 'Failed to update')
      await mutate()
      toast.success(
        key === 'copilot'
          ? next
            ? 'AI assistant enabled'
            : 'AI assistant disabled — auto-reply is paused too'
          : next
            ? 'Auto-reply enabled'
            : 'Auto-reply disabled',
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusyToggle(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Page header ---- */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <h1 className="font-serif text-3xl tracking-tight text-foreground">
            AI Agents
          </h1>
          <span className="rounded-full border border-border bg-card px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {String(activeAgents.length).padStart(2, '0')}
          </span>
        </div>
        {canManage ? (
          <Button onClick={() => setWizardOpen(true)}>
            <Plus data-icon="inline-start" aria-hidden />
            Configure New Agent
          </Button>
        ) : null}
      </div>

      {canManage ? (
        <ConfigureAgentWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          onSaved={() => {
            void mutate()
            setTab('overview')
          }}
        />
      ) : null}

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* ---- Left rail: agent list ---- */}
        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-64" aria-label="Agent list">
          <RailGroup
            label={`Active agents (${activeAgents.length})`}
            agents={activeAgents}
            selected={selected}
            configured={configured}
            onSelect={(k) => setSelected(k)}
            loading={isLoading}
          />
          <RailGroup
            label={`Inactive agents (${inactiveAgents.length})`}
            agents={inactiveAgents}
            selected={selected}
            configured={configured}
            onSelect={(k) => setSelected(k)}
            loading={isLoading}
          />
        </aside>

        {/* ---- Right detail panel ---- */}
        <section className="min-w-0 flex-1 rounded-xl border border-border bg-card">
          {/* Detail header */}
          <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-serif text-2xl tracking-tight text-foreground">
                  {current.name}
                </h2>
                <Badge variant={current.active ? 'default' : 'secondary'}>
                  {current.active ? 'Active' : configured ? 'Paused' : 'Not set up'}
                </Badge>
                {configured && config?.model ? (
                  <Badge variant="outline" className="gap-1">
                    <Sparkles className="size-3" aria-hidden />
                    {config.model}
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                {configured
                  ? `${providerLabel(config?.provider)} · ${
                      current.key === 'autoreply'
                        ? `Max ${config?.auto_reply_max_per_conversation ?? 3} replies ${config?.auto_reply_limit_mode === 'per_day' ? 'per day' : 'per conversation'}`
                        : 'Suggestions reviewed by your team'
                    }`
                  : 'Connect a provider and API key to bring this agent online.'}
              </p>
            </div>
            {canManage ? (
              <div className="flex items-center gap-2.5">
                <span className="text-xs text-muted-foreground">
                  {current.active ? 'Enabled' : 'Disabled'}
                </span>
                {busyToggle === current.key ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                ) : (
                  <Switch
                    checked={current.active}
                    onCheckedChange={(next) => void toggleAgent(current.key, next)}
                    aria-label={`Enable or disable ${current.name}`}
                  />
                )}
              </div>
            ) : null}
          </div>

          {/* Underline tabs */}
          <div className="mt-4 flex items-center gap-1 border-b border-border px-5" role="tablist" aria-label="Agent detail tabs">
            {(
              [
                { key: 'overview' as const, label: 'Overview' },
                { key: 'configuration' as const, label: 'Configuration' },
                { key: 'knowledge' as const, label: 'Knowledge Base' },
                { key: 'playground' as const, label: 'Playground' },
                ...(canManage
                  ? [
                      { key: 'runs' as const, label: 'Run History' },
                      { key: 'usage' as const, label: 'Usage' },
                    ]
                  : []),
              ]
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  '-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors',
                  tab === t.key
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === 'overview' ? (
              <OverviewTab
                agent={current}
                config={config}
                usage={usage}
                canManage={canManage}
                busyToggle={busyToggle}
                onToggle={toggleAgent}
                loading={isLoading}
              />
            ) : null}
            {tab === 'configuration' ? <AgentConfiguration /> : null}
            {tab === 'knowledge' ? (
              <AiKnowledgeCard
                accountId={accountId}
                canEdit={canManage}
                hasEmbeddingsKey={config?.has_embeddings_key === true}
              />
            ) : null}
            {tab === 'playground' ? (
              <AiPlayground onGoToSetup={() => setTab('configuration')} />
            ) : null}
            {tab === 'runs' && canManage ? <RunHistoryTab /> : null}
            {tab === 'usage' && canManage ? <AiUsageCard /> : null}
          </div>
        </section>
      </div>
    </div>
  )
}

// ---- Left rail group ------------------------------------------------

function RailGroup({
  label,
  agents,
  selected,
  configured,
  onSelect,
  loading,
}: {
  label: string
  agents: { key: AgentKey; name: string; icon: typeof Bot; active: boolean; modelLabel: string }[]
  selected: AgentKey
  configured: boolean
  onSelect: (key: AgentKey) => void
  loading: boolean
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="px-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {loading ? (
        <Skeleton className="h-16 w-full rounded-lg" />
      ) : agents.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          {label.startsWith('Active') ? 'No agents running.' : 'Everything is running.'}
        </p>
      ) : (
        agents.map((agent) => {
          const Icon = agent.icon
          const isSelected = agent.key === selected
          return (
            <button
              key={agent.key}
              type="button"
              onClick={() => onSelect(agent.key)}
              aria-pressed={isSelected}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                isSelected
                  ? 'border-primary/40 bg-card ring-1 ring-primary/30'
                  : 'border-border bg-muted/40 hover:bg-card',
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                <Icon className="size-4 text-muted-foreground" aria-hidden />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-foreground">
                  {agent.name}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {configured
                    ? `${agent.modelLabel} · ${agent.active ? 'Active' : 'Paused'}`
                    : 'Not configured'}
                </span>
              </span>
            </button>
          )
        })
      )}
    </div>
  )
}

// ---- Overview tab ----------------------------------------------------

function OverviewTab({
  agent,
  config,
  usage,
  canManage,
  busyToggle,
  onToggle,
  loading,
}: {
  agent: { key: AgentKey; name: string; active: boolean }
  config: AiConfigData | undefined
  usage: UsageData | undefined
  canManage: boolean
  busyToggle: AgentKey | null
  onToggle: (key: AgentKey, next: boolean) => Promise<void>
  loading: boolean
}) {
  const configured = config?.configured === true
  const schedule =
    config?.auto_reply_schedule_start && config?.auto_reply_schedule_end
      ? `${config.auto_reply_schedule_start} – ${config.auto_reply_schedule_end}${config.auto_reply_timezone ? ` (${config.auto_reply_timezone})` : ''}`
      : 'Always on'

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Description card */}
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <CardLabel>Description</CardLabel>
          <p className="mt-2 text-sm leading-relaxed text-foreground">
            {AGENT_META[agent.key].description}
          </p>
          {config?.system_prompt ? (
            <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Custom instructions: </span>
              {config.system_prompt.length > 180
                ? `${config.system_prompt.slice(0, 180)}…`
                : config.system_prompt}
            </p>
          ) : null}
        </div>

        {/* Status & controls card */}
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <CardLabel>Status &amp; controls</CardLabel>
          <div className="mt-2 flex flex-col">
            <ControlRow
              label="AI Assistant"
              hint="Inbox suggestions & playground"
              checked={configured && config?.is_active === true}
              disabled={!canManage}
              busy={busyToggle === 'copilot'}
              onChange={(next) => void onToggle('copilot', next)}
            />
            <ControlRow
              label="Auto-reply"
              hint="Answers customers automatically"
              checked={configured && config?.is_active === true && config?.auto_reply_enabled === true}
              disabled={!canManage}
              busy={busyToggle === 'autoreply'}
              onChange={(next) => void onToggle('autoreply', next)}
            />
            <FactRow label="Provider" value={configured ? providerLabel(config?.provider) : '—'} />
            <FactRow label="Model" value={configured ? (config?.model ?? '—') : '—'} />
            <FactRow
              label="Reply cap"
              value={
                configured
                  ? `${config?.auto_reply_max_per_conversation ?? 3} ${config?.auto_reply_limit_mode === 'per_day' ? '/ day' : '/ conversation'}`
                  : '—'
              }
            />
            <FactRow label="Reply hours" value={configured ? schedule : '—'} last />
          </div>
        </div>
      </div>

      {/* Requests chart */}
      {canManage ? (
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <CardLabel>Live requests volume</CardLabel>
            <span className="text-xs text-muted-foreground">
              Last {usage?.days ?? 14} days
            </span>
          </div>
          {usage && usage.daily?.length ? (
            <div className="mt-3 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={usage.daily} margin={{ top: 6, right: 6, bottom: 0, left: -12 }}>
                  <defs>
                    <linearGradient id="agents-calls-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => value.slice(5)}
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={24}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    axisLine={false}
                    tickLine={false}
                    width={40}
                  />
                  <Tooltip
                    cursor={{ stroke: 'var(--primary)', strokeDasharray: '3 3' }}
                    contentStyle={{
                      background: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      fontSize: 12,
                      color: 'var(--popover-foreground)',
                    }}
                    formatter={(value, name) => [
                      String(value ?? ''),
                      name === 'calls' ? 'Requests' : 'Tokens',
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="calls"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    fill="url(#agents-calls-fill)"
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-3 rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No AI requests yet — try the playground or enable auto-reply to see traffic here.
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

// ---- Run history tab -------------------------------------------------
// Matches the reference "Recent Runs" table: run id, triggered date,
// surface, input/output tokens, status. Every logged row is a
// completed provider call, so status is always "Success" — failures
// never reach the usage log.

function RunHistoryTab() {
  const { data, isLoading } = useSWR<{ runs: RunRow[] }>(
    '/api/ai/runs?limit=25',
    fetcher,
  )
  const runs = data?.runs ?? []

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-10 w-full rounded-md" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center">
        <p className="text-sm font-medium text-foreground">No runs yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Runs appear here when the assistant drafts a reply or auto-reply answers a customer.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-4">
      <CardLabel>Recent runs</CardLabel>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="pb-2 pr-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">Run ID</th>
              <th scope="col" className="pb-2 pr-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">Triggered</th>
              <th scope="col" className="pb-2 pr-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">Surface</th>
              <th scope="col" className="pb-2 pr-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">Model</th>
              <th scope="col" className="pb-2 pr-4 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Input tkns</th>
              <th scope="col" className="pb-2 pr-4 text-right text-xs font-medium uppercase tracking-wider text-muted-foreground">Output tkns</th>
              <th scope="col" className="pb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b border-dashed border-border last:border-0">
                <td className="py-2.5 pr-4 font-mono text-xs text-foreground">
                  RUN-{run.id.slice(0, 4).toUpperCase()}
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">{formatRunDate(run.created_at)}</td>
                <td className="py-2.5 pr-4">
                  <Badge variant="outline">
                    {run.mode === 'auto_reply' ? 'Auto-reply' : 'Draft'}
                  </Badge>
                </td>
                <td className="max-w-36 truncate py-2.5 pr-4 text-muted-foreground">{run.model}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-foreground">{run.prompt_tokens.toLocaleString()}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums text-foreground">{run.completion_tokens.toLocaleString()}</td>
                <td className="py-2.5">
                  <Badge className="border-emerald-600/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">Success</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatRunDate(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return `${time} Today`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `${time} Yesterday`
  return `${time} ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

// ---- Small building blocks -------------------------------------------

function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
      <span className="inline-block size-1.5 rounded-[2px] bg-primary" aria-hidden />
      {children}
    </span>
  )
}

function ControlRow({
  label,
  hint,
  checked,
  disabled,
  busy,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  busy: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-dashed border-border py-2.5">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="truncate text-xs text-muted-foreground">{hint}</span>
      </div>
      {busy ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <Switch
          checked={checked}
          onCheckedChange={onChange}
          disabled={disabled}
          aria-label={`Enable or disable ${label}`}
        />
      )}
    </div>
  )
}

function FactRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 py-2.5',
        !last && 'border-b border-dashed border-border',
      )}
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium text-foreground">{value}</span>
    </div>
  )
}

function providerLabel(provider?: string) {
  switch (provider) {
    case 'gemini':
      return 'Google Gemini'
    case 'openai':
      return 'OpenAI'
    case 'anthropic':
      return 'Anthropic'
    case 'groq':
      return 'Groq'
    case 'ollama':
      return 'Ollama'
    case 'custom':
      return 'Custom (OpenAI-compatible)'
    default:
      return provider ?? '—'
  }
}
