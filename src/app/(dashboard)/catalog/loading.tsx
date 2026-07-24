import { CardGridSkeleton, ListRowsSkeleton } from '@/components/ui/loading-skeletons';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-level loader for /catalog — KPI strip + item rows, identical
 * silhouette to the loaded workspace so nothing jumps on arrival.
 */
export default function CatalogLoading() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between" aria-hidden>
        <div className="space-y-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-60" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      <CardGridSkeleton count={4} />
      <div className="rounded-lg border">
        <div className="border-b p-4" aria-hidden>
          <Skeleton className="h-8 w-64" />
        </div>
        <ListRowsSkeleton count={8} withAvatar={false} className="px-4" />
      </div>
    </div>
  );
}
