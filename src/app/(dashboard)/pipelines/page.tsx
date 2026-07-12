import { EnterprisePipelineWorkspace } from "@/components/pipelines/enterprise-pipeline-workspace"
import { pipelineRepository } from "@/lib/pipelines/mock-pipeline-repository"

export default async function PipelinesPage() {
  const snapshot = await pipelineRepository.getSnapshot()

  return <EnterprisePipelineWorkspace initialDeals={snapshot.deals} />
}
