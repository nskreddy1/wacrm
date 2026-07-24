import { Skeleton } from '@/components/ui/skeleton';

/**
 * Deliberately minimal group-level loading state. Dashboard pages render
 * client workspaces that fetch via SWR (with `keepPreviousData`), so this
 * only flashes for the brief server render of the thin page shell. A
 * full-page skeleton grid here made every navigation feel like a reload;
 * a slim header placeholder bridges the swap without wiping the screen.
 */
export default function DashboardLoading() {
  return (
    <div
      className="flex min-h-full flex-col gap-4 p-4"
      aria-label="Loading workspace"
      aria-busy="true"
    >
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-9 w-28" />
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
    </div>
  );
}
