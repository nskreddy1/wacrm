'use client';

import type { PerformerSummary } from '@/lib/data/dashboard/types';

/**
 * Ranked won-value leaderboard (30d). Each row carries a proportional
 * bar so relative contribution reads at a glance, plus the member's
 * current open book as secondary detail.
 */
export function SalesLeaderboard({
  performers,
  currency,
}: {
  performers: PerformerSummary[];
  currency: string;
}) {
  if (performers.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-xs">
        No deals won in the last 30 days.
      </p>
    );
  }

  const money = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });
  const max = Math.max(...performers.map((p) => p.wonValue30d), 1);

  return (
    <ol className="flex flex-col gap-3">
      {performers.slice(0, 6).map((p, i) => {
        const pct = Math.round((p.wonValue30d / max) * 100);
        return (
          <li key={p.userId} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="text-muted-foreground w-4 shrink-0 text-xs tabular-nums">
                  {i + 1}
                </span>
                <span className="text-foreground truncate text-[13px] font-medium">
                  {p.name}
                </span>
              </span>
              <span className="text-foreground shrink-0 text-[13px] font-semibold tabular-nums">
                {money.format(p.wonValue30d)}
              </span>
            </div>
            <div className="flex items-center gap-2 pl-6">
              <div className="bg-muted h-1.5 flex-1 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full rounded-full transition-[width] duration-700 ease-out"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {p.wonCount30d} won · {p.openDeals} open
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
