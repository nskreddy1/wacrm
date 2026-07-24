import { CardGridSkeleton } from '@/components/ui/loading-skeletons';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-level loader for /dashboard — KPI card grid plus chart panel
 * placeholders matching the real overview layout, so first paint and
 * data hydration read as one continuous state.
 */
export default function DashboardOverviewLoading() {
  return (
    <div className="flex flex-col gap-4 p-4 lg:p-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-64" />
      </div>
      <CardGridSkeleton count={5} className="lg:grid-cols-5" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 rounded-lg lg:col-span-1" />
        <Skeleton className="h-72 rounded-lg" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
    </div>
  );
}
