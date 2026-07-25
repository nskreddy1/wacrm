'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Bot, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { AiKnowledgeCard } from '@/features/settings/components/ai-knowledge';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { cn } from '@/lib/utils';
import {
  CAPABILITY_META,
  CAPABILITY_ORDER,
  DEFAULT_AGENT_NAME,
  providerLabel,
  swrJson,
  type AgentCapability,
  type ClientAgent,
} from '../lib/agent-meta';
import { AgentActivity } from './agent-activity';
import { AgentSettingsForm } from './agent-settings-form';
import { AgentSetupWizard } from './agent-setup-wizard';
import { AiPlayground } from './ai-playground';

// ------------------------------------------------------------------
// AI Agents console — ONE default agent per account (a single
// `ai_agents` row with one provider/key/model/persona) exposing two
// independently toggleable capabilities, each backed by its own DB
// column: AI suggestions (suggestions_enabled) and Auto-reply
// (autoreply_enabled). One agent can handle both jobs.
//
// Layout preserved from the original console design: serif page
// header + count, left agent rail (Active / Inactive groups), right
// detail panel with tabs. Run History and Usage are merged into a
// single Activity tab (they showed the same data).
// ------------------------------------------------------------------

type TabKey =
  | 'overview'
  | 'configuration'
  | 'knowledge'
  | 'playground'
  | 'activity';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'configuration', label: 'Configuration' },
  { key: 'knowledge', label: 'Knowledge Base' },
  { key: 'playground', label: 'Playground' },
  { key: 'activity', label: 'Activity' },
];

export function AgentsConsole() {
  const { can, accountId } = useAuth();
  const canManage = can('ai:manage');

  const { data, isLoading, mutate } = useSWR<{ agent: ClientAgent | null }>(
    '/api/ai/agents',
    swrJson
  );
  const agent = data?.agent ?? null;

  const [tab, setTab] = useState<TabKey>('overview');
  const [showWizard, setShowWizard] = useState(false);
  const [busyToggle, setBusyToggle] = useState<string | null>(null);

  const configured = Boolean(agent?.provider && agent?.model);
  const running = Boolean(
    agent &&
      agent.isEnabled &&
      configured &&
      (agent.suggestionsEnabled || agent.autoreplyEnabled)
  );
  const activeCount = running ? 1 : 0;

  /** PATCH a partial body against the agent row and refresh. */
  async function patchAgent(body: Record<string, unknown>, okMsg: string) {
    if (!agent || !canManage) return;
    const busyKey = Object.keys(body)[0] ?? 'patch';
    setBusyToggle(busyKey);
    try {
      const res = await fetch(`/api/ai/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error ?? 'Failed to update');
      await mutate();
      toast.success(okMsg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusyToggle(null);
    }
  }

  const statusLabel = !agent
    ? 'Not set up'
    : !configured
      ? 'Not configured'
      : running
        ? 'Active'
        : 'Paused';

  return (
    <div className="flex flex-col gap-5">
      {/* ---- Page header ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h1 className="text-foreground font-serif text-3xl tracking-tight">
            AI Agents
          </h1>
          <span className="border-border bg-card text-muted-foreground rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums">
            {String(activeCount).padStart(2, '0')}
          </span>
        </div>
        {canManage && !agent && !showWizard && (
          <Button onClick={() => setShowWizard(true)}>
            <Plus className="size-4" aria-hidden />
            Configure New Agent
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        {/* ---- Left rail: Active / Inactive groups ---- */}
        <aside
          className="flex w-full shrink-0 flex-col gap-4 lg:w-64"
          aria-label="Agent list"
        >
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground px-1 text-[11px] font-medium tracking-wider uppercase">
              Active agents ({activeCount})
            </span>
            {isLoading ? (
              <Skeleton className="h-16 w-full rounded-lg" />
            ) : running && agent ? (
              <AgentRailCard agent={agent} selected />
            ) : (
              <div className="border-border text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-sm">
                No agents running.
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground px-1 text-[11px] font-medium tracking-wider uppercase">
              Inactive agents ({agent && !running ? 1 : 0})
            </span>
            {isLoading ? (
              <Skeleton className="h-16 w-full rounded-lg" />
            ) : agent && !running ? (
              <AgentRailCard agent={agent} selected />
            ) : !agent ? (
              <div className="border-border text-muted-foreground rounded-lg border border-dashed px-3 py-4 text-sm">
                No agent yet.
              </div>
            ) : null}
          </div>
        </aside>

        {/* ---- Right detail panel ---- */}
        <section className="border-border bg-card min-w-0 flex-1 rounded-xl border">
          {isLoading ? (
            <div className="p-5">
              <Skeleton className="h-80 w-full rounded-lg" />
            </div>
          ) : !agent || showWizard ? (
            <div className="p-5">
              {canManage ? (
                <AgentSetupWizard
                  onCancel={agent ? () => setShowWizard(false) : undefined}
                  onCreated={async () => {
                    await mutate();
                    setShowWizard(false);
                    setTab('overview');
                  }}
                />
              ) : (
                <p className="text-muted-foreground py-12 text-center text-sm">
                  The AI agent is not set up yet. Ask an admin to configure it.
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
                      {agent.displayName || DEFAULT_AGENT_NAME}
                    </h2>
                    <Badge
                      variant={running ? 'default' : 'secondary'}
                      className="rounded-full"
                    >
                      {statusLabel}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {configured
                      ? 'One agent, two jobs — drafts suggestions for your team and replies to customers automatically.'
                      : 'Connect a provider and API key to bring this agent online.'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-sm">
                    {agent.isEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <Switch
                    checked={agent.isEnabled}
                    disabled={!canManage || busyToggle !== null}
                    onCheckedChange={(next) =>
                      patchAgent(
                        { is_enabled: next },
                        `Agent ${next ? 'enabled' : 'disabled'}`
                      )
                    }
                    aria-label="Master agent switch"
                  />
                </div>
              </div>

              {/* Tabs */}
              <div
                role="tablist"
                aria-label="Agent sections"
                className="border-border mt-4 flex gap-1 overflow-x-auto border-b px-5"
              >
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    role="tab"
                    type="button"
                    aria-selected={tab === t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      'shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                      tab === t.key
                        ? 'border-primary text-foreground'
                        : 'text-muted-foreground hover:text-foreground border-transparent'
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="p-5">
                {tab === 'overview' && (
                  <OverviewTab
                    agent={agent}
                    canManage={canManage}
                    busyToggle={busyToggle}
                    onToggleCapability={(cap, next) =>
                      patchAgent(
                        { [CAPABILITY_META[cap].field === 'suggestionsEnabled' ? 'suggestions_enabled' : 'autoreply_enabled']: next },
                        `${CAPABILITY_META[cap].name} ${next ? 'on' : 'off'}`
                      )
                    }
                  />
                )}
                {tab === 'configuration' && (
                  <AgentSettingsForm
                    agent={agent}
                    canManage={canManage}
                    onSaved={() => mutate()}
                  />
                )}
                {tab === 'knowledge' && accountId && (
                  <AiKnowledgeCard
                    accountId={accountId}
                    canEdit={canManage}
                    hasEmbeddingsKey={agent.hasEmbeddingsKey}
                  />
                )}
                {tab === 'playground' && (
                  <AiPlayground onGoToSetup={() => setTab('configuration')} />
                )}
                {tab === 'activity' && <AgentActivity />}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AgentRailCard({
  agent,
  selected,
}: {
  agent: ClientAgent;
  selected?: boolean;
}) {
  const enabledCaps = CAPABILITY_ORDER.filter(
    (c) => agent[CAPABILITY_META[c].field]
  );
  return (
    <div
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left',
        selected
          ? 'border-primary/40 bg-card ring-primary/30 ring-1'
          : 'border-border bg-muted/40'
      )}
    >
      <span className="border-border bg-background flex size-8 shrink-0 items-center justify-center rounded-md border">
        <Bot className="text-muted-foreground size-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-foreground truncate text-sm font-medium">
          {agent.displayName || DEFAULT_AGENT_NAME}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {agent.provider && agent.model
            ? enabledCaps.length > 0
              ? enabledCaps.map((c) => CAPABILITY_META[c].name).join(' · ')
              : 'All capabilities off'
            : 'Not configured'}
        </span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function OverviewTab({
  agent,
  canManage,
  busyToggle,
  onToggleCapability,
}: {
  agent: ClientAgent;
  canManage: boolean;
  busyToggle: string | null;
  onToggleCapability: (cap: AgentCapability, next: boolean) => void;
}) {
  const configured = Boolean(agent.provider && agent.model);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Description card */}
        <div className="border-border bg-background rounded-xl border p-5">
          <p className="text-muted-foreground mb-3 text-[11px] font-medium tracking-wider uppercase">
            <span className="bg-primary mr-1.5 inline-block size-1.5 rounded-full align-middle" />
            Description
          </p>
          <p className="text-foreground text-sm leading-relaxed">
            Your business&apos;s AI assistant — a single agent that handles
            both jobs: drafting suggested replies your team approves inside
            the inbox, and answering customers automatically on WhatsApp
            using your knowledge base. Each capability can be switched on or
            off independently.
          </p>
        </div>

        {/* Status & Controls card */}
        <div className="border-border bg-background rounded-xl border p-5">
          <p className="text-muted-foreground mb-3 text-[11px] font-medium tracking-wider uppercase">
            <span className="bg-primary mr-1.5 inline-block size-1.5 rounded-full align-middle" />
            Status &amp; Controls
          </p>

          <div className="flex flex-col">
            {CAPABILITY_ORDER.map((cap) => {
              const meta = CAPABILITY_META[cap];
              const on = agent[meta.field];
              return (
                <div
                  key={cap}
                  className="border-border flex items-center justify-between gap-3 border-b py-3 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="text-foreground text-sm font-medium">
                      {meta.name}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {meta.tagline}
                    </p>
                  </div>
                  <Switch
                    checked={on}
                    disabled={!canManage || !configured || busyToggle !== null}
                    onCheckedChange={(next) => onToggleCapability(cap, next)}
                    aria-label={`Toggle ${meta.name}`}
                  />
                </div>
              );
            })}

            <div className="border-border flex items-center justify-between border-b py-3">
              <span className="text-muted-foreground text-sm">Provider</span>
              <span className="text-foreground text-sm font-medium">
                {agent.provider ? providerLabel(agent.provider) : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between pt-3">
              <span className="text-muted-foreground text-sm">Model</span>
              <span className="text-foreground text-sm font-medium">
                {agent.model ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {!configured && (
        <p className="text-muted-foreground text-xs">
          Finish setup in the Configuration tab to enable the capabilities
          above.
        </p>
      )}
    </div>
  );
}
