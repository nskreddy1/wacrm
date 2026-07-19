'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { FeatureLoading, FeatureState } from '@/components/ui/feature-state';
import { useCan } from '@/hooks/use-can';
import { GatedButton } from '@/components/ui/gated-button';
import { getBroadcastStatus } from '@/lib/broadcast-status';
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

export default function BroadcastsPage() {
  const router = useRouter();
  const t = useTranslations('Broadcasts.page');
  const tStatus = useTranslations('Broadcasts.status');
  const canCreate = useCan('send-messages');
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchBroadcasts() {
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from('broadcasts')
        .select('*')
        .order('created_at', { ascending: false });
      if (fetchError) throw fetchError;
      setBroadcasts(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorLoad'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBroadcasts();
  }, []);

  const anySending = useMemo(
    () => broadcasts.some((broadcast) => broadcast.status === 'sending'),
    [broadcasts],
  );

  useEffect(() => {
    function stopPolling() {
      if (!pollTimer.current) return;
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
    function startPolling() {
      if (!pollTimer.current) {
        pollTimer.current = setInterval(fetchBroadcasts, POLL_INTERVAL_MS);
      }
    }
    function handleVisibilityChange() {
      if (!anySending) return;
      if (document.visibilityState === 'hidden') stopPolling();
      else {
        fetchBroadcasts();
        startPolling();
      }
    }
    if (anySending && document.visibilityState === 'visible') startPolling();
    else stopPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [anySending]);

  const filteredBroadcasts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return broadcasts;
    return broadcasts.filter((broadcast) =>
      [broadcast.name, broadcast.template_name, broadcast.channel, broadcast.status]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized)),
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
        { recipients: 0, sent: 0, delivered: 0 },
      ),
    [broadcasts],
  );

  if (loading) return <FeatureLoading label="Loading broadcast performance" />;
  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-6">
        <FeatureState
          icon={RefreshCw}
          title="Broadcasts are temporarily unavailable"
          description={`${error} Your campaign data is safe. Retry the connection without leaving this page.`}
          action={{ label: t('retry'), onClick: fetchBroadcasts }}
        />
      </div>
    );
  }

  return (
    <PageContainer className="gap-8">
      <header className="flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex max-w-2xl flex-col gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Radio className="size-4" aria-hidden="true" />
            Campaign operations
          </div>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-foreground">Broadcasts</h1>
          <p className="text-pretty text-sm leading-6 text-muted-foreground">
            Plan, send, and measure every customer message from one dependable workspace.
          </p>
        </div>
        <GatedButton canAct={canCreate} gateReason="create broadcasts" onClick={() => router.push('/broadcasts/new')}>
          <Plus data-icon="inline-start" />
          New broadcast
        </GatedButton>
      </header>

      {anySending && (
        <section className="flex items-center gap-4 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3" aria-live="polite">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Send className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">A broadcast is sending</p>
            <p className="text-xs text-muted-foreground">Delivery data refreshes automatically.</p>
          </div>
          <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
        </section>
      )}

      <section className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
        {[
          { label: 'Total reach', value: totals.recipients, icon: Users },
          { label: 'Messages sent', value: totals.sent, icon: Send },
          { label: 'Delivery rate', value: `${percent(totals.delivered, totals.sent)}%`, icon: BarChart3 },
        ].map((metric) => (
          <div key={metric.label} className="flex items-center gap-4 bg-card p-5">
            <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <metric.icon className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value}
              </p>
              <p className="text-xs text-muted-foreground">{metric.label}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-medium text-foreground">Campaign history</h2>
            <p className="text-xs text-muted-foreground">{broadcasts.length} broadcasts across every connected channel</p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search broadcasts" className="pl-9" aria-label="Search broadcasts" />
          </div>
        </div>

        {broadcasts.length === 0 ? (
          <div className="flex min-h-80 flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Radio className="size-6" /></div>
            <div className="flex max-w-sm flex-col gap-1"><h2 className="font-medium text-foreground">No broadcasts yet</h2><p className="text-sm leading-6 text-muted-foreground">Create your first campaign to reach contacts with an approved template.</p></div>
            <GatedButton canAct={canCreate} gateReason="create broadcasts" onClick={() => router.push('/broadcasts/new')}><Plus data-icon="inline-start" />New broadcast</GatedButton>
          </div>
        ) : filteredBroadcasts.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-2 p-8 text-center"><Search className="size-6 text-muted-foreground" /><p className="font-medium text-foreground">No matching broadcasts</p><Button variant="ghost" onClick={() => setQuery('')}>Clear search</Button></div>
        ) : (
          <div className="divide-y divide-border">
            {filteredBroadcasts.map((broadcast) => {
              const status = getBroadcastStatus(broadcast.status);
              const deliveryRate = percent(broadcast.delivered_count, broadcast.total_recipients);
              const ChannelIcon = (broadcast.channel ?? 'whatsapp') === 'sms' ? MessageSquare : MessageCircle;
              return (
                <button key={broadcast.id} type="button" onClick={() => router.push(`/broadcasts/${broadcast.id}`)} className="group flex w-full flex-col gap-4 p-4 text-left transition-colors duration-150 hover:bg-muted/50 sm:flex-row sm:items-center sm:p-5">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground"><ChannelIcon className="size-5" /></div>
                    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-medium text-foreground">{broadcast.name}</h3><Badge variant="outline" className="text-[10px] uppercase">{broadcast.channel ?? 'whatsapp'}</Badge></div><p className="mt-1 truncate text-xs text-muted-foreground">{broadcast.template_name} · {new Date(broadcast.created_at).toLocaleDateString()}</p></div>
                  </div>
                  <div className="grid grid-cols-2 gap-5 sm:w-64">
                    <div><p className="text-xs text-muted-foreground">Recipients</p><p className="mt-1 text-sm font-medium tabular-nums text-foreground">{broadcast.total_recipients.toLocaleString()}</p></div>
                    <div><div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">Delivered</span><span className="tabular-nums text-foreground">{deliveryRate}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${deliveryRate}%` }} /></div></div>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:w-40 sm:justify-end"><Badge variant="secondary">{tStatus(status.label)}</Badge><ArrowRight className="size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5" /></div>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </PageContainer>
  );
}
