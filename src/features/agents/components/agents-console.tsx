'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { AiKnowledgeCard } from '@/features/settings/components/ai-knowledge';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { cn } from '@/lib/utils';
import {
  AGENT_KIND_META,
  AGENT_KIND_ORDER,
  providerLabel,
  swrJson,
  type AgentKind,
  type ClientAgent,
} from '../lib/agent-meta';
import { AgentActivity } from './agent-activity';
import { AgentSettingsForm } from './agent-settings-form';
import { AgentSetupWizard } from './agent-setup-wizard';
import { AiPlayground } from './ai-playground';

// ------------------------------------------------------------------
// AI Agents console — per-agent system. Each agent (Support Copilot,
// Auto-Reply Agent) is its own `ai_agents` row with a fully
// independent provider, API key, model, prompt, and behavior
// settings. No shared config and no dependency between agents.
// Tabs: Overview / Configuration / Knowledge Base / Playground /
// Activity (Run History + Usage merged, scoped to the agent).
// ------------------------------------------------------------------

type TabKey =
  | 'overview'
  | 'configuration'
  | 'knowledge'
  | 'playground'
  | 'activity';

export function AgentsConsole() {
  const { can, accountId } = useAuth();
  const canManage = can('ai:manage');

  const { data, isLoading, mutate } = useSWR<{ agents: ClientAgent[] }>(
    '/api/ai/agents',
    swrJson
  );
  const agents = useMemo(() => data?.agents ?? [], [data?.agents]);

  const [selected, setSelected] = useState<AgentKind>('copilot');
  const [tab, setTab] = useState<TabKey>('overview');
  const [busyToggle, setBusyToggle] = useState<string | null>(null);

  const byKind = useMemo(() => {
    const map = new Map<AgentKind, ClientAgent>();
    for (const a of agents) map.set(a.kind as AgentKind, a);
    return map;
  }, [agents]);

  const current = byKind.get(selected) ?? null;
  const meta = AGENT_KIND_META[selected];
  const activeCount = agents.filter((a) => a.isEnabled).length;

  /** Enable/disable via the per-agent PATCH — no cross-agent coupling. */
  async function toggleAgent(agent: ClientAgent, next: boolean) {
    if (!canManage) return;
    setBusyToggle(agent.id);
    try {
      const res = await fetch(`/api/ai/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_enabled: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'Failed to update');
      await mutate();
      toast.success(
        `${AGENT_KIND_META[agent.kind as AgentKind].name} ${next ? 'enabled' : 'paused'}`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusyToggle(null);
    }
  }

  function selectAgent(kind: AgentKind) {
    setSelected(kind);
    setTab('overview');
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Page header ---- */}
      <div className="flex items-center gap-2.5">
        <h1 className="text-foreground font-serif text-3xl tracking-tight">
          AI Agents
        </h1>
        <span className="border-border bg-card text-muted-foreground rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums">
          {String(activeCount).padStart(2, '0')}
        </span>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* ---- Left rail: one card per agent kind ---- */}
        <aside
          className="flex w-full shrink-0 flex-col gap-2 lg:w-64"
          aria-label="Agent list"
        >
          <span className="text-muted-foreground px-1 text-[11px] font-medium tracking-wider uppercase">
            Your agents
          </span>
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </>
          ) : (
            AGENT_KIND_ORDER.map((kind) => {
              const m = AGENT_KIND_META[kind];
              const agent = byKind.get(kind) ?? null;
              const Icon = m.icon;
              const isSelected = kind === selected;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => selectAgent(kind)}
                  aria-pressed={isSelected}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                    isSelected
                      ? 'border-primary/40 bg-card ring-primary/30 ring-1'
                      : 'border-border bg-muted/40 hover:bg-card'
                  )}
                >
                  <span className="border-border bg-background flex size-8 shrink-0 items-center justify-center rounded-md border">
                    <Icon
                      className="text-muted-foreground size-4"
                      aria-hidden
                    />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-foreground truncate text-sm font-medium">
                      {m.name}
                    </span>
                    <span className="text-muted-foreground truncate text-xs">
                      {agent
                        ? `${agent.model ?? '—'} · ${agent.isEnabled ? 'Active' : 'Paused'}`
                        : m.tagline}
                    </span>
                    {!agent && (
                      <span className="text-primary mt-0.5 inline-flex items-center gap-1 text-xs font-medium">
                        <Plus className="size-3" aria-hidden />
                        Set up
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          )}
        </aside>

        {/* ---- Right detail panel ---- */}
        <section className="border-border bg-card min-w-0 flex-1 rounded-xl border">
          {isLoading ? (
            <div className="p-5">
              <Skeleton className="h-80 w-full rounded-lg" />
            </div>
          ) : !current ? (
            /* Not configured yet → guided setup wizard, right in place. */
            <div className="p-5">
              {canManage ? (
                <AgentSetupWizard
                  kind={selected}
                  onCreated={async (agent) => {
                    await mutate();
                    setSelected(agent.kind as AgentKind);
                    setTab('overview');
                  }}
                />
              ) : (
                <p className="text-muted-foreground py-12 text-center text-sm">
                  The {meta.name} is not set up yet. Ask an admin to configure
                  it.
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Detail header */}
              <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-foreground font-serif text-2xl tracking-tight">
                      {meta.name}
                    </h2>
                    <Badge
                      variant={current.isEnabled ? 'default' : 'secondary'}
                    >
                      {current.isEnabled ? 'Active' : 'Paused'}
                    </Badge>
                    <Badge variant="outline">
                      {providerLabel(current.provider)} · {current.model ?? '—'}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {meta.tagline} · fully independent configuration
                  </p>
                </div>
                {canManage ? (
                  <div className="flex items-center gap-2.5">
                    <span className="text-muted-foreground text-xs">
                      {current.isEnabled ? 'Enabled' : 'Disabled'}
                    </span>
                    {busyToggle === current.id ? (
                      <Loader2
                        className="text-muted-foreground size-4 animate-spin"
                        aria-hidden
                      />
                    ) : (
                      <Switch
                        checked={current.isEnabled}
                        onCheckedChange={(next) =>
                          void toggleAgent(current, next)
                        }
                        aria-label={`Enable or disable ${meta.name}`}
                      />
                    )}
                  </div>
                ) : null}
              </div>

              {/* Underline tabs */}
              <div
                className="border-border mt-4 flex items-center gap-1 overflow-x-auto border-b px-5"
                role="tablist"
                aria-label="Agent detail tabs"
              >
                {(
                  [
                    { key: 'overview', label: 'Overview' },
                    { key: 'configuration', label: 'Configuration' },
                    { key: 'knowledge', label: 'Knowledge Base' },
                    { key: 'playground', label: 'Playground' },
                    ...(canManage
                      ? [{ key: 'activity', label: 'Activity' } as const]
                      : []),
                  ] as { key: TabKey; label: string }[]
                ).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      '-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors',
                      tab === t.key
                        ? 'border-primary text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground border-transparent'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="p-5">
                {tab === 'overview' ? (
                  <OverviewTab agent={current} kind={selected} />
                ) : null}
                {tab === 'configuration' ? (
                  canManage ? (
                    <AgentSettingsForm
                      agent={current}
                      canManage={canManage}
                      onSaved={() => void mutate()}
                    />
                  ) : (
                    <p className="text-muted-foreground py-8 text-center text-sm">
                      Only admins can change agent configuration.
                    </p>
                  )
                ) : null}
                {tab === 'knowledge' ? (
                  <AiKnowledgeCard
                    accountId={accountId}
                    canEdit={canManage}
                    hasEmbeddingsKey={current.hasEmbeddingsKey}
                  />
                ) : null}
                {tab === 'playground' ? (
                  <AiPlayground onGoToSetup={() => setTab('configuration')} />
                ) : null}
                {tab === 'activity' && canManage ? (
                  <AgentActivity agent={selected} />
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ---- Overview tab ----------------------------------------------------

/** Read-only summary: what this agent is and how it is set up. */
function OverviewTab({
  agent,
  kind,
}: {
  agent: ClientAgent;
  kind: AgentKind;
}) {
  const meta = AGENT_KIND_META[kind];
  const settings = agent.settings as Record<string, unknown>;

  const rows: [string, string][] = [
    ['Provider', providerLabel(agent.provider)],
    ['Model', agent.model ?? '—'],
    ['API key', agent.hasApiKey ? 'Saved' : 'Not set'],
    ['Status', agent.isEnabled ? 'Active' : 'Paused'],
  ];
  if (kind === 'autoreply') {
    const cap = Number(settings.replyCap);
    rows.push(['Reply cap', `${cap >= 1 ? cap : 3} / conversation`]);
    rows.push([
      'Reply hours',
      typeof settings.scheduleStart === 'string' &&
      typeof settings.scheduleEnd === 'string' &&
      settings.scheduleStart &&
      settings.scheduleEnd
        ? `${settings.scheduleStart} – ${settings.scheduleEnd}`
        : 'Always on',
    ]);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="border-border bg-muted/40 rounded-lg border p-4">
        <h3 className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
          Description
        </h3>
        <p className="text-foreground mt-2 text-sm leading-relaxed">
          {meta.description}
        </p>
        {agent.systemPrompt ? (
          <p className="border-border text-muted-foreground mt-3 border-t pt-3 text-xs leading-relaxed">
            <span className="text-foreground font-medium">
              Custom instructions:{' '}
            </span>
            {agent.systemPrompt.length > 180
              ? `${agent.systemPrompt.slice(0, 180)}…`
              : agent.systemPrompt}
          </p>
        ) : null}
      </div>

      <div className="border-border bg-muted/40 rounded-lg border p-4">
        <h3 className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
          Setup
        </h3>
        <dl className="mt-2 flex flex-col">
          {rows.map(([label, value], i) => (
            <div
              key={label}
              className={cn(
                'flex items-center justify-between py-2 text-sm',
                i < rows.length - 1 && 'border-border border-b'
              )}
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-foreground font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
