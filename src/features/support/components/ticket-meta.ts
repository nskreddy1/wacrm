// ============================================================
// Shared presentation metadata for support tickets — status,
// priority and category chips. Used by BOTH the user-facing
// Settings → Support tab and the /admin/tickets queue so the two
// surfaces never disagree on what "urgent" looks like.
//
// Colours piggyback on the semantic token palette (chart/status
// tokens) rather than raw Tailwind colours, per design system.
// ============================================================

import type {
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '@/features/support/lib/tickets';

export const STATUS_META: Record<
  TicketStatus,
  { label: string; className: string }
> = {
  open: {
    label: 'Open',
    className: 'bg-primary-soft text-primary border border-primary/20',
  },
  in_progress: {
    label: 'In progress',
    className:
      'bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:text-amber-400',
  },
  waiting_on_user: {
    label: 'Waiting on you',
    className:
      'bg-violet-500/10 text-violet-600 border border-violet-500/20 dark:text-violet-400',
  },
  resolved: {
    label: 'Resolved',
    className:
      'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 dark:text-emerald-400',
  },
  closed: {
    label: 'Closed',
    className: 'bg-muted text-muted-foreground border border-border',
  },
};

/** The admin queue reads the same statuses but from the operator's
 * point of view: "waiting_on_user" means the ball is NOT in our court. */
export const ADMIN_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_on_user: 'Waiting on user',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const PRIORITY_META: Record<
  TicketPriority,
  { label: string; className: string; rank: number }
> = {
  urgent: {
    label: 'Urgent',
    className:
      'bg-red-500/10 text-red-600 border border-red-500/20 dark:text-red-400',
    rank: 0,
  },
  high: {
    label: 'High',
    className:
      'bg-orange-500/10 text-orange-600 border border-orange-500/20 dark:text-orange-400',
    rank: 1,
  },
  normal: {
    label: 'Normal',
    className: 'bg-muted text-muted-foreground border border-border',
    rank: 2,
  },
  low: {
    label: 'Low',
    className: 'bg-muted text-muted-foreground/70 border border-border',
    rank: 3,
  },
};

export const CATEGORY_META: Record<TicketCategory, { label: string }> = {
  billing: { label: 'Billing' },
  technical: { label: 'Technical issue' },
  channel_setup: { label: 'Channel setup' },
  agent_help: { label: 'Agent help' },
  other: { label: 'Other' },
};

/** Compact relative time — "2m", "3h", "5d" — for list rows. */
export function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
