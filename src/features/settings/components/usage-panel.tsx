'use client';

// ============================================================
// Plan & usage — what this workspace is allowed, and how much of
// it is spent.
//
// Two kinds of allowance, kept visually distinct because they
// behave differently:
//   - Workspace totals (contacts, flows, seats, channels) counted
//     live, and they only fall when something is deleted.
//   - Monthly allowances (messages, broadcast recipients, AI
//     replies) that reset on the 1st.
//
// A limit of `null` means unlimited: either the plan grants it or
// an operator lifted the cap for this workspace, in which case the
// row is labelled so the customer knows it is not their plan's
// standard allowance.
// ============================================================

import useSWR from 'swr';
import { Infinity as InfinityIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface UsageRow {
  key: string;
  label: string;
  kind: 'point_in_time' | 'monthly';
  limit: number | null;
  used: number;
  source: 'plan' | 'override' | 'unlimited_all';
}

interface UsageSummary {
  planId: string;
  planName: string;
  isCustom: boolean;
  unlimitedAll: boolean;
  periodStart: string;
  rows: UsageRow[];
}

const fetcher = async (url: string): Promise<UsageSummary> => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? 'Failed to load usage');
  }
  const json = (await res.json()) as { data: UsageSummary };
  return json.data;
};

const nf = new Intl.NumberFormat();

/** Bar tint by pressure — quiet until it actually matters. */
function tone(used: number, limit: number | null) {
  if (limit === null || limit === 0) return 'bg-primary';
  const pct = used / limit;
  if (pct >= 1) return 'bg-destructive';
  if (pct >= 0.8) return 'bg-amber-500';
  return 'bg-primary';
}

function UsageMeter({ row }: { row: UsageRow }) {
  const unlimited = row.limit === null;
  const pct = unlimited
    ? 0
    : Math.min(100, row.limit === 0 ? 100 : (row.used / row.limit) * 100);
  const lifted = row.source !== 'plan';

  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-2 text-sm">
          {row.label}
          {lifted && (
            <Badge variant="secondary" className="text-[11px]">
              Custom
            </Badge>
          )}
        </span>
        <span className="text-muted-foreground text-sm tabular-nums">
          {unlimited ? (
            <span className="flex items-center gap-1">
              {nf.format(row.used)} used
              <span aria-hidden="true">·</span>
              <InfinityIcon className="size-3.5" aria-hidden="true" />
              <span className="sr-only">unlimited</span>
            </span>
          ) : (
            `${nf.format(row.used)} / ${nf.format(row.limit)}`
          )}
        </span>
      </div>
      <div
        className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-label={row.label}
        aria-valuenow={unlimited ? undefined : Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={
          unlimited ? `${nf.format(row.used)} used, unlimited` : undefined
        }
      >
        {!unlimited && (
          <div
            className={`h-full rounded-full transition-[width] ${tone(row.used, row.limit)}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </li>
  );
}

export function UsagePanel() {
  const { data, error, isLoading } = useSWR<UsageSummary>(
    '/api/v1/workspace/usage',
    fetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <p className="text-muted-foreground text-sm">
        {error instanceof Error
          ? error.message
          : 'Usage is unavailable right now. Try again in a moment.'}
      </p>
    );
  }

  const workspaceRows = data.rows.filter((r) => r.kind === 'point_in_time');
  const monthlyRows = data.rows.filter((r) => r.kind === 'monthly');
  const resetsOn = new Date(`${data.periodStart}T00:00:00Z`);
  resetsOn.setUTCMonth(resetsOn.getUTCMonth() + 1);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs">Current plan</span>
          <span className="flex items-center gap-2 text-lg font-semibold">
            {data.planName}
            {data.isCustom && <Badge variant="secondary">Custom</Badge>}
          </span>
        </div>
        {data.unlimitedAll ? (
          <p className="text-muted-foreground max-w-xs text-xs leading-relaxed">
            Every limit is lifted for this workspace. Nothing here will block
            you.
          </p>
        ) : (
          data.isCustom && (
            <p className="text-muted-foreground max-w-xs text-xs leading-relaxed">
              Some allowances were adjusted for this workspace and no longer
              match the standard plan.
            </p>
          )
        )}
      </header>

      <section className="flex flex-col gap-3" aria-label="Workspace totals">
        <h3 className="text-sm font-semibold">Workspace totals</h3>
        <ul className="flex flex-col gap-4">
          {workspaceRows.map((row) => (
            <UsageMeter key={row.key} row={row} />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-label="This month">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">This month</h3>
          <span className="text-muted-foreground text-xs">
            Resets{' '}
            {resetsOn.toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </div>
        <ul className="flex flex-col gap-4">
          {monthlyRows.map((row) => (
            <UsageMeter key={row.key} row={row} />
          ))}
        </ul>
      </section>
    </div>
  );
}
