import { redirect } from "next/navigation"
import { getCurrentAccount } from "@/lib/auth/account"
import { orgPath, pipelinePath } from "@/lib/routes/dashboard-routes"
import { SupabasePipelineRepository } from "@/lib/pipelines/supabase-pipeline-repository"

export default async function PipelinesPage() {
  const context = await getCurrentAccount()
  const pipelines = await new SupabasePipelineRepository(context).listPipelines()
  redirect(pipelines[0] ? pipelinePath(context.accountId, pipelines[0].id, "board") : orgPath(context.accountId, "pipelines"))
}
