'use client';

// ============================================================
// SupportTab — Settings → Support (user side of two-way ticketing).
//
// Master/detail in one panel:
//   • List view  — the account's tickets, newest activity first,
//                  with status/priority chips. "New ticket" opens
//                  the create dialog.
//   • Thread view — full conversation for a selected ticket with a
//                  reply box. The creator can close their own
//                  ticket; every other transition is admin-side.
//
// Data flows through SWR keyed on the API routes; mutations call
// the route then `mutate()` so the cache stays canonical (no
// hand-rolled client state to drift).
// ============================================================

import { useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  ArrowLeft,
  CheckCircle2,
  LifeBuoy,
  Loader2,
  Plus,
  Send,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/features/auth/hooks/use-auth';
import {
  SUBJECT_MAX,
  SUBJECT_MIN,
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  type SupportTicket,
  type SupportTicketMessage,
  type TicketCategory,
  type TicketPriority,
} from '@/features/support/lib/tickets';
import { cn } from '@/lib/utils';

import {
  CATEGORY_META,
  PRIORITY_META,
  STATUS_META,
  relTime,
} from '@/features/support/components/ticket-meta';
import { SettingsPanelHead } from './settings-panel-head';

const fetcher = async (url: string) => {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? 'Request failed');
  }
  return res.json();
};

type TicketRow = Omit<SupportTicket, 'account_id' | 'assigned_admin'>;

export function SupportTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const {
    data,
    isLoading,
    mutate: mutateList,
  } = useSWR<{ tickets: TicketRow[] }>('/api/support/tickets', fetcher);

  const tickets = data?.tickets ?? [];

  if (selectedId) {
    return (
      <TicketThread
        ticketId={selectedId}
        onBack={() => {
          setSelectedId(null);
          void mutateList();
        }}
      />
    );
  }

  return (
    <div>
      <SettingsPanelHead
        title="Support"
        description="Open a ticket and our team will get back to you here. Replies land in the thread — no email chains."
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New ticket
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : tickets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="bg-primary-soft flex size-11 items-center justify-center rounded-full">
              <LifeBuoy className="text-primary size-5" />
            </div>
            <div>
              <p className="text-foreground text-sm font-medium">
                No tickets yet
              </p>
              <p className="text-muted-foreground mt-1 text-sm text-pretty">
                Stuck on channel setup, billing or anything else? Open a ticket
                and we&apos;ll help you out.
              </p>
            </div>
            <Button variant="outline" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              Open your first ticket
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-border divide-y">
              {tickets.map((ticket) => {
                const status = STATUS_META[ticket.status];
                const priority = PRIORITY_META[ticket.priority];
                return (
                  <li key={ticket.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(ticket.id)}
                      className="hover:bg-muted/60 flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-sm font-medium">
                          {ticket.subject}
                        </p>
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {CATEGORY_META[ticket.category].label}
                          {' · updated '}
                          {relTime(ticket.updated_at)} ago
                        </p>
                      </div>
                      {ticket.priority !== 'normal' ? (
                        <Badge className={cn('shrink-0', priority.className)}>
                          {priority.label}
                        </Badge>
                      ) : null}
                      <Badge className={cn('shrink-0', status.className)}>
                        {status.label}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <CreateTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          void mutateList();
          setSelectedId(id);
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------------
// Create dialog
// ------------------------------------------------------------------

function CreateTicketDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (ticketId: string) => void;
}) {
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory>('technical');
  const [priority, setPriority] = useState<TicketPriority>('normal');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const valid =
    subject.trim().length >= SUBJECT_MIN &&
    subject.trim().length <= SUBJECT_MAX &&
    description.trim().length > 0;

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim(),
          category,
          priority,
          description: description.trim(),
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        ticket?: { id: string };
        error?: string;
      } | null;
      if (!res.ok || !body?.ticket) {
        throw new Error(body?.error ?? 'Failed to create ticket');
      }
      toast.success("Ticket created — we'll reply here.");
      setSubject('');
      setCategory('technical');
      setPriority('normal');
      setDescription('');
      onOpenChange(false);
      onCreated(body.ticket.id);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create ticket'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New support ticket</DialogTitle>
          <DialogDescription>
            Describe the problem and our team will follow up in the thread.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="ticket-subject">Subject</Label>
            <Input
              id="ticket-subject"
              value={subject}
              maxLength={SUBJECT_MAX}
              placeholder="Short summary of the issue"
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as TicketCategory)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CATEGORY_META[c].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Priority</Label>
              <Select
                value={priority}
                onValueChange={(v) => setPriority(v as TicketPriority)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {PRIORITY_META[p].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ticket-description">Description</Label>
            <Textarea
              id="ticket-description"
              value={description}
              rows={5}
              placeholder="What happened? Include any error messages or steps to reproduce."
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Create ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------
// Thread view
// ------------------------------------------------------------------

function TicketThread({
  ticketId,
  onBack,
}: {
  ticketId: string;
  onBack: () => void;
}) {
  const { user } = useAuth();
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);

  const { data, isLoading, mutate } = useSWR<{
    ticket: TicketRow;
    messages: SupportTicketMessage[];
  }>(`/api/support/tickets/${ticketId}`, fetcher, {
    refreshInterval: 15_000, // light polling keeps admin replies flowing in
  });

  const ticket = data?.ticket;
  const messages = data?.messages ?? [];
  const conversational =
    ticket && ticket.status !== 'resolved' && ticket.status !== 'closed';
  const isCreator = ticket && user ? ticket.created_by === user.id : false;

  const sendReply = async () => {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const payload = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) throw new Error(payload?.error ?? 'Failed to send');
      setReply('');
      await mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const closeTicket = async () => {
    if (closing) return;
    setClosing(true);
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'closed' }),
      });
      const payload = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!res.ok) throw new Error(payload?.error ?? 'Failed to close ticket');
      toast.success('Ticket closed');
      await mutate();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to close ticket'
      );
    } finally {
      setClosing(false);
    }
  };

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground mb-2 inline-flex items-center gap-1.5 text-sm font-medium transition-colors"
          >
            <ArrowLeft className="size-4" />
            All tickets
          </button>
          {ticket ? (
            <>
              <h2 className="text-foreground text-lg font-semibold tracking-tight text-balance">
                {ticket.subject}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge className={STATUS_META[ticket.status].className}>
                  {STATUS_META[ticket.status].label}
                </Badge>
                {ticket.priority !== 'normal' ? (
                  <Badge className={PRIORITY_META[ticket.priority].className}>
                    {PRIORITY_META[ticket.priority].label}
                  </Badge>
                ) : null}
                <span className="text-muted-foreground text-xs">
                  {CATEGORY_META[ticket.category].label}
                </span>
              </div>
            </>
          ) : null}
        </div>
        {ticket && conversational && isCreator ? (
          <Button
            variant="outline"
            size="sm"
            onClick={closeTicket}
            disabled={closing}
          >
            {closing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            Close ticket
          </Button>
        ) : null}
      </div>

      {isLoading && !data ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col gap-4 p-4 sm:p-5">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
                  m.is_admin_reply
                    ? 'border-border bg-muted/60 text-foreground self-start border'
                    : 'bg-primary-soft text-foreground self-end'
                )}
              >
                <p className="text-muted-foreground mb-1 text-[11px] font-semibold tracking-wide uppercase">
                  {m.is_admin_reply ? 'Support team' : (m.author_name ?? 'You')}
                  <span className="ml-2 font-normal tracking-normal normal-case">
                    {relTime(m.created_at)} ago
                  </span>
                </p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </div>
            ))}

            {conversational ? (
              <div className="border-border mt-2 flex items-end gap-2 border-t pt-4">
                <Textarea
                  value={reply}
                  rows={2}
                  placeholder="Write a reply…"
                  className="min-h-[44px] flex-1 resize-none"
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'Enter' &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing &&
                      e.keyCode !== 229
                    ) {
                      e.preventDefault();
                      void sendReply();
                    }
                  }}
                />
                <Button
                  size="icon"
                  onClick={sendReply}
                  disabled={!reply.trim() || sending}
                  aria-label="Send reply"
                >
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </div>
            ) : (
              <p className="border-border text-muted-foreground border-t pt-4 text-center text-sm">
                This ticket is{' '}
                {ticket?.status === 'resolved' ? 'resolved' : 'closed'}. Open a
                new ticket if you need more help.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
