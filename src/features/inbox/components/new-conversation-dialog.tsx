'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageSquarePlus, Search, UserRound } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import {
  contactBlockReason,
  matchesContactQuery,
  type ContactBlockReason,
  type ContactCandidate,
} from '../lib/new-conversation';

/**
 * "New message" — pick a contact, open their thread.
 *
 * ADR-006 D13/D14. This dialog deliberately does NOT send anything. A
 * business-initiated conversation always starts with the 24-hour window
 * shut (the contact has never written), so the thread it opens is
 * template-only and the message composer enforces that from server
 * truth. Sending here as well would mean two send paths and two places
 * to get the window rule wrong.
 *
 * So the job is small and honest: find a contact, create-or-reuse their
 * conversation, hand the id back to the workspace, and let the thread
 * take over.
 */

/** How many contacts to pull for local filtering. */
const CONTACT_PAGE_SIZE = 200;

interface NewConversationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the conversation id once the thread is ready to select. */
  onConversationReady: (conversationId: string) => void;
}

/** Copy for a contact the picker refuses, keyed by reason. */
const BLOCK_LABEL: Record<ContactBlockReason, string> = {
  opted_out: 'Unsubscribed',
  no_phone: 'No phone number',
};

function initialsOf(contact: ContactCandidate): string {
  const source = contact.name?.trim() || contact.phone?.trim() || '';
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function NewConversationDialog({
  open,
  onOpenChange,
  onConversationReady,
}: NewConversationDialogProps) {
  const [contacts, setContacts] = useState<ContactCandidate[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** Contact id currently being opened, so only that row shows a spinner. */
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  // Ignore a resolved fetch/POST that belongs to a previous open of the
  // dialog — otherwise closing and reopening can land stale rows or
  // navigate to a conversation the agent no longer asked for.
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) return;

    const requestId = ++requestRef.current;

    // Every setState lives inside the async body: a synchronous setState
    // in an effect body cascades an extra render pass (and trips
    // react-hooks/set-state-in-effect). The loading flag is set on the
    // first microtask instead, which the spinner renders identically.
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const supabase = createClient();
        // RLS scopes this to the caller's account, so no explicit
        // account filter is needed (and adding one would be a lie about
        // where the boundary lives).
        const { data, error } = await supabase
          .from('contacts')
          .select('id, name, phone, email, whatsapp_opted_out')
          .order('name', { ascending: true, nullsFirst: false })
          .limit(CONTACT_PAGE_SIZE);

        if (requestRef.current !== requestId) return;

        if (error) {
          setLoadError('Could not load contacts. Please try again.');
          setContacts([]);
          return;
        }

        setContacts(
          (data ?? []).map((row) => ({
            id: row.id as string,
            name: row.name as string | null,
            phone: row.phone as string | null,
            email: row.email as string | null,
            whatsappOptedOut: row.whatsapp_opted_out as boolean | null,
          }))
        );
      } catch {
        if (requestRef.current !== requestId) return;
        setLoadError('Could not load contacts. Please try again.');
        setContacts([]);
      } finally {
        if (requestRef.current === requestId) setLoading(false);
      }
    })();
  }, [open]);

  // Reset transient state when the dialog closes so reopening is a clean
  // slate. Adjusted during render (the React-documented pattern) rather
  // than in an effect: an effect would paint the stale query/error for one
  // frame on reopen and cascade a second render.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setQuery('');
      setOpeningId(null);
      setOpenError(null);
    }
  }

  const visible = useMemo(
    () => contacts.filter((c) => matchesContactQuery(c, query)),
    [contacts, query]
  );

  const handleSelect = useCallback(
    async (contact: ContactCandidate) => {
      if (contactBlockReason(contact)) return;
      if (openingId) return;

      const requestId = requestRef.current;
      setOpeningId(contact.id);
      setOpenError(null);

      try {
        const res = await fetch('/api/inbox/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_id: contact.id }),
        });
        const body = (await res.json().catch(() => null)) as
          | { conversation_id?: string; error?: string }
          | null;

        if (requestRef.current !== requestId) return;

        if (!res.ok || !body?.conversation_id) {
          setOpenError(
            body?.error ?? 'Could not open a conversation. Please try again.'
          );
          setOpeningId(null);
          return;
        }

        onConversationReady(body.conversation_id);
        onOpenChange(false);
      } catch {
        if (requestRef.current !== requestId) return;
        setOpenError('Could not open a conversation. Please try again.');
        setOpeningId(null);
      }
    },
    [onConversationReady, onOpenChange, openingId]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[32rem] flex-col gap-0 p-0 sm:max-w-md">
        <DialogHeader className="gap-1 border-b border-border px-5 py-4">
          <DialogTitle className="text-base">New message</DialogTitle>
          <DialogDescription>
            Pick a contact to open their conversation.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, phone, or email"
              aria-label="Search contacts"
              className="pl-9"
            />
          </div>
        </div>

        {openError ? (
          <p
            role="alert"
            className="border-b border-border bg-destructive/10 px-5 py-2 text-sm text-destructive"
          >
            {openError}
          </p>
        ) : null}

        <ScrollArea className="min-h-0 flex-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-muted-foreground">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Loading contacts…
            </div>
          ) : loadError ? (
            <p
              role="alert"
              className="px-5 py-10 text-center text-sm text-destructive"
            >
              {loadError}
            </p>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-1 px-5 py-10 text-center">
              <UserRound
                aria-hidden="true"
                className="size-5 text-muted-foreground"
              />
              <p className="text-sm font-medium text-foreground">
                {contacts.length === 0
                  ? 'No contacts yet'
                  : 'No matching contacts'}
              </p>
              <p className="text-sm text-muted-foreground">
                {contacts.length === 0
                  ? 'Add a contact to start a conversation.'
                  : 'Try a different name, phone, or email.'}
              </p>
            </div>
          ) : (
            <ul className="flex flex-col py-1">
              {visible.map((contact) => {
                const blocked = contactBlockReason(contact);
                const isOpening = openingId === contact.id;
                const busy = openingId !== null;

                return (
                  <li key={contact.id}>
                    <button
                      type="button"
                      disabled={Boolean(blocked) || busy}
                      onClick={() => handleSelect(contact)}
                      className={cn(
                        'flex w-full items-center gap-3 px-5 py-2.5 text-left',
                        'transition-[background-color,transform] duration-150 ease-out',
                        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:-inset-ring',
                        blocked
                          ? 'cursor-not-allowed opacity-55'
                          : 'hover:bg-accent active:scale-[0.99] disabled:opacity-60',
                        'motion-reduce:transition-none motion-reduce:active:scale-100'
                      )}
                    >
                      <Avatar className="size-9 shrink-0">
                        <AvatarFallback className="text-xs">
                          {initialsOf(contact)}
                        </AvatarFallback>
                      </Avatar>

                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-medium text-foreground">
                          {contact.name?.trim() ||
                            contact.phone ||
                            'Unnamed contact'}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">
                          {contact.phone || contact.email || 'No contact details'}
                        </span>
                      </span>

                      {isOpening ? (
                        <Loader2
                          aria-hidden="true"
                          className="size-4 shrink-0 animate-spin text-muted-foreground"
                        />
                      ) : blocked ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {BLOCK_LABEL[blocked]}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>

        <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          New conversations start with an approved template. You can reply
          freely for 24 hours after the contact writes back.
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** Trigger button for the dialog, so the inbox header stays declarative. */
export function NewConversationButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      onClick={onClick}
      aria-label="New message"
      className={cn('shrink-0', className)}
    >
      <MessageSquarePlus data-icon="inline-start" />
      New
    </Button>
  );
}
