'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { createClient } from '@/lib/supabase/client';
import { Broadcast } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { FeatureLoading, FeatureState } from '@/components/ui/feature-state';
import { useCan } from '@/features/auth/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { getBroadcastStatus } from '@/features/broadcasts/lib/broadcast-status';
import { useTranslations } from 'next-intl';
import { PageContainer } from '@/components/layout/page-container';
import {
  ArrowRight,
  BarChart3,
  MessageCircle,
  MessageSquare,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Send,
  Users,
} from 'lucide-react';

const POLL_INTERVAL_MS = 5_000;

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

async function fetchBroadcastList(): Promise<Broadcast[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('broadcasts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export default function BroadcastsPage() {
  const router = useRouter();
  const t = useTranslations('Broadcasts.page');
  const tStatus = useTranslations('Broadcasts.status');
  const canCreate = useCan('send-messages');
  const [query, setQuery] = useState('');

  // SWR owns fetch/error/polling state. refreshInterval only polls while a
  // broadcast is sending, and SWR pauses polling automatically when the tab
  // is hidden (refreshWhenHidden defaults to false) — replacing the previous
  // hand-rolled interval + visibilitychange bookkeeping.
  const {
    data,
    error: loadError,
    isLoading,
    mutate,
  } = useSWR('broadcasts', fetchBroadcastList, {
    refreshInterval: (latest) =>
      latest?.some((broadcast) => broadcast.status === 'sending')
        ? POLL_INTERVAL_MS
        : 0,
  });
  const broadcasts = useMemo(() => data ?? [], [data]);
  const error = loadError
    ? loadError instanceof Error
      ? loadError.message
      : t('errorLoad')
    : null;

  const anySending = useMemo(
    () => broadcasts.some((broadcast) => broadcast.status === 'sending'),
    [broadcasts]
  );

  const filteredBroadcasts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return broadcasts;
    return broadcasts.filter((broadcast) =>
      [
        broadcast.name,
        broadcast.template_name,
        broadcast.channel,
        broadcast.status,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized))
    );
  }, [broadcasts, query]);

  const totals = useMemo(
    () =>
      broadcasts.reduce(
        (summary, broadcast) => ({
          recipients: summary.recipients + broadcast.total_recipients,
          sent: summary.sent + broadcast.sent_count,
          delivered: summary.delivered + broadcast.delivered_count,
        }),
        { recipients: 0, sent: 0, delivered: 0 }
      ),
    [broadcasts]
  );

  if (isLoading)
    return <FeatureLoading label="Loading broadcast performance" />;
  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <FeatureState
          icon={RefreshCw}
          title="Broadcasts are temporarily unavailable"
          description={`${error} Your campaign data is safe. Retry the connection without leaving this page.`}
          action={{ label: t('retry'), onClick: () => mutate() }}
        />
      </div>
    );
  }

  return (
    <PageContainer className="gap-8">
      <header className="border-border flex flex-col gap-5 border-b pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex max-w-2xl flex-col gap-2">
          <div className="text-primary flex items-center gap-2 text-sm font-medium">
            <Radio className="size-4" aria-hidden="true" />
            Campaign operations
          </div>
          <h1 className="text-foreground text-3xl font-semibold tracking-tight text-balance">
            Broadcasts
          </h1>
          <p className="text-muted-foreground text-sm leading-6 text-pretty">
            Plan, send, and measure every customer message from one dependable
            workspace.
          </p>
        </div>
        <GatedButton
          canAct={canCreate}
          gateReason="create broadcasts"
          onClick={() => router.push('/broadcasts/new')}
        >
          <Plus data-icon="inline-start" />
          New broadcast
        </GatedButton>
      </header>

      {anySending && (
        <section
          className="border-primary/25 bg-primary/5 flex items-center gap-4 rounded-xl border px-4 py-3"
          aria-live="polite"
        >
          <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg">
            <Send className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm font-medium">
              A broadcast is sending
            </p>
            <p className="text-muted-foreground text-xs">
              Delivery data refreshes automatically.
            </p>
          </div>
          <span
            className="bg-primary size-2 animate-pulse rounded-full"
            aria-hidden="true"
          />
        </section>
      )}

      <section className="border-border bg-border grid gap-px overflow-hidden rounded-xl border sm:grid-cols-3">
        {[
          { label: 'Total reach', value: totals.recipients, icon: Users },
          { label: 'Messages sent', value: totals.sent, icon: Send },
          {
            label: 'Delivery rate',
            value: `${percent(totals.delivered, totals.sent)}%`,
            icon: BarChart3,
          },
        ].map((metric) => (
          <div
            key={metric.label}
            className="bg-card flex items-center gap-4 p-5"
          >
            <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-lg">
              <metric.icon className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-foreground text-2xl font-semibold tabular-nums">
                {typeof metric.value === 'number'
                  ? metric.value.toLocaleString()
                  : metric.value}
              </p>
              <p className="text-muted-foreground text-xs">{metric.label}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="border-border bg-card overflow-hidden rounded-xl border">
        <div className="border-border flex flex-col gap-4 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-foreground font-medium">Campaign history</h2>
            <p className="text-muted-foreground text-xs">
              {broadcasts.length} broadcasts across every connected channel
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search broadcasts"
              className="pl-9"
              aria-label="Search broadcasts"
            />
          </div>
        </div>

        {broadcasts.length === 0 ? (
          <div className="flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-xl">
              <Radio className="size-6" />
            </div>
            <div className="flex max-w-sm flex-col gap-1">
              <h2 className="text-foreground font-medium">No broadcasts yet</h2>
              <p className="text-muted-foreground text-sm leading-6">
                Create your first campaign to reach contacts with an approved
                template.
              </p>
            </div>
            <GatedButton
              canAct={canCreate}
              gateReason="create broadcasts"
              onClick={() => router.push('/broadcasts/new')}
            >
              <Plus data-icon="inline-start" />
              New broadcast
            </GatedButton>
          </div>
        ) : filteredBroadcasts.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-2 p-8 text-center">
            <Search className="text-muted-foreground size-6" />
            <p className="text-foreground font-medium">
              No matching broadcasts
            </p>
            <Button variant="ghost" onClick={() => setQuery('')}>
              Clear search
            </Button>
          </div>
        ) : (
          <div className="divide-border divide-y">
            {filteredBroadcasts.map((broadcast) => {
              const status = getBroadcastStatus(broadcast.status);
              const deliveryRate = percent(
                broadcast.delivered_count,
                broadcast.total_recipients
              );
              const readRate = percent(
                broadcast.read_count,
                broadcast.delivered_count
              );
              const replyRate = percent(
                broadcast.replied_count,
                broadcast.delivered_count
              );
              const isSms = (broadcast.channel ?? 'whatsapp') === 'sms';

              if (isSms) {
                return (
                  <button
                    key={broadcast.id}
                    type="button"
                    onClick={() => router.push(`/broadcasts/${broadcast.id}`)}
                    className="group hover:bg-muted/50 flex w-full flex-col gap-4 p-4 text-left transition-colors duration-150 sm:flex-row sm:items-center sm:p-5"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div className="border-border bg-background text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full border">
                        <MessageSquare className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-foreground truncate font-medium">
                            {broadcast.name}
                          </h3>
                          <Badge
                            variant="outline"
                            className="text-[10px] tracking-wider uppercase"
                          >
                            SMS
                          </Badge>
                        </div>
                        <p className="text-muted-foreground mt-1 truncate text-xs">
                          {broadcast.template_name} ·{' '}
                          {new Date(broadcast.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="border-border bg-background flex w-full items-center gap-5 rounded-lg border px-4 py-3 sm:w-80">
                      <div className="min-w-16">
                        <p className="text-muted-foreground text-xs">Sent</p>
                        <p className="text-foreground mt-0.5 font-medium tabular-nums">
                          {broadcast.sent_count.toLocaleString()}
                        </p>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            Carrier delivery
                          </span>
                          <span className="text-foreground font-medium tabular-nums">
                            {deliveryRate}%
                          </span>
                        </div>
                        <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
                          <div
                            className="bg-primary h-full rounded-full"
                            style={{ width: `${deliveryRate}%` }}
                          />
                        </div>
                      </div>
                      {broadcast.failed_count > 0 ? (
                        <div className="text-right">
                          <p className="text-muted-foreground text-xs">
                            Failed
                          </p>
                          <p className="text-destructive mt-0.5 font-medium tabular-nums">
                            {broadcast.failed_count}
                          </p>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:w-36 sm:justify-end">
                      <Badge variant="secondary">{tStatus(status.label)}</Badge>
                      <ArrowRight className="text-muted-foreground size-4 transition-transform duration-150 group-hover:translate-x-0.5" />
                    </div>
                  </button>
                );
              }

              return (
                <button
                  key={broadcast.id}
                  type="button"
                  onClick={() => router.push(`/broadcasts/${broadcast.id}`)}
                  className="group hover:bg-muted/50 flex w-full flex-col gap-4 p-4 text-left transition-colors duration-150 sm:p-5"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl">
                        <MessageCircle className="size-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-foreground truncate font-medium">
                            {broadcast.name}
                          </h3>
                          <Badge
                            variant="outline"
                            className="text-[10px] tracking-wider uppercase"
                          >
                            WhatsApp
                          </Badge>
                          <Badge variant="secondary">
                            {tStatus(status.label)}
                          </Badge>
                        </div>
                        <p className="text-muted-foreground mt-1 truncate text-xs">
                          {broadcast.template_name} ·{' '}
                          {new Date(broadcast.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="text-muted-foreground size-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" />
                  </div>
                  <div className="border-border bg-border grid gap-px overflow-hidden rounded-lg border sm:grid-cols-4">
                    {[
                      {
                        label: 'Recipients',
                        value: broadcast.total_recipients,
                        rate: 100,
                      },
                      {
                        label: 'Delivered',
                        value: broadcast.delivered_count,
                        rate: deliveryRate,
                      },
                      {
                        label: 'Read',
                        value: broadcast.read_count,
                        rate: readRate,
                      },
                      {
                        label: 'Replied',
                        value: broadcast.replied_count,
                        rate: replyRate,
                      },
                    ].map((metric) => (
                      <div
                        key={metric.label}
                        className="bg-background px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-muted-foreground text-xs">
                            {metric.label}
                          </span>
                          {metric.label !== 'Recipients' && (
                            <span className="text-muted-foreground text-[10px] tabular-nums">
                              {metric.rate}%
                            </span>
                          )}
                        </div>
                        <p className="text-foreground mt-1 text-lg font-semibold tabular-nums">
                          {metric.value.toLocaleString()}
                        </p>
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </PageContainer>
  );
}
