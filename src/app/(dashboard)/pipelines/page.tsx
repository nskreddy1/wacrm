import { Suspense } from 'react';
import { PipelineWorkspace } from '@/features/pipelines/components/pipeline-workspace';
import { getPipelineRuntime } from '@/features/pipelines/lib/pipeline-runtime';

type PipelineSearchParams = Promise<{
  view?: string;
  subPipeline?: string;
  savedView?: string;
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
  const [{ view, subPipeline, savedView }, runtime] = await Promise.all([
    searchParams,
    getPipelineRuntime(),
  ]);
  const snapshot = await runtime.repository.getSnapshot();

  if (!snapshot) {
    return (
      <main className="bg-background flex min-h-full items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">
          No pipeline is available for this account.
        </p>
      </main>
    );
  }

  const mode = view === 'list' || view === 'sheet' ? view : 'board';

  return (
    <PipelineWorkspace
      initialSnapshot={snapshot}
      initialMode={mode}
      initialSubPipelineId={subPipeline}
      initialSavedViewId={savedView}
    />
  );
}

function PipelineLoadingState() {
  return (
    <main
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
    </main>
  );
}
