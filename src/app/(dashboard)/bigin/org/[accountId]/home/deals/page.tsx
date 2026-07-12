import { notFound, redirect } from "next/navigation"
import { getPipelineRuntime } from "@/lib/pipelines/pipeline-runtime"
import { enterpriseDealsPath } from "@/lib/routes/dashboard-routes"

export default async function EnterpriseDealsIndex({ params }: { params: Promise<{ accountId: string }> }) {
  const [{ accountId }, runtime] = await Promise.all([params, getPipelineRuntime()])
  if (accountId !== runtime.accountId) notFound()
  const pipelines = await runtime.repository.listPipelines()
  if (!pipelines[0]) notFound()
  redirect(enterpriseDealsPath(accountId, pipelines[0].id))
}
