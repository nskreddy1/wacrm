import { ListRowsSkeleton } from '@/components/ui/loading-skeletons';
import { Skeleton } from '@/components/ui/skeleton';

/** Route-level loader for /templates — header + template rows. */
export default function TemplatesLoading() {
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between" aria-hidden>
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="rounded-lg border px-4">
        <ListRowsSkeleton count={8} withAvatar={false} />
      </div>
    </div>
  );
}
