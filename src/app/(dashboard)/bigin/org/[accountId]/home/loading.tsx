import { Skeleton } from '@/components/ui/skeleton';

export default function EnterpriseHomeLoading() {
  return (
    <div
      className="flex h-full flex-col gap-3 p-4"
      aria-label="Loading CRM workspace"
    >
      <Skeleton className="h-12 w-full" />
      <div className="grid flex-1 gap-3 md:grid-cols-3">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    </div>
  );
}
