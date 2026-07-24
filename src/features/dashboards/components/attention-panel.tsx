'use client';

import Link from 'next/link';
import type { ComponentType } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  Inbox,
  ListTodo,
  TimerOff,
} from 'lucide-react';

import type { AttentionItem } from '@/lib/data/dashboard/types';
import { ChartCard } from './chart-card';

const ITEM_ICON: Record<
  AttentionItem['key'],
  ComponentType<{ className?: string }>
> = {
  unassigned: Inbox,
  overdue_tasks: ListTodo,
  failed_broadcasts: AlertTriangle,
  stalled_deals: TimerOff,
};

/**
 * "Needs attention" — the dashboard's action layer. Each row is a
 * direct link to where the work gets done (article best practice:
 * summary → diagnosis → action).
 */
export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  const actionable = items.filter((item) => item.count > 0);

  return (
    <ChartCard
      title="Needs attention"
      caption="Work that should not wait"
      contentClassName="p-0"
    >
      {actionable.length === 0 ? (
        <p className="text-muted-foreground flex items-center justify-center gap-1.5 px-4 py-5 text-xs">
          <CheckCircle2 className="text-positive size-4" aria-hidden="true" />
          All clear — nothing is blocked right now.
        </p>
      ) : (
        <ul className="divide-border divide-y">
          {actionable.map((item) => {
            const Icon = ITEM_ICON[item.key];
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="group hover:bg-muted/40 flex items-center gap-3 px-4 py-2.5 transition-colors"
                >
                  <span className="bg-destructive/10 text-destructive flex size-8 shrink-0 items-center justify-center rounded-lg">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {item.label}
                  </span>
                  <span className="bg-destructive/10 text-destructive shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums">
                    {item.count}
                  </span>
                  <ChevronRight
                    className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}
