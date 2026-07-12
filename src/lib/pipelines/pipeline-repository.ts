import type { DemoDeal as PipelineDeal, DemoStage as PipelineStage } from "@/lib/demo/crm-data"

export type { PipelineDeal, PipelineStage }

export interface PipelineSnapshot {
  deals: PipelineDeal[]
  stages: PipelineStage[]
}

export interface PipelineRepository {
  getSnapshot(): Promise<PipelineSnapshot>
  createDeal(deal: PipelineDeal): Promise<PipelineDeal>
  updateDeal(deal: PipelineDeal): Promise<PipelineDeal>
  moveDeal(dealId: string, stageId: string): Promise<PipelineDeal>
  deleteDeals(dealIds: readonly string[]): Promise<void>
}
