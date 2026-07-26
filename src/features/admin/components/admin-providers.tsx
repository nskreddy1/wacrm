'use client';

// ============================================================
// /admin/providers — platform provider control room.
//
// Design (emil-design-eng): crisp and fast. A KPI strip that
// reads at a glance, a segmented tab bar with a sliding
// indicator (transition, not keyframes — interruptible), rows
// that stagger in under 50ms steps, and one-line hints instead
// of paragraphs. Motion respects prefers-reduced-motion.
//
// Sections:
//   Catalog     — provider × channel availability switches.
//   Connections — tenant fleet, masked identities, health.
//   Activity    — 14-day traffic per channel + failure feed.
//   Consent     — the operator/tenant visibility contract.
// ============================================================

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  CircleCheck,
  CircleDashed,
  CircleX,
  Mail,
  MessageSquareText,
  Phone,
  ShieldCheck,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { ChartLegend, ChartTooltipContent } from '@/components/ui/chart';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { ChannelKind, ChannelProvider } from '@/types';

interface CatalogEntry {
  provider: ChannelProvider;
  channel: ChannelKind;
  label: string;
  implemented: boolean;
  isEnabled: boolean;
  notes: string | null;
  updatedAt: string | null;
  usage: { total: number; active: number; degraded: number };
}

interface FleetRow {
  id: string;
  accountId: string;
  accountName: string;
  channel: ChannelKind;
  provider: ChannelProvider;
  providerLabel: string;
  displayName: string;
  maskedIdentity: string;
  status: string;
  isEnabled: boolean;
  isPrimary: boolean;
  managedBy: string;
  lastConnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

interface ActivityDay {
  day: string;
  whatsapp: number;
  sms: number;
  email: number;
  failed: number;
}

type SectionId = 'catalog' | 'connections' | 'activity' | 'consent';

const TABS: { id: SectionId; label: string }[] = [
  { id: 'catalog', label: 'Catalog' },
  { id: 'connections', label: 'Connections' },
  { id: 'activity', label: 'Activity' },
  { id: 'consent', label: 'Consent' },
];

const CHANNEL_META: Record<ChannelKind, { label: string; icon: typeof Mail }> =
  {
    whatsapp: { label: 'WhatsApp', icon: MessageSquareText },
    sms: { label: 'SMS', icon: Phone },
    email: { label: 'Email', icon: Mail },
  };

const CHART_SERIES = [
  { key: 'whatsapp', label: 'WhatsApp', color: 'var(--chart-1)' },
  { key: 'sms', label: 'SMS', color: 'var(--chart-2)' },
  { key: 'email', label: 'Email', color: 'var(--chart-3)' },
] as const;

const CHART_LABELS: Record<string, string> = Object.fromEntries(
  CHART_SERIES.map((s) => [s.key, s.label])
);

const fetcher = (url: string) =>
  fetch(url).then(async (res) => {
    if (!res.ok) throw new Error('Failed to load providers');
    return res.json() as Promise<{
      catalog: CatalogEntry[];
      fleet: FleetRow[];
      activity: ActivityDay[];
    }>;
  });

function StatusDot({ status, enabled }: { status: string; enabled: boolean }) {
  if (status === 'connected' && enabled)
    return <CircleCheck className="size-4 text-emerald-500" aria-hidden />;
  if (status === 'degraded')
    return <CircleX className="text-destructive size-4" aria-hidden />;
  return <CircleDashed className="text-muted-foreground size-4" aria-hidden />;
}

/** Staggered row entrance; decorative only, removed under reduced motion. */
function rowStagger(index: number) {
  return {
    className:
      'animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-200 motion-reduce:animate-none',
    style: { animationDelay: `${Math.min(index, 8) * 40}ms` },
  };
}

export function AdminProviders() {
  const { data, isLoading, mutate } = useSWR('/api/admin/providers', fetcher, {
    revalidateOnFocus: false,
  });
  const [section, setSection] = useState<SectionId>('catalog');
  const [fleetQuery, setFleetQuery] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const catalogByChannel = useMemo(() => {
    const groups: Record<string, CatalogEntry[]> = {};
    for (const entry of data?.catalog ?? []) {
      (groups[entry.channel] ??= []).push(entry);
    }
    return groups;
  }, [data?.catalog]);

  const fleet = useMemo(() => {
    const rows = data?.fleet ?? [];
    const q = fleetQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (row) =>
        row.accountName.toLowerCase().includes(q) ||
        row.providerLabel.toLowerCase().includes(q) ||
        row.channel.includes(q) ||
        row.displayName.toLowerCase().includes(q)
    );
  }, [data?.fleet, fleetQuery]);

  const errorFeed = useMemo(
    () =>
      (data?.fleet ?? [])
        .filter((row) => row.lastError)
        .slice(0, 8),
    [data?.fleet]
  );

  const kpis = useMemo(() => {
    const catalog = data?.catalog ?? [];
    const rows = data?.fleet ?? [];
    const activity = data?.activity ?? [];
    return {
      offered: catalog.filter((e) => e.isEnabled && e.implemented).length,
      connections: rows.length,
      degraded: rows.filter((r) => r.status === 'degraded').length,
      traffic14d: activity.reduce(
        (sum, d) => sum + d.whatsapp + d.sms + d.email,
        0
      ),
      failed14d: activity.reduce((sum, d) => sum + d.failed, 0),
    };
  }, [data]);

  const togglePolicy = async (entry: CatalogEntry, next: boolean) => {
    const key = `${entry.provider}|${entry.channel}`;
    setSavingKey(key);
    try {
      const res = await fetch('/api/admin/providers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: entry.provider,
          channel: entry.channel,
          isEnabled: next,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(body?.error ?? 'Could not update the provider policy.');
        return;
      }
      toast.success(
        next
          ? `${entry.label} is now offered for ${CHANNEL_META[entry.channel].label}.`
          : `${entry.label} withdrawn for ${CHANNEL_META[entry.channel].label}.`
      );
      await mutate();
    } finally {
      setSavingKey(null);
    }
  };

  const activeIndex = TABS.findIndex((t) => t.id === section);

  return (
    <div className="flex flex-col gap-5">
      {/* ---------- KPI strip ---------- */}
      <dl className="@lg/console:grid-cols-3 @3xl/console:grid-cols-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
        {(
          [
            ['Offered', kpis.offered, false],
            ['Connections', kpis.connections, false],
            ['Degraded', kpis.degraded, kpis.degraded > 0],
            ['Messages · 14d', kpis.traffic14d, false],
            ['Failed · 14d', kpis.failed14d, kpis.failed14d > 0],
          ] as [string, number, boolean][]
        ).map(([label, value, alert]) => (
          <div key={label} className="bg-card flex flex-col gap-0.5 px-4 py-3">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd
              className={cn(
                'text-lg font-semibold tabular-nums tracking-tight',
                alert && 'text-destructive'
              )}
            >
              {isLoading ? '—' : value.toLocaleString()}
            </dd>
          </div>
        ))}
      </dl>

      {/* ---------- Segmented tabs with sliding indicator ---------- */}
      <div
        role="tablist"
        aria-label="Provider sections"
        className="bg-muted relative grid w-full max-w-md grid-cols-4 rounded-lg p-1"
      >
        <span
          aria-hidden
          className="bg-background absolute inset-y-1 left-1 w-[calc(25%-2px)] rounded-md shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(${activeIndex * 100}%)` }}
        />
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={section === tab.id}
            onClick={() => setSection(tab.id)}
            className={cn(
              'relative z-10 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-150',
              section === tab.id
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ---------- Catalog ---------- */}
      {section === 'catalog' ? (
        <section aria-label="Provider catalog">
          <p className="text-muted-foreground mb-3 text-sm">
            Off stops new connections. Existing ones keep working.
          </p>
          <div className="@3xl/console:grid-cols-2 @6xl/console:grid-cols-3 grid gap-4">
            {(['whatsapp', 'sms', 'email'] as ChannelKind[]).map(
              (channel, channelIndex) => {
                const entries = catalogByChannel[channel] ?? [];
                const meta = CHANNEL_META[channel];
                const Icon = meta.icon;
                return (
                  <div
                    key={channel}
                    style={rowStagger(channelIndex).style}
                    className={cn(
                      'bg-card flex flex-col rounded-lg border',
                      rowStagger(channelIndex).className
                    )}
                  >
                    <div className="border-border flex items-center gap-2 border-b px-4 py-3">
                      <Icon
                        className="text-muted-foreground size-4"
                        aria-hidden
                      />
                      <h3 className="text-sm font-medium">{meta.label}</h3>
                      <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                        {entries.filter((e) => e.isEnabled && e.implemented)
                          .length}
                        /{entries.length}
                      </span>
                    </div>
                    <ul className="flex flex-col">
                      {isLoading && entries.length === 0 ? (
                        <li className="text-muted-foreground px-4 py-6 text-sm">
                          Loading…
                        </li>
                      ) : (
                        entries.map((entry) => {
                          const key = `${entry.provider}|${entry.channel}`;
                          return (
                            <li
                              key={key}
                              className="border-border flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-sm font-medium">
                                    {entry.label}
                                  </span>
                                  {!entry.implemented ? (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px]"
                                    >
                                      Coming soon
                                    </Badge>
                                  ) : null}
                                </div>
                                <p className="text-muted-foreground text-xs tabular-nums">
                                  {entry.usage.total} connected ·{' '}
                                  {entry.usage.active} active
                                  {entry.usage.degraded > 0 ? (
                                    <span className="text-destructive">
                                      {' '}
                                      · {entry.usage.degraded} degraded
                                    </span>
                                  ) : null}
                                </p>
                              </div>
                              <Switch
                                checked={entry.isEnabled && entry.implemented}
                                disabled={
                                  !entry.implemented || savingKey === key
                                }
                                onCheckedChange={(next) =>
                                  togglePolicy(entry, next)
                                }
                                aria-label={`Offer ${entry.label} for ${meta.label}`}
                              />
                            </li>
                          );
                        })
                      )}
                    </ul>
                  </div>
                );
              }
            )}
          </div>
        </section>
      ) : null}

      {/* ---------- Connections ---------- */}
      {section === 'connections' ? (
        <section aria-label="Workspace connections">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              value={fleetQuery}
              onChange={(event) => setFleetQuery(event.target.value)}
              placeholder="Filter by workspace, provider, or channel"
              aria-label="Filter tenant connections"
              className="h-8 max-w-sm"
            />
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <ShieldCheck className="size-3" aria-hidden />
              Identities masked
            </Badge>
          </div>

          <div className="bg-card overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Sender</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Managed by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-muted-foreground py-8 text-center text-sm"
                    >
                      Loading connections…
                    </TableCell>
                  </TableRow>
                ) : fleet.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-muted-foreground py-8 text-center text-sm"
                    >
                      {fleetQuery
                        ? 'No connections match this filter.'
                        : 'No workspace has connected a channel yet.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  fleet.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="max-w-44 truncate font-medium">
                        {row.accountName}
                      </TableCell>
                      <TableCell>
                        {CHANNEL_META[row.channel]?.label ?? row.channel}
                      </TableCell>
                      <TableCell>{row.providerLabel}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">
                        {row.maskedIdentity}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          <StatusDot
                            status={row.status}
                            enabled={row.isEnabled}
                          />
                          <span
                            className={cn(
                              'text-xs capitalize',
                              row.status === 'degraded' && 'text-destructive'
                            )}
                          >
                            {row.status === 'connected' && !row.isEnabled
                              ? 'disabled'
                              : row.status}
                          </span>
                          {row.isPrimary ? (
                            <Badge variant="outline" className="text-[10px]">
                              Primary
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            row.managedBy === 'platform'
                              ? 'default'
                              : 'secondary'
                          }
                          className="text-[10px] capitalize"
                        >
                          {row.managedBy}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {!isLoading && fleet.length > 0 ? (
            <p className="text-muted-foreground mt-2 text-xs tabular-nums">
              {fleet.length} connection{fleet.length === 1 ? '' : 's'}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* ---------- Activity ---------- */}
      {section === 'activity' ? (
        <section aria-label="Provider activity" className="flex flex-col gap-4">
          <div className="bg-card rounded-lg border p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-medium">Messages by channel</h3>
              <span className="text-muted-foreground text-xs">
                Last 14 days · UTC
              </span>
            </div>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data?.activity ?? []} accessibilityLayer>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: string) => value.slice(5)}
                    fontSize={11}
                  />
                  <YAxis
                    width={32}
                    tickLine={false}
                    axisLine={false}
                    fontSize={11}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
                    content={<ChartTooltipContent labels={CHART_LABELS} />}
                  />
                  {CHART_SERIES.map((series, index) => (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      stackId="traffic"
                      fill={series.color}
                      radius={
                        index === CHART_SERIES.length - 1
                          ? [2, 2, 0, 0]
                          : [0, 0, 0, 0]
                      }
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ChartLegend
              className="mt-2"
              items={CHART_SERIES.map((s) => ({
                label: s.label,
                color: s.color,
              }))}
            />
          </div>

          <div className="bg-card rounded-lg border">
            <div className="border-border flex items-center justify-between border-b px-4 py-3">
              <h3 className="text-sm font-medium">Recent connection errors</h3>
              <span className="text-muted-foreground text-xs tabular-nums">
                {errorFeed.length} shown
              </span>
            </div>
            {errorFeed.length === 0 ? (
              <p className="text-muted-foreground px-4 py-6 text-sm">
                No connection errors on record.
              </p>
            ) : (
              <ul className="flex flex-col">
                {errorFeed.map((row, index) => (
                  <li
                    key={row.id}
                    style={rowStagger(index).style}
                    className={cn(
                      'border-border flex items-start gap-3 border-b px-4 py-3 last:border-b-0',
                      rowStagger(index).className
                    )}
                  >
                    <CircleX
                      className="text-destructive mt-0.5 size-4 shrink-0"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {row.accountName} · {row.providerLabel} (
                        {CHANNEL_META[row.channel]?.label ?? row.channel})
                      </p>
                      <p className="text-muted-foreground truncate text-xs">
                        {row.lastError}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      {/* ---------- Consent ---------- */}
      {section === 'consent' ? (
        <section
          aria-label="Consent and audit"
          className="@2xl/console:grid-cols-2 grid gap-4"
        >
          <div className="bg-card rounded-lg border p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <CircleCheck className="size-4 text-emerald-500" aria-hidden />
              Operators can see
            </h3>
            <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
              <li>Which providers each workspace connected</li>
              <li>Connection health and last error</li>
              <li>Masked sender identities</li>
              <li>Who manages each connection</li>
            </ul>
          </div>
          <div className="bg-card rounded-lg border p-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
              <CircleX className="text-destructive size-4" aria-hidden />
              Operators can never see
            </h3>
            <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
              <li>Credentials, tokens, or API keys</li>
              <li>Full sender addresses or numbers</li>
              <li>Message content of any workspace</li>
              <li>Anything outside the audit trail</li>
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}
