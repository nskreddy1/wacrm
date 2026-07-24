import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-level loader for /pipelines — kanban silhouette: toolbar +
 * stage columns with deal cards, matching the real board layout.
 */
export default function PipelinesLoading() {
  return (
    <div className="flex h-full flex-col" aria-hidden>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Skeleton className="size-8 rounded-md" />
        <Skeleton className="h-8 w-44" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex flex-1 gap-3 overflow-hidden p-4">
        {Array.from({ length: 4 }).map((_, col) => (
          <div
            key={col}
            className="flex w-72 shrink-0 flex-col gap-3 rounded-lg border p-3"
          >
            <div className="space-y-1.5 border-b pb-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-20" />
            </div>
            {Array.from({ length: col === 0 ? 3 : 2 }).map((_, row) => (
              <div key={row} className="space-y-2 rounded-md border p-3">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
