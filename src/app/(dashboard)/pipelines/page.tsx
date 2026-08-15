import { Suspense } from 'react';
import { PipelineWorkspace } from '@/features/pipelines/components/pipeline-workspace';
import { getPipelineRuntime } from '@/features/pipelines/lib/pipeline-runtime';

/**
 * Mirrors exactly what `pipelinePath()` writes into the URL.
 *
 * These MUST stay in sync with `src/lib/routes/dashboard-routes.ts`.
 * They previously drifted: the builder emits snake_case
 * (`sub_pipeline`, `saved_view`) and omitted nothing, while this page
 * read camelCase (`subPipeline`, `savedView`) and never read `pipeline`
 * at all — so switching pipelines updated the URL but always
 * re-rendered the default pipeline, and sub-pipeline / saved-view deep
 * links silently reset.
 */
type PipelineSearchParams = Promise<{
  pipeline?: string;
  view?: string;
  sub_pipeline?: string;
  saved_view?: string;
}>;

/**
 * The navigation to /pipelines used to block on two sequential Supabase
 * round-trips (runtime resolution + snapshot) before ANY response
 * streamed back, making the page switch feel frozen for 1-3s. The
 * page shell now commits instantly; the data-dependent workspace
 * streams in behind a lightweight skeleton via Suspense.
 */
export default async function PipelinesPage({
  searchParams,
}: {
  searchParams: PipelineSearchParams;
}) {
  return (
    <Suspense fallback={<PipelineLoadingState />}>
      <PipelineWorkspaceLoader searchParams={searchParams} />
    </Suspense>
  );
}

async function PipelineWorkspaceLoader({
  searchParams,
}: {
  searchParams: PipelineSearchParams;
}) {
  const [{ pipeline, view, sub_pipeline, saved_view }, runtime] =
    await Promise.all([searchParams, getPipelineRuntime()]);
  // `getSnapshot` resolves the id against this account's own pipeline
  // list and returns null when it does not match, so a hand-edited
  // ?pipeline= cannot reach another workspace's data.
  const snapshot = await runtime.repository.getSnapshot(pipeline);

  if (!snapshot) {
    return (
      // Plain <div>: the dashboard shell already provides <main>.
      <div className="bg-background flex min-h-full items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">
          No pipeline is available for this account.
        </p>
      </div>
    );
  }

  const mode = view === 'list' || view === 'sheet' ? view : 'board';

  return (
    <PipelineWorkspace
      initialSnapshot={snapshot}
      initialMode={mode}
      initialSubPipelineId={sub_pipeline}
      initialSavedViewId={saved_view}
    />
  );
}

function PipelineLoadingState() {
  return (
    // Plain <div>: the dashboard shell already provides <main>.
    <div
      aria-busy="true"
      className="bg-background flex min-h-full flex-1 flex-col gap-4 p-6"
    >
      <span className="sr-only">Loading pipeline</span>
      <div className="bg-muted h-8 w-48 animate-pulse rounded-md" />
      <div className="flex flex-1 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-1 space-y-3">
            <div className="bg-muted h-6 w-2/3 animate-pulse rounded" />
            <div className="bg-muted/60 h-24 animate-pulse rounded-lg" />
            <div className="bg-muted/40 h-24 animate-pulse rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
