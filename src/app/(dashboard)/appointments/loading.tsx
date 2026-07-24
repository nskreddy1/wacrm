import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-level loader for /appointments — mirrors the schedule layout
 * (header + day columns with slot cards) so the route transition and
 * the data fetch read as one continuous loading state.
 */
export default function AppointmentsLoading() {
  return (
    <div className="flex h-full flex-col gap-4 p-6" aria-hidden>
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="grid flex-1 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, col) => (
          <div key={col} className="space-y-3 rounded-lg border p-3">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: 3 }).map((_, row) => (
              <div key={row} className="space-y-2 rounded-md border p-3">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
