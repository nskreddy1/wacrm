'use client';

// ============================================================
// /admin/providers — the platform's provider control room.
//
// Two disciplined sections:
//   1. Catalog — every provider × channel the platform can offer,
//      with a platform-wide availability switch, operator note and
//      live usage counts. Disabling stops NEW tenant connections;
//      existing ones keep working (no silent data loss).
//   2. Fleet — every tenant connection across all workspaces, with
//      sender identities masked server-side. Consent framing:
//      operators see existence + health, never credentials.
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

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

const CHANNEL_META: Record<
  ChannelKind,
  { label: string; icon: typeof Mail }
> = {
  whatsapp: { label: 'WhatsApp', icon: MessageSquareText },
  sms: { label: 'SMS', icon: Phone },
  email: { label: 'Email', icon: Mail },
};

const fetcher = (url: string) =>
  fetch(url).then(async (res) => {
    if (!res.ok) throw new Error('Failed to load providers');
    return res.json() as Promise<{ catalog: CatalogEntry[]; fleet: FleetRow[] }>;
  });

function StatusDot({ status, enabled }: { status: string; enabled: boolean }) {
  if (status === 'connected' && enabled)
    return <CircleCheck className="size-4 text-emerald-500" aria-hidden />;
  if (status === 'degraded')
    return <CircleX className="text-destructive size-4" aria-hidden />;
  return <CircleDashed className="text-muted-foreground size-4" aria-hidden />;
}

export function AdminProviders() {
  const { data, isLoading, mutate } = useSWR(
    '/api/admin/providers',
    fetcher,
    { revalidateOnFocus: false }
  );
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
          : `${entry.label} withdrawn for ${CHANNEL_META[entry.channel].label}. Existing connections keep working.`
      );
      await mutate();
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      {/* ---------- Section 1: Provider catalog ---------- */}
      <section aria-labelledby="provider-catalog-heading">
        <div className="mb-3 flex flex-col gap-1">
          <h2
            id="provider-catalog-heading"
            className="text-base font-semibold tracking-tight"
          >
            Provider catalog
          </h2>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            What the platform offers to every workspace, per channel. Turning
            a provider off stops new connections and new enables — existing
            tenant connections keep working until you retire them per
            workspace on the Channels tab.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {(['whatsapp', 'sms', 'email'] as ChannelKind[]).map((channel) => {
            const entries = catalogByChannel[channel] ?? [];
            const meta = CHANNEL_META[channel];
            const Icon = meta.icon;
            return (
              <div
                key={channel}
                className="bg-card flex flex-col rounded-lg border"
              >
                <div className="border-border flex items-center gap-2 border-b px-4 py-3">
                  <Icon className="text-muted-foreground size-4" aria-hidden />
                  <h3 className="text-sm font-medium">{meta.label}</h3>
                  <span className="text-muted-foreground ml-auto text-xs tabular-nums">
                    {entries.filter((e) => e.isEnabled && e.implemented).length}
                    /{entries.length} offered
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
          })}
        </div>
      </section>

      {/* ---------- Section 2: Tenant connections (fleet) ---------- */}
      <section aria-labelledby="fleet-heading">
        <div className="mb-3 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2
              id="fleet-heading"
              className="text-base font-semibold tracking-tight"
            >
              Tenant connections
            </h2>
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <ShieldCheck className="size-3" aria-hidden />
              Identities masked
            </Badge>
          </div>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            Every connection across all workspaces — existence and health
            only. Sender identities are masked and credentials never leave
            the server. To change a tenant&apos;s connection, use the
            Channels tab with that workspace selected; every change is
            audited.
          </p>
        </div>

        <div className="mb-3 max-w-sm">
          <Input
            value={fleetQuery}
            onChange={(event) => setFleetQuery(event.target.value)}
            placeholder="Filter by workspace, provider, or channel"
            aria-label="Filter tenant connections"
            className="h-8"
          />
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
                    <TableCell className="capitalize">
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
            {fleetQuery ? ' matching filter' : ' across all workspaces'}
          </p>
        ) : null}
      </section>

      <div className="text-muted-foreground flex items-start gap-2 rounded-lg border border-dashed px-4 py-3 text-xs">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <p className="text-pretty">
          Consent &amp; audit: this page shows connection existence and
          health, never credentials or message content. Provider policy
          changes and any per-workspace edits are written to the platform
          audit log with actor, before and after.
        </p>
      </div>
    </div>
  );
}
