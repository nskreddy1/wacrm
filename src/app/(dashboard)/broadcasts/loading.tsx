import { CardGridSkeleton, ListRowsSkeleton } from '@/components/ui/loading-skeletons';
import { Skeleton } from '@/components/ui/skeleton';

/** Route-level loader for /broadcasts — KPI strip + campaign rows. */
export default function BroadcastsLoading() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between" aria-hidden>
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-40" />
      </div>
      <CardGridSkeleton count={4} />
      <div className="rounded-lg border px-4">
        <ListRowsSkeleton count={6} withAvatar={false} />
      </div>
    </div>
  );
}
