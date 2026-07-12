import { notFound } from "next/navigation"
import { getPipelineRuntime } from "@/lib/pipelines/pipeline-runtime"
import { isUuid } from "@/lib/routes/dashboard-routes"

export default async function EnterpriseHomeLayout({ children, params }: { children: React.ReactNode; params: Promise<{ accountId: string }> }) {
  const [{ accountId }, runtime] = await Promise.all([params, getPipelineRuntime()])
  if (!isUuid(accountId) || accountId !== runtime.accountId) notFound()
  return children
}
