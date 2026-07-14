import { PipelineWorkspace } from "@/components/pipelines/pipeline-workspace"
import { getPipelineRuntime } from "@/lib/pipelines/pipeline-runtime"

export default async function PipelinesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; subPipeline?: string; savedView?: string }>
}) {
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
