import { redirect } from "next/navigation"
import { getPipelineRuntime } from "@/lib/pipelines/pipeline-runtime"
import { orgPath, pipelinePath } from "@/lib/routes/dashboard-routes"

export default async function PipelinesPage() {
  const { accountId, repository } = await getPipelineRuntime()
  const pipelines = await repository.listPipelines()
  redirect(pipelines[0] ? pipelinePath(accountId, pipelines[0].id, "board") : orgPath(accountId, "pipelines"))
}
