import { Skeleton } from '@/components/ui/skeleton';

export default function OrganizationLoading() {
  return (
    <div
      className="flex h-full flex-col gap-3 p-4"
      aria-label="Loading workspace"
    >
      <Skeleton className="h-10 w-full" />
      <div className="grid min-h-0 flex-1 grid-cols-3 gap-3">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    </div>
  );
}
