import { notFound } from "next/navigation"
import { PipelineWorkspace } from "@/components/pipelines/pipeline-workspace"
import { getCurrentAccount } from "@/lib/auth/account"
import { SupabasePipelineRepository } from "@/lib/pipelines/supabase-pipeline-repository"
import { isOpaqueId, isUuid, pipelineModeFromRoute } from "@/lib/routes/dashboard-routes"

export default async function EnterpriseDealsPage({ params, searchParams }: { params: Promise<{ accountId: string; mode: string; savedViewId: string }>; searchParams: Promise<{ pipeline?: string; sub_pipeline?: string }> }) {
  const [{ accountId, mode: routeMode, savedViewId }, query, context] = await Promise.all([params, searchParams, getCurrentAccount()])
  const mode = pipelineModeFromRoute(routeMode)
  if (!mode || accountId !== context.accountId || !isUuid(accountId) || !isOpaqueId(savedViewId) || !query.pipeline || !isUuid(query.pipeline)) notFound()
  const snapshot = await new SupabasePipelineRepository(context).getSnapshot(query.pipeline)
  if (!snapshot) notFound()
  if (query.sub_pipeline && !snapshot.subPipelines.some((item) => item.id === query.sub_pipeline)) notFound()
  if (savedViewId !== snapshot.pipeline.id && !snapshot.savedViews.some((item) => item.id === savedViewId)) notFound()
  return <PipelineWorkspace initialSnapshot={snapshot} initialMode={mode} initialSubPipelineId={query.sub_pipeline} initialSavedViewId={savedViewId} />
}
