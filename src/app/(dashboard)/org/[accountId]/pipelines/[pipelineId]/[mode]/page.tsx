import { notFound } from "next/navigation"
import { PipelineWorkspace } from "@/components/pipelines/pipeline-workspace"
import { getCurrentAccount } from "@/lib/auth/account"
import { SupabasePipelineRepository } from "@/lib/pipelines/supabase-pipeline-repository"
import { pipelineModeSchema } from "@/lib/pipelines/validation"

export default async function PipelineWorkspacePage({ params, searchParams }: { params: Promise<{ accountId: string; pipelineId: string; mode: string }>; searchParams: Promise<{ subPipeline?: string; savedView?: string }> }) {
  const [{ accountId, pipelineId, mode: rawMode }, query, context] = await Promise.all([params, searchParams, getCurrentAccount()])
  if (accountId !== context.accountId) notFound()
  const mode = pipelineModeSchema.safeParse(rawMode)
  if (!mode.success) notFound()
  const snapshot = await new SupabasePipelineRepository(context).getSnapshot(pipelineId)
  if (!snapshot) notFound()
  if (query.subPipeline && !snapshot.subPipelines.some((item) => item.id === query.subPipeline)) notFound()
  if (query.savedView && !snapshot.savedViews.some((item) => item.id === query.savedView)) notFound()
  return <PipelineWorkspace initialSnapshot={snapshot} initialMode={mode.data} initialSubPipelineId={query.subPipeline} />
}
