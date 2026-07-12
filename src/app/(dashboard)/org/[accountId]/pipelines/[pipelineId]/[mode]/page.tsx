import { notFound, redirect } from "next/navigation"
import { getPipelineRuntime } from "@/lib/pipelines/pipeline-runtime"
import { pipelineModeSchema } from "@/lib/pipelines/validation"
import { enterpriseDealsPath } from "@/lib/routes/dashboard-routes"

export default async function LegacyPipelineWorkspacePage({ params, searchParams }: { params: Promise<{ accountId: string; pipelineId: string; mode: string }>; searchParams: Promise<{ subPipeline?: string; savedView?: string }> }) {
  const [{ accountId, pipelineId, mode: rawMode }, query, runtime] = await Promise.all([params, searchParams, getPipelineRuntime()])
  const mode = pipelineModeSchema.safeParse(rawMode)
  if (accountId !== runtime.accountId || !mode.success) notFound()
  redirect(enterpriseDealsPath(accountId, pipelineId, mode.data, { subPipeline: query.subPipeline, savedView: query.savedView }))
}
