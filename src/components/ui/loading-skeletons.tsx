import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Enterprise skeleton library — contextual loading placeholders that
 * mirror the real layout of each surface (spreadsheet rows for tables,
 * bubbles for chat, cards for dashboards) instead of a generic spinner.
 *
 * Rules:
 * - Deterministic widths (no Math.random) so SSR/CSR markup matches.
 * - Every skeleton is aria-hidden with a sibling sr-only status so
 *   screen readers hear "Loading…" once, not a wall of divs.
 */

function SrLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <span role="status" className="sr-only">
      {label}
    </span>
  );
}

/** Cycle of widths that read as "real data" without randomness. */
const WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-2/5', 'w-3/5'];

/* ------------------------------------------------------------------ */
/* Spreadsheet / data table                                            */
/* ------------------------------------------------------------------ */

export function SheetTableSkeleton({
  columns = 6,
  rows = 12,
  withToolbar = true,
  className,
}: {
  columns?: number;
  rows?: number;
  withToolbar?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <SrLoading label="Loading records" />
      <div aria-hidden className="flex min-h-0 flex-1 flex-col">
        {withToolbar && (
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-8 w-24" />
            <div className="flex-1" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-8 w-8" />
          </div>
        )}
        {/* Header row */}
        <div className="bg-muted/40 flex items-center gap-0 border-b">
          <div className="w-10 shrink-0 p-3">
            <Skeleton className="size-4 rounded-sm" />
          </div>
          {Array.from({ length: columns }).map((_, i) => (
            <div key={i} className="flex-1 border-l px-3 py-2.5">
              <Skeleton className="h-3.5 w-20" />
            </div>
          ))}
        </div>
        {/* Body rows — widths cycle so the sheet looks organic */}
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-0 border-b">
            <div className="w-10 shrink-0 p-3">
              <Skeleton className="size-4 rounded-sm" />
            </div>
            {Array.from({ length: columns }).map((_, c) => (
              <div key={c} className="flex-1 border-l px-3 py-3">
                <Skeleton
                  className={cn('h-3.5', WIDTHS[(r * columns + c) % WIDTHS.length])}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inbox: conversation list                                            */
/* ------------------------------------------------------------------ */

export function ConversationListSkeleton({
  count = 8,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col', className)}>
      <SrLoading label="Loading conversations" />
      <div aria-hidden>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b px-4 py-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className={cn('h-3.5', WIDTHS[i % WIDTHS.length])} />
                <Skeleton className="h-3 w-10 shrink-0" />
              </div>
              <Skeleton
                className={cn('h-3', WIDTHS[(i + 3) % WIDTHS.length])}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inbox: message thread bubbles                                       */
/* ------------------------------------------------------------------ */

export function MessageThreadSkeleton({
  count = 7,
  className,
}: {
  count?: number;
  className?: string;
}) {
  // Deterministic in/out pattern that reads like a real conversation.
  const pattern = [false, false, true, false, true, true, false];
  return (
    <div className={cn('flex flex-1 flex-col justify-end gap-3 p-4', className)}>
      <SrLoading label="Loading messages" />
      <div aria-hidden className="flex flex-col gap-3">
        {Array.from({ length: count }).map((_, i) => {
          const outbound = pattern[i % pattern.length];
          return (
            <div
              key={i}
              className={cn('flex', outbound ? 'justify-end' : 'justify-start')}
            >
              <Skeleton
                className={cn(
                  'h-12 rounded-2xl',
                  outbound ? 'rounded-br-sm' : 'rounded-bl-sm',
                  ['w-48', 'w-64', 'w-36', 'w-56'][i % 4]
                )}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Generic: card grid (dashboards, settings cards)                     */
/* ------------------------------------------------------------------ */

export function CardGridSkeleton({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-4', className)}
    >
      <SrLoading label="Loading" />
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} aria-hidden className="space-y-3 rounded-lg border p-4">
          <Skeleton className="size-8 rounded-md" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3.5 w-28" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Generic: settings/list rows (members, roles, profiles)              */
/* ------------------------------------------------------------------ */

export function ListRowsSkeleton({
  count = 6,
  withAvatar = true,
  className,
}: {
  count?: number;
  withAvatar?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col', className)}>
      <SrLoading label="Loading" />
      <div aria-hidden>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 border-b px-2 py-3">
            {withAvatar && <Skeleton className="size-9 shrink-0 rounded-full" />}
            <div className="flex-1 space-y-2">
              <Skeleton className={cn('h-3.5', WIDTHS[i % WIDTHS.length])} />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-8 w-24 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
