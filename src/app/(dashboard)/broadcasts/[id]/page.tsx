'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Broadcast, BroadcastRecipient, RecipientStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ArrowLeft, CheckCheck, ChevronDown, Download, Eye, Filter, Loader2, MessageCircle, MessageSquare, Send, Trash2, Users, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { getBroadcastStatus, getRecipientStatus } from '@/lib/broadcast-status';
import { PageContainer } from '@/components/layout/page-container';

const RECIPIENT_STATUSES: readonly RecipientStatus[] = ['pending', 'sent', 'delivered', 'read', 'replied', 'failed'];

function percent(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

function toCsv(rows: string[][]) {
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return rows.map((row) => row.map(escape).join(',')).join('\n');
}

function downloadBlob(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function BroadcastDetailPage() {
  const params = useParams();
  const router = useRouter();
  const broadcastId = params.id as string;
  const [broadcast, setBroadcast] = useState<Broadcast | null>(null);
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RecipientStatus | 'all'>('all');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const supabase = createClient();
        const [broadcastResult, recipientsResult] = await Promise.all([
          supabase.from('broadcasts').select('*').eq('id', broadcastId).single(),
          supabase.from('broadcast_recipients').select('*, contact:contacts(*)').eq('broadcast_id', broadcastId).order('created_at', { ascending: false }),
        ]);
        if (broadcastResult.error) throw broadcastResult.error;
        if (recipientsResult.error) throw recipientsResult.error;
        if (!cancelled) {
          setBroadcast(broadcastResult.data);
          setRecipients(recipientsResult.data ?? []);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Broadcast not found');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [broadcastId]);

  const filteredRecipients = useMemo(() => statusFilter === 'all' ? recipients : recipients.filter((recipient) => recipient.status === statusFilter), [recipients, statusFilter]);

  function handleExport() {
    if (!broadcast) return;
    const rows = recipients.map((recipient) => [recipient.contact?.name ?? '', recipient.contact?.phone ?? '', recipient.status, recipient.sent_at ?? '', recipient.delivered_at ?? '', recipient.read_at ?? '', recipient.error_message ?? '']);
    downloadBlob(`broadcast-${broadcast.name.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase()}-${broadcastId.slice(0, 8)}.csv`, toCsv([['Contact', 'Phone', 'Status', 'Sent', 'Delivered', 'Read', 'Error'], ...rows]));
  }

  async function handleDelete() {
    setDeleting(true);
    const { error: deleteError } = await createClient().from('broadcasts').delete().eq('id', broadcastId);
    setDeleting(false);
    if (deleteError) {
      toast.error(`Could not delete broadcast: ${deleteError.message}`);
      return;
    }
    toast.success('Broadcast deleted');
    router.push('/broadcasts');
  }

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="size-6 animate-spin text-primary" /><span className="sr-only">Loading report</span></div>;
  if (error || !broadcast) return <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center"><XCircle className="size-8 text-destructive" /><div><h1 className="font-medium text-foreground">Broadcast unavailable</h1><p className="mt-1 text-sm text-muted-foreground">{error ?? 'This broadcast could not be found.'}</p></div><Button variant="outline" onClick={() => router.push('/broadcasts')}>Back to broadcasts</Button></div>;

  const status = getBroadcastStatus(broadcast.status);
  const isSms = (broadcast.channel ?? 'whatsapp') === 'sms';
  const deliveredRate = percent(broadcast.delivered_count, broadcast.total_recipients);
  const readRate = percent(broadcast.read_count, broadcast.delivered_count);
  const replyRate = percent(broadcast.replied_count, broadcast.delivered_count);
  const metrics = isSms
    ? [
        { label: 'Recipients', value: broadcast.total_recipients, rate: 100, icon: Users },
        { label: 'Sent to carrier', value: broadcast.sent_count, rate: percent(broadcast.sent_count, broadcast.total_recipients), icon: Send },
        { label: 'Carrier delivered', value: broadcast.delivered_count, rate: deliveredRate, icon: CheckCheck },
        { label: 'Failed', value: broadcast.failed_count, rate: percent(broadcast.failed_count, broadcast.total_recipients), icon: XCircle },
      ]
    : [
        { label: 'Recipients', value: broadcast.total_recipients, rate: 100, icon: Users },
        { label: 'Sent', value: broadcast.sent_count, rate: percent(broadcast.sent_count, broadcast.total_recipients), icon: Send },
        { label: 'Delivered', value: broadcast.delivered_count, rate: deliveredRate, icon: CheckCheck },
        { label: 'Read', value: broadcast.read_count, rate: readRate, icon: Eye },
        { label: 'Replied', value: broadcast.replied_count, rate: replyRate, icon: MessageCircle },
      ];

  return (
    <PageContainer className="gap-8">
      <header className="flex flex-col gap-5 border-b border-border pb-7 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/broadcasts')} aria-label="Back to broadcasts"><ArrowLeft /></Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{broadcast.name}</h1><Badge variant="secondary">{status.label}</Badge></div>
            <p className="mt-2 text-sm text-muted-foreground">{broadcast.template_name} · {(broadcast.channel ?? 'whatsapp').toUpperCase()} · Created {new Date(broadcast.created_at).toLocaleDateString()}</p>
          </div>
        </div>
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2"><span className="px-2 text-sm text-foreground">Delete permanently?</span><Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button><Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>{deleting && <Loader2 data-icon="inline-start" className="animate-spin" />}Delete</Button></div>
        ) : <Button variant="outline" onClick={() => setConfirmDelete(true)} disabled={broadcast.status === 'sending'}><Trash2 data-icon="inline-start" />Delete</Button>}
      </header>

      <section className="grid overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[1.15fr_0.85fr]">
        <div className="flex flex-col gap-6 border-b border-border p-5 sm:p-7 lg:border-b-0 lg:border-r">
          <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{isSms ? 'SMS carrier outcome' : 'WhatsApp engagement'}</p><div className="mt-3 flex items-end gap-3"><span className="text-5xl font-semibold tabular-nums tracking-tight text-foreground">{deliveredRate}%</span><span className="pb-1 text-sm text-muted-foreground">delivered</span></div></div><div className={isSms ? 'flex size-11 items-center justify-center rounded-full border border-border bg-background text-muted-foreground' : 'flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary'}>{isSms ? <MessageSquare className="size-5" /> : <CheckCheck className="size-5" />}</div></div>
          <div className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${deliveredRate}%` }} /></div>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">{broadcast.delivered_count.toLocaleString()} of {broadcast.total_recipients.toLocaleString()} recipients {isSms ? 'were confirmed delivered by the carrier.' : 'received this WhatsApp message.'} {broadcast.failed_count ? `${broadcast.failed_count.toLocaleString()} deliveries need attention.` : 'No delivery failures were recorded.'}</p>
          {!isSms && <div className="flex flex-wrap gap-2"><Badge variant="secondary">{readRate}% read after delivery</Badge><Badge variant="secondary">{replyRate}% replied after delivery</Badge></div>}
        </div>
        <div className={isSms ? 'grid grid-cols-3 gap-px bg-border' : 'grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-2'}>
          {metrics.slice(1).map((metric) => <div key={metric.label} className="bg-card p-5"><div className="flex items-center justify-between"><metric.icon className="size-4 text-muted-foreground" /><span className="text-xs tabular-nums text-muted-foreground">{metric.rate}%</span></div><p className="mt-5 text-2xl font-semibold tabular-nums text-foreground">{metric.value.toLocaleString()}</p><p className="text-xs text-muted-foreground">{metric.label}</p></div>)}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-4 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-medium text-foreground">Recipient activity</h2><p className="text-xs text-muted-foreground">{filteredRecipients.length} of {recipients.length} recipients shown</p></div>
          <div className="flex flex-wrap gap-2">
            <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="sm" />}><Filter data-icon="inline-start" />{statusFilter === 'all' ? 'All statuses' : getRecipientStatus(statusFilter).label}<ChevronDown data-icon="inline-end" /></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuGroup><DropdownMenuItem onClick={() => setStatusFilter('all')}>All statuses</DropdownMenuItem>{RECIPIENT_STATUSES.map((value) => <DropdownMenuItem key={value} onClick={() => setStatusFilter(value)}>{getRecipientStatus(value).label}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={!recipients.length}><Download data-icon="inline-start" />Export CSV</Button>
          </div>
        </div>
        {filteredRecipients.length === 0 ? <div className="flex min-h-48 items-center justify-center p-6 text-sm text-muted-foreground">No recipients match this filter.</div> : (
          <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Contact</TableHead><TableHead>Phone</TableHead><TableHead>Status</TableHead><TableHead>Timeline</TableHead><TableHead>Issue</TableHead></TableRow></TableHeader><TableBody>{filteredRecipients.map((recipient) => { const recipientStatus = getRecipientStatus(recipient.status); const latestTime = recipient.read_at ?? recipient.delivered_at ?? recipient.sent_at; return <TableRow key={recipient.id}><TableCell className="font-medium text-foreground">{recipient.contact?.name ?? 'Unknown contact'}</TableCell><TableCell className="text-muted-foreground">{recipient.contact?.phone ?? '—'}</TableCell><TableCell><Badge variant="secondary">{recipientStatus.label}</Badge></TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{latestTime ? new Date(latestTime).toLocaleString() : 'Not sent'}</TableCell><TableCell className="max-w-sm truncate text-destructive">{recipient.error_message ?? '—'}</TableCell></TableRow>; })}</TableBody></Table></div>
        )}
      </section>
    </PageContainer>
  );
}
