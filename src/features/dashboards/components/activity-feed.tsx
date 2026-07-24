'use client';

import Link from 'next/link';
import type { ComponentType } from 'react';
import {
  Briefcase,
  CalendarCheck,
  ListTodo,
  MessageSquare,
  Radio,
  UserPlus,
} from 'lucide-react';

import type { ActivityEntry } from '@/lib/data/dashboard/types';
import { ChartCard } from './chart-card';
import { cn } from '@/lib/utils';

const KIND_ICON: Record<
  ActivityEntry['type'],
  ComponentType<{ className?: string }>
> = {
  message: MessageSquare,
  broadcast: Radio,
  deal: Briefcase,
  contact: UserPlus,
  appointment: CalendarCheck,
  task: ListTodo,
};

const KIND_BADGE: Record<ActivityEntry['type'], string> = {
  message: 'bg-[var(--channel-whatsapp)]/10 text-[var(--channel-whatsapp)]',
  broadcast: 'bg-[var(--chart-4)]/10 text-[var(--chart-4)]',
  deal: 'bg-primary/10 text-primary',
  contact: 'bg-[var(--channel-sms)]/10 text-[var(--channel-sms)]',
  appointment: 'bg-[var(--chart-5)]/10 text-[var(--chart-5)]',
  task: 'bg-muted text-muted-foreground',
};

export function ActivityFeed({
  items,
  className,
}: {
  items: ActivityEntry[];
  className?: string;
}) {
  return (
    <ChartCard
      title="Recent activity"
      caption="Latest events across channels, broadcasts and deals"
      href="/inbox"
      hrefLabel="View inbox"
      className={className}
      contentClassName="scrollbar-invisible max-h-80 overflow-y-auto overscroll-contain p-0"
    >
      {items.length === 0 && (
        <p className="text-muted-foreground px-4 py-6 text-center text-xs">
          No recent activity yet.
        </p>
      )}
      <ul className="divide-border divide-y">
        {items.map((item) => {
          const Icon = KIND_ICON[item.type];
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className="hover:bg-muted/40 flex items-center gap-3 px-5 py-3 transition-colors"
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                    KIND_BADGE[item.type]
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                  {item.title}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {item.time}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}
