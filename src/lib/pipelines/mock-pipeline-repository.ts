import { demoDeals, demoStages } from "@/lib/demo/crm-data"
import type { PipelineDeal, PipelineRepository, PipelineSnapshot } from "./pipeline-repository"

function cloneDeal(deal: PipelineDeal): PipelineDeal {
  return { ...deal }
}

export class MockPipelineRepository implements PipelineRepository {
  private deals = demoDeals.map(cloneDeal)

  async getSnapshot(): Promise<PipelineSnapshot> {
    return {
      deals: this.deals.map(cloneDeal),
      stages: demoStages.map((stage) => ({ ...stage })),
    }
  }

  async createDeal(deal: PipelineDeal): Promise<PipelineDeal> {
    const created = cloneDeal(deal)
    this.deals = [created, ...this.deals]
    return cloneDeal(created)
  }

  async updateDeal(deal: PipelineDeal): Promise<PipelineDeal> {
    if (!this.deals.some((item) => item.id === deal.id)) throw new Error("Deal not found")
    this.deals = this.deals.map((item) => item.id === deal.id ? cloneDeal(deal) : item)
    return cloneDeal(deal)
  }

  async moveDeal(dealId: string, stageId: string): Promise<PipelineDeal> {
    const deal = this.deals.find((item) => item.id === dealId)
    if (!deal) throw new Error("Deal not found")
    const moved = { ...deal, stageId }
    this.deals = this.deals.map((item) => item.id === dealId ? moved : item)
    return cloneDeal(moved)
  }

  async deleteDeals(dealIds: readonly string[]): Promise<void> {
    const ids = new Set(dealIds)
    this.deals = this.deals.filter((deal) => !ids.has(deal.id))
  }
}

export const pipelineRepository: PipelineRepository = new MockPipelineRepository()
