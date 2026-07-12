import { notFound } from "next/navigation"
import { getPipelineRuntime } from "@/lib/pipelines/pipeline-runtime"

export default async function OrganizationLayout({ children, params }: { children: React.ReactNode; params: Promise<{ accountId: string }> }) {
  const [{ accountId }, runtime] = await Promise.all([params, getPipelineRuntime()])
  if (accountId !== runtime.accountId) notFound()
  return children
}
