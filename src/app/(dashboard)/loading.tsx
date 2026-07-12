import { Skeleton } from "@/components/ui/skeleton"

export default function DashboardLoading() {
  return (
    <div className="flex min-h-full flex-col gap-4 p-4" aria-label="Loading workspace" aria-busy="true">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-9 w-48" />
        <div className="flex gap-2">
          <Skeleton className="size-9" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid min-h-96 flex-1 grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="min-h-64 w-full" />
        ))}
      </div>
    </div>
  )
}
