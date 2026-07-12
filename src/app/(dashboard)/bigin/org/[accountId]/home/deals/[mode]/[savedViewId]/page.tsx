import { notFound } from "next/navigation"
import { PipelineWorkspace } from "@/components/pipelines/pipeline-workspace"
import { getPipelineRuntime } from "@/lib/pipelines/pipeline-runtime"
import { isOpaqueId, isUuid, pipelineModeFromRoute } from "@/lib/routes/dashboard-routes"

export default async function EnterpriseDealsPage({ params, searchParams }: { params: Promise<{ accountId: string; mode: string; savedViewId: string }>; searchParams: Promise<{ pipeline?: string; sub_pipeline?: string }> }) {
  const [{ accountId, mode: routeMode, savedViewId }, query, runtime] = await Promise.all([params, searchParams, getPipelineRuntime()])
  const mode = pipelineModeFromRoute(routeMode)
  if (!mode || accountId !== runtime.accountId || !isUuid(accountId) || !isOpaqueId(savedViewId) || !query.pipeline || !isUuid(query.pipeline)) notFound()
  const snapshot = await runtime.repository.getSnapshot(query.pipeline)
  if (!snapshot) notFound()
  if (query.sub_pipeline && !snapshot.subPipelines.some((item) => item.id === query.sub_pipeline)) notFound()
  if (savedViewId !== snapshot.pipeline.id && !snapshot.savedViews.some((item) => item.id === savedViewId)) notFound()
  return <PipelineWorkspace initialSnapshot={snapshot} initialMode={mode} initialSubPipelineId={query.sub_pipeline} initialSavedViewId={savedViewId} />
}
