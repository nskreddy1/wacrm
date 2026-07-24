'use client';

// ============================================================
// AdminTickets — /admin/tickets (all-tenant support queue).
//
// Master/detail:
//   • Queue  — every tenant's tickets with status / priority /
//              category filters, SLA hint (time since the last
//              user message on tickets awaiting an admin).
//   • Thread — full conversation, reply box (reply marks
//              is_admin_reply and defaults status to
//              waiting_on_user), assign-to-me, status select.
//
// All data flows through SWR keyed on the admin API routes;
// mutations call the route then `mutate()` so the cache stays
// canonical — mirroring the user-side SupportTab.
// ============================================================

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Send, UserCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const STATUSES = [
  'open',
  'in_progress',
  'waiting_on_user',
  'resolved',
  'closed',
] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
const CATEGORIES = [
  'billing',
  'technical',
  'channel_setup',
  'agent_help',
  'other',
] as const;

type TicketStatus = (typeof STATUSES)[number];

interface TicketRow {
  id: string;
  account_id: string;
  subject: string;
  category: string;
  priority: string;
  status: TicketStatus;
  assigned_admin: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  account_name: string;
  created_by_name: string | null;
  last_user_message_at: string | null;
}

interface TicketMessage {
  id: string;
  ticket_id: string;
  author_id: string;
  is_admin_reply: boolean;
  body: string;
  created_at: string;
  author_name: string | null;
}

const jsonFetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? 'Request failed');
  return body;
};

const statusVariant: Record<
  TicketStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  open: 'default',
  in_progress: 'secondary',
  waiting_on_user: 'outline',
  resolved: 'secondary',
  closed: 'outline',
};

const priorityClass: Record<string, string> = {
  urgent: 'text-destructive font-semibold',
  high: 'font-semibold',
  normal: '',
  low: 'text-muted-foreground',
};

function label(value: string) {
  return value.replaceAll('_', ' ');
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60_000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AdminTickets() {
  const [status, setStatus] = useState<string>('all');
  const [priority, setPriority] = useState<string>('all');
  const [category, setCategory] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (priority !== 'all') params.set('priority', priority);
  if (category !== 'all') params.set('category', category);
  const qs = params.toString();
  const listKey = `/api/admin/tickets${qs ? `?${qs}` : ''}`;

  const { data, isLoading, mutate } = useSWR<{ tickets: TicketRow[] }>(
    listKey,
    jsonFetcher,
    { refreshInterval: 30_000 }
  );
  const tickets = data?.tickets ?? [];

  if (selectedId) {
    return (
      <TicketThread
        ticketId={selectedId}
        onBack={() => {
          setSelectedId(null);
          void mutate();
        }}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Support ticket queue">
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          label="Status"
          value={status}
          onChange={setStatus}
          options={STATUSES}
        />
        <FilterSelect
          label="Priority"
          value={priority}
          onChange={setPriority}
          options={PRIORITIES}
        />
        <FilterSelect
          label="Category"
          value={category}
          onChange={setCategory}
          options={CATEGORIES}
        />
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Subject</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Waiting</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : tickets.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-muted-foreground py-8 text-center"
                >
                  No tickets match these filters.
                </TableCell>
              </TableRow>
            ) : (
              tickets.map((t) => {
                // SLA hint: only meaningful while the ball is in the
                // admin's court and a user message exists.
                const awaitingAdmin =
                  (t.status === 'open' || t.status === 'in_progress') &&
                  t.last_user_message_at;
                return (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(t.id)}
                  >
                    <TableCell className="max-w-64">
                      <span className="grid leading-tight">
                        <span className="truncate font-medium">
                          {t.subject}
                        </span>
                        <span className="text-muted-foreground truncate text-xs">
                          {t.created_by_name ?? 'Unknown'} · {label(t.category)}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.account_name}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'capitalize',
                          priorityClass[t.priority] ?? ''
                        )}
                      >
                        {t.priority}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant[t.status]}>
                        {label(t.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {awaitingAdmin ? (
                        <span className="text-destructive text-sm">
                          {timeAgo(t.last_user_message_at!)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {timeAgo(t.updated_at)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function FilterSelect({
  label: name,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        if (v !== null) onChange(v);
      }}
    >
      <SelectTrigger className="w-40" aria-label={`Filter by ${name}`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {name.toLowerCase()}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o} className="capitalize">
            {label(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TicketThread({
  ticketId,
  onBack,
}: {
  ticketId: string;
  onBack: () => void;
}) {
  const key = `/api/admin/tickets/${ticketId}`;
  const { data, isLoading, mutate } = useSWR<{
    ticket: TicketRow;
    messages: TicketMessage[];
  }>(key, jsonFetcher, { refreshInterval: 15_000 });

  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);

  const ticket = data?.ticket;

  async function sendReply() {
    const body = reply.trim();
    if (!body) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? 'Failed to send reply');
      setReply('');
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSending(false);
    }
  }

  async function patchTicket(patch: { status?: string; assign?: 'me' | null }) {
    setUpdating(true);
    try {
      const res = await fetch(`/api/admin/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error ?? 'Failed to update the ticket');
      }
      await mutate();
      toast.success('Ticket updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setUpdating(false);
    }
  }

  return (
    <section className="flex flex-col gap-4" aria-label="Ticket conversation">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Queue
          </Button>
          <div className="grid leading-tight">
            <h2 className="truncate text-sm font-semibold text-balance">
              {ticket?.subject ?? 'Ticket'}
            </h2>
            {ticket && (
              <p className="text-muted-foreground text-xs">
                {ticket.account_name} · {ticket.created_by_name ?? 'Unknown'} ·{' '}
                {label(ticket.category)} ·{' '}
                <span className="capitalize">{ticket.priority}</span>
              </p>
            )}
          </div>
        </div>

        {ticket && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={updating}
              onClick={() =>
                void patchTicket({
                  assign: ticket.assigned_admin ? null : 'me',
                })
              }
            >
              <UserCheck className="size-4" aria-hidden="true" />
              {ticket.assigned_admin ? 'Unassign' : 'Assign to me'}
            </Button>
            <Select
              value={ticket.status}
              onValueChange={(v) => {
                if (v !== null) void patchTicket({ status: v });
              }}
              disabled={updating}
            >
              <SelectTrigger className="w-44" aria-label="Ticket status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">
                    {label(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border p-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-3/4" />
            <Skeleton className="ml-auto h-14 w-3/4" />
          </div>
        ) : (data?.messages ?? []).length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            No messages on this ticket yet.
          </p>
        ) : (
          data!.messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                'flex max-w-[85%] flex-col gap-1 rounded-lg p-3 text-sm',
                m.is_admin_reply
                  ? 'bg-primary text-primary-foreground self-end'
                  : 'bg-muted self-start'
              )}
            >
              <span
                className={cn(
                  'text-xs font-medium',
                  m.is_admin_reply
                    ? 'text-primary-foreground/80'
                    : 'text-muted-foreground'
                )}
              >
                {m.is_admin_reply ? 'Support' : (m.author_name ?? 'User')} ·{' '}
                {timeAgo(m.created_at)}
              </span>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </div>
          ))
        )}
      </div>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void sendReply();
        }}
      >
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Write a reply… (sending sets the ticket to waiting on user)"
          rows={3}
          className="flex-1"
          aria-label="Reply to ticket"
        />
        <Button type="submit" disabled={sending || reply.trim().length === 0}>
          {sending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-4" aria-hidden="true" />
          )}
          Reply
        </Button>
      </form>
    </section>
  );
}
