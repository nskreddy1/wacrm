import { notFound, redirect } from "next/navigation"
import { getCurrentAccount } from "@/lib/auth/account"
import { SupabasePipelineRepository } from "@/lib/pipelines/supabase-pipeline-repository"
import { enterpriseDealsPath } from "@/lib/routes/dashboard-routes"

export default async function EnterpriseDealsIndex({ params }: { params: Promise<{ accountId: string }> }) {
  const [{ accountId }, context] = await Promise.all([params, getCurrentAccount()])
  if (accountId !== context.accountId) notFound()
  const pipelines = await new SupabasePipelineRepository(context).listPipelines()
  if (!pipelines[0]) notFound()
  redirect(enterpriseDealsPath(accountId, pipelines[0].id))
}
