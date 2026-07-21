import { Suspense } from "react"
import { PipelineWorkspace } from "@/components/pipelines/pipeline-workspace"
import { getPipelineRuntime } from "@/lib/pipelines/pipeline-runtime"

type PipelineSearchParams = Promise<{ view?: string; subPipeline?: string; savedView?: string }>

/**
 * The navigation to /pipelines used to block on two sequential Supabase
 * round-trips (runtime resolution + snapshot) before ANY response
 * streamed back, making the page switch feel frozen for 1-3s. The
 * page shell now commits instantly; the data-dependent workspace
 * streams in behind a lightweight skeleton via Suspense.
 */
export default async function PipelinesPage({ searchParams }: { searchParams: PipelineSearchParams }) {
  return (
    <Suspense fallback={<PipelineLoadingState />}>
      <PipelineWorkspaceLoader searchParams={searchParams} />
    </Suspense>
  )
}

async function PipelineWorkspaceLoader({ searchParams }: { searchParams: PipelineSearchParams }) {
  const [{ view, subPipeline, savedView }, runtime] = await Promise.all([
    searchParams,
    getPipelineRuntime(),
  ])
  const snapshot = await runtime.repository.getSnapshot()

  if (!snapshot) {
    return (
      <main className="flex min-h-full items-center justify-center bg-background p-6">
        <p className="text-sm text-muted-foreground">No pipeline is available for this account.</p>
      </main>
    )
  }

  const mode = view === "list" || view === "sheet" ? view : "board"

  return (
    <PipelineWorkspace
      initialSnapshot={snapshot}
      initialMode={mode}
      initialSubPipelineId={subPipeline}
      initialSavedViewId={savedView}
    />
  )
}

function PipelineLoadingState() {
  return (
    <main aria-busy="true" className="flex min-h-full flex-1 flex-col gap-4 bg-background p-6">
      <span className="sr-only">Loading pipeline</span>
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
      <div className="flex flex-1 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-1 space-y-3">
            <div className="h-6 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-24 animate-pulse rounded-lg bg-muted/60" />
            <div className="h-24 animate-pulse rounded-lg bg-muted/40" />
          </div>
        ))}
      </div>
    </main>
  )
}
