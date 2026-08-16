'use client';

import { MessageSquarePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AssistantSessionSummary } from '../lib/sessions';

// ============================================================
// Chat history — slide-over list inside the copilot panel.
//
// A 400px panel has no room for a permanent sidebar, so history
// covers the transcript while it's open and the header's single
// history control toggles it. "New chat" lives at the top of this
// list rather than as its own header icon: two adjacent icons that
// both mean "leave this conversation" is the ambiguity worth
// avoiding.
// ============================================================

/** Relative day labels — absolute dates are noise for recent threads. */
function formatWhen(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const days = Math.floor((startOfToday - startOfDay(then)) / 86_400_000);

  if (days <= 0) {
    return then.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

interface AssistantHistoryProps {
  sessions: AssistantSessionSummary[];
  activeSessionId: string | null;
  loading: boolean;
  onSelect: (sessionId: string) => void;
  onNewChat: () => void;
  onDelete: (sessionId: string) => void;
}

export function AssistantHistory({
  sessions,
  activeSessionId,
  loading,
  onSelect,
  onNewChat,
  onDelete,
}: AssistantHistoryProps) {
  return (
    <div className="bg-background absolute inset-0 z-20 flex flex-col">
      <div className="flex flex-col gap-1 px-3 pt-3 pb-2">
        <Button
          type="button"
          variant="outline"
          onClick={onNewChat}
          className="h-9 w-full justify-start gap-2 rounded-xl text-[13px] font-normal"
        >
          <MessageSquarePlus className="size-4" aria-hidden />
          New chat
        </Button>
      </div>

      <div className="app-scrollbar min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {loading ? (
          // Skeleton rows rather than a spinner: the list's shape is
          // known, so the layout doesn't jump when data lands.
          <div className="flex flex-col gap-1.5 pt-1">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-muted/60 h-11 animate-pulse rounded-lg"
              />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-muted-foreground px-1 pt-4 text-xs leading-relaxed">
            No past chats yet. Conversations you have with Mira show up here,
            and are kept for 90 days.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sessions.map((session) => {
              const active = session.id === activeSessionId;
              return (
                <li key={session.id} className="group/row relative">
                  <button
                    type="button"
                    onClick={() => onSelect(session.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'hover:bg-muted/70 flex w-full flex-col items-start gap-0.5 rounded-lg py-2 pr-9 pl-2.5 text-left transition-colors',
                      active && 'bg-muted'
                    )}
                  >
                    <span className="line-clamp-1 w-full text-[13px] leading-snug font-medium">
                      {session.title ?? 'New chat'}
                    </span>
                    <span className="text-muted-foreground text-[11px]">
                      {formatWhen(session.lastMessageAt)}
                    </span>
                  </button>

                  {/* Per-thread delete. The scheduled 90-day purge is
                      the backstop; this is the "I just pasted a
                      customer's details in there" escape hatch, which
                      shouldn't require waiting a quarter.

                      Visible on hover AND on keyboard focus — a
                      hover-only control is unreachable by keyboard. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete chat: ${session.title ?? 'New chat'}`}
                    onClick={() => onDelete(session.id)}
                    className="text-muted-foreground hover:text-destructive absolute top-1/2 right-1 size-7 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* States the retention policy where the data actually is, rather
          than burying it in a settings page. */}
      <p className="text-muted-foreground border-border border-t px-4 py-2.5 text-[11px] leading-relaxed">
        Chats are private to you and deleted automatically after 90 days.
      </p>
    </div>
  );
}
