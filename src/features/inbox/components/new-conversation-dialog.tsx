'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  ChevronRight,
  Loader2,
  MessageSquarePlus,
  Search,
  UserRound,
  X,
} from 'lucide-react';
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

/** Ties the input's aria-activedescendant to the rendered rows. */
const OPTION_ID_PREFIX = 'new-conversation-contact-';
const LISTBOX_ID = 'new-conversation-contacts';

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
  /** Row the keyboard is on. Clamped at render, so it can never dangle. */
  const [activeIndex, setActiveIndex] = useState(0);

  // Ignore a resolved fetch/POST that belongs to a previous open of the
  // dialog — otherwise closing and reopening can land stale rows or
  // navigate to a conversation the agent no longer asked for.
  const requestRef = useRef(0);
  const listRef = useRef<HTMLUListElement>(null);

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
      setActiveIndex(0);
    }
  }

  const visible = useMemo(
    () => contacts.filter((c) => matchesContactQuery(c, query)),
    [contacts, query]
  );

  // Clamp rather than reset-on-change: filtering can shrink the list under
  // the cursor, and a stale index would point at a row that no longer
  // exists (aria-activedescendant pointing at a dead id).
  const active = visible.length === 0 ? -1 : Math.min(activeIndex, visible.length - 1);

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

  /** Step the cursor, skipping rows the picker refuses. */
  const moveActive = useCallback(
    (direction: 1 | -1) => {
      setActiveIndex((current) => {
        if (visible.length === 0) return current;
        const start = Math.min(current, visible.length - 1);
        let next = start;
        for (let step = 0; step < visible.length; step += 1) {
          next = (next + direction + visible.length) % visible.length;
          if (!contactBlockReason(visible[next])) return next;
        }
        return start;
      });
    },
    [visible]
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // A CJK IME uses Enter to confirm composition; Safari reports the final
    // composition keydown as 229. Selecting a contact there would fire while
    // the agent is still typing the name.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      void handleSelect(visible[active]);
    }
  };

  // Keep the keyboard cursor inside the scroll port.
  useEffect(() => {
    if (active < 0) return;
    listRef.current
      ?.querySelector(`#${OPTION_ID_PREFIX}${CSS.escape(visible[active].id)}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, visible]);

  const activeId =
    active >= 0 ? `${OPTION_ID_PREFIX}${visible[active].id}` : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-h is capped against the viewport too: on a short window a fixed
          32rem would run the footer off-screen. */}
      <DialogContent className="flex max-h-[min(34rem,calc(100dvh-4rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="gap-0 border-b border-border px-5 py-4 pr-14">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <MessageSquarePlus className="size-4.5" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <DialogTitle className="text-base">New message</DialogTitle>
              <DialogDescription className="text-xs">
                Pick a contact to open their conversation.
              </DialogDescription>
            </span>
          </div>
        </DialogHeader>

        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={LISTBOX_ID}
              aria-activedescendant={activeId}
              autoComplete="off"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search name, phone, or email"
              aria-label="Search contacts"
              className={cn('pl-9', query && 'pr-9')}
            />
            {query ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Clear search"
                onClick={() => {
                  setQuery('');
                  setActiveIndex(0);
                }}
                className="absolute top-1/2 right-1 -translate-y-1/2"
              >
                <X />
              </Button>
            ) : null}
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

        {/* Plain overflow container rather than <ScrollArea>: the Base UI
            viewport is `size-full`, so its `height:100%` can't resolve
            against a `flex-1` parent with no explicit height — it grows to
            full content height instead of scrolling, spilling rows past the
            dialog and painting the footer over them (same failure as the
            contacts import modal). */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-width:thin]">
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
              <span
                aria-hidden="true"
                className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted"
              >
                <UserRound className="size-5 text-muted-foreground" />
              </span>
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
            <ul
              ref={listRef}
              id={LISTBOX_ID}
              role="listbox"
              aria-label="Contacts"
              className="flex flex-col p-1.5"
            >
              {visible.map((contact, index) => {
                const blocked = contactBlockReason(contact);
                const isOpening = openingId === contact.id;
                const busy = openingId !== null;
                const isActive = index === active;

                return (
                  <li key={contact.id}>
                    <button
                      type="button"
                      id={`${OPTION_ID_PREFIX}${contact.id}`}
                      role="option"
                      aria-selected={isActive}
                      tabIndex={-1}
                      disabled={Boolean(blocked) || busy}
                      onPointerMove={() => {
                        if (!blocked) setActiveIndex(index);
                      }}
                      onClick={() => handleSelect(contact)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-left',
                        'transition-[background-color,transform] duration-150 ease-out',
                        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        blocked
                          ? 'cursor-not-allowed opacity-55'
                          : cn(
                              'active:scale-[0.99] disabled:opacity-60',
                              isActive && 'bg-accent'
                            ),
                        'motion-reduce:transition-none motion-reduce:active:scale-100'
                      )}
                    >
                      <Avatar className="size-9 shrink-0 ring-1 ring-border">
                        <AvatarFallback className="text-xs font-medium">
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
                          {contact.phone ||
                            contact.email ||
                            'No contact details'}
                        </span>
                      </span>

                      {isOpening ? (
                        <Loader2
                          aria-hidden="true"
                          className="size-4 shrink-0 animate-spin text-muted-foreground"
                        />
                      ) : blocked ? (
                        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
                          {BLOCK_LABEL[blocked]}
                        </span>
                      ) : (
                        <ChevronRight
                          aria-hidden="true"
                          className={cn(
                            'size-4 shrink-0 text-muted-foreground transition-opacity',
                            isActive ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <p className="border-t border-border bg-muted/40 px-5 py-3 text-xs leading-relaxed text-muted-foreground">
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
