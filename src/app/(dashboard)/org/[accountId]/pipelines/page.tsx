import { GitBranch } from "lucide-react"
import { getPipelineRuntime } from "@/lib/pipelines/pipeline-runtime"
import { pipelinePath } from "@/lib/routes/dashboard-routes"
import { redirect } from "next/navigation"

export default async function OrganizationPipelinesPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params
  const runtime = await getPipelineRuntime()
  if (accountId !== runtime.accountId) redirect(`/org/${runtime.accountId}/pipelines`)
  const pipelines = await runtime.repository.listPipelines()
  if (pipelines[0]) redirect(pipelinePath(runtime.accountId, pipelines[0].id, "board"))

  return <section className="flex h-full items-center justify-center p-6"><div className="flex max-w-md flex-col items-center gap-3 rounded-xl border bg-card p-8 text-center shadow-sm"><span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground"><GitBranch aria-hidden="true" /></span><h1 className="text-xl font-semibold text-balance">No pipelines yet</h1><p className="text-sm leading-relaxed text-muted-foreground">Create your first pipeline after applying the pipeline workspace migration. No demo records are shown in this account.</p></div></section>
}
