import { notFound, redirect } from "next/navigation"
import { getCurrentAccount } from "@/lib/auth/account"
import { pipelineModeSchema } from "@/lib/pipelines/validation"
import { enterpriseDealsPath } from "@/lib/routes/dashboard-routes"

export default async function LegacyPipelineWorkspacePage({ params, searchParams }: { params: Promise<{ accountId: string; pipelineId: string; mode: string }>; searchParams: Promise<{ subPipeline?: string; savedView?: string }> }) {
  const [{ accountId, pipelineId, mode: rawMode }, query, context] = await Promise.all([params, searchParams, getCurrentAccount()])
  const mode = pipelineModeSchema.safeParse(rawMode)
  if (accountId !== context.accountId || !mode.success) notFound()
  redirect(enterpriseDealsPath(accountId, pipelineId, mode.data, { subPipeline: query.subPipeline, savedView: query.savedView }))
}
