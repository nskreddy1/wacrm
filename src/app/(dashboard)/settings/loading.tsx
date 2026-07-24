import { ListRowsSkeleton } from '@/components/ui/loading-skeletons';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-level loader for /settings — tab bar placeholder plus the same
 * row skeleton the members/roles/profiles lists use for data loading.
 */
export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-24" />
        <Skeleton className="h-9 w-28" />
      </div>
      <ListRowsSkeleton count={8} />
    </div>
  );
}
