import { redirect } from "next/navigation"
import { pipelineModeFromRoute } from "@/lib/routes/dashboard-routes"

export default async function LegacyPipelineWorkspacePage({
  params,
}: {
  params: Promise<{ mode: string }>
}) {
  const { mode } = await params
  const normalized = pipelineModeFromRoute(mode)
  redirect(normalized && normalized !== "board" ? `/pipelines?view=${normalized}` : "/pipelines")
}
