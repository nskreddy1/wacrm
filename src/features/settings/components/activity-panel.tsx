'use client';

// ============================================================
// Workspace Activity — the tenant-facing audit trail.
//
// Answers the enterprise question "who did what, when" for THIS
// workspace: member/role changes, agent config edits, template
// lifecycle, broadcasts. Read-only; events are append-only at the
// database level (INSERT-only RLS), so this list is trustworthy —
// nobody can rewrite history from the app.
// ============================================================

import { useState } from 'react';
import useSWRInfinite from 'swr/infinite';
import {
  Activity,
  Bot,
  FileText,
  Loader2,
  Megaphone,
  ShieldAlert,
  UsersRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AuditEventRow {
  id: string;
  actor: string;
  action: string;
  entity: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

interface ActivityPage {
  events: AuditEventRow[];
  has_more: boolean;
}

const PAGE_SIZE = 50;

const fetcher = async (url: string): Promise<ActivityPage> => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? 'Failed to load activity');
  }
  return res.json() as Promise<ActivityPage>;
};

/** Human phrasing per machine action key; falls back to the raw key. */
function describe(event: AuditEventRow): string {
  const name =
    typeof event.meta?.name === 'string' ? `"${event.meta.name}"` : '';
  switch (event.action) {
    case 'member.updated':
      return 'updated a member\u2019s role or status';
    case 'member.removed':
      return 'removed a member from the workspace';
    case 'agent.created':
      return `created the AI agent ${name}`.trim();
    case 'agent.updated':
      return `changed AI agent settings ${name}`.trim();
    case 'agent.deleted':
      return `deleted the AI agent ${name}`.trim();
    case 'template.deleted':
      return `deleted the template ${name}`.trim();
    case 'broadcast.sent': {
      const sent = typeof event.meta?.sent === 'number' ? event.meta.sent : 0;
      const channel =
        typeof event.meta?.channel === 'string' ? event.meta.channel : '';
      return `sent a ${channel} broadcast to ${sent} recipient${sent === 1 ? '' : 's'}`;
    }
    default:
      return event.action.replace(/[._]/g, ' ');
  }
}

function iconFor(action: string) {
  if (action.startsWith('member.')) return UsersRound;
  if (action.startsWith('agent.')) return Bot;
  if (action.startsWith('template.')) return FileText;
  if (action.startsWith('broadcast.')) return Megaphone;
  return Activity;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ActivityPanel() {
  const [denied, setDenied] = useState(false);

  const { data, error, size, setSize, isValidating } =
    useSWRInfinite<ActivityPage>(
      (index, previous) => {
        if (previous && !previous.has_more) return null;
        const last = previous?.events[previous.events.length - 1];
        const cursor = last
          ? `&before=${encodeURIComponent(last.created_at)}`
          : '';
        return `/api/account/activity?limit=${PAGE_SIZE}${cursor}`;
      },
      fetcher,
      {
        revalidateFirstPage: false,
        onError: (err: Error) => {
          if (/admin|forbidden|permission/i.test(err.message)) setDenied(true);
        },
      }
    );

  const events = data?.flatMap((page) => page.events) ?? [];
  const hasMore = data?.[data.length - 1]?.has_more ?? false;
  const loading = !data && !error;

  return (
    <section
      aria-labelledby="activity-heading"
      className="border-border bg-card rounded-xl border p-5"
    >
      <div className="mb-1 flex items-center gap-2">
        <Activity className="text-muted-foreground size-4" aria-hidden="true" />
        <h2
          id="activity-heading"
          className="text-foreground text-sm font-semibold"
        >
          Workspace activity
        </h2>
      </div>
      <p className="text-muted-foreground mb-5 text-xs leading-relaxed">
        A tamper-proof record of important changes — member and role
        updates, AI agent configuration, template changes, and broadcasts.
        Entries can never be edited or deleted.
      </p>

      {denied ? (
        <div className="border-border flex items-center gap-3 rounded-md border border-dashed px-4 py-6">
          <ShieldAlert
            className="text-muted-foreground size-5 shrink-0"
            aria-hidden="true"
          />
          <p className="text-muted-foreground text-sm">
            Only workspace admins can view the activity log.
          </p>
        </div>
      ) : loading ? (
        <div
          className="flex items-center justify-center py-10"
          role="status"
          aria-label="Loading activity"
        >
          <Loader2
            className="text-muted-foreground size-5 animate-spin"
            aria-hidden="true"
          />
        </div>
      ) : error && events.length === 0 ? (
        <p className="text-destructive py-6 text-sm">
          Couldn&apos;t load the activity log. Try refreshing the page.
        </p>
      ) : events.length === 0 ? (
        <p className="text-muted-foreground py-6 text-sm">
          No activity recorded yet. Changes made from now on will appear
          here.
        </p>
      ) : (
        <>
          <ol className="flex flex-col">
            {events.map((event) => {
              const Icon = iconFor(event.action);
              return (
                <li
                  key={event.id}
                  className="border-border flex items-start gap-3 border-b py-3 last:border-b-0"
                >
                  <span className="bg-muted mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full">
                    <Icon
                      className="text-muted-foreground size-3.5"
                      aria-hidden="true"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-sm leading-relaxed">
                      <span className="font-medium">{event.actor}</span>{' '}
                      {describe(event)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {timeAgo(event.created_at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          {hasMore ? (
            <div className="mt-4 flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSize(size + 1)}
                disabled={isValidating}
              >
                {isValidating ? (
                  <Loader2
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                Load older activity
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
