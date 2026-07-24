import { describe, expect, it } from "vitest"
import { mapDeal, mapSubPipeline } from "./mappers"

describe("pipeline mappers", () => {
  it("normalizes nullable and array relations", () => {
    const deal = mapDeal({ id: "d", account_id: "a", pipeline_id: "p", stage_id: "s", title: "Renewal", value: "1250.50", currency: "USD", status: "open", created_at: "2026-01-01", contact: [{ id: "c", name: null, phone: "+1" }], assignee: [] })
    expect(deal.value).toBe(1250.5)
    expect(deal.contact?.name).toBe("Unknown contact")
    expect(deal.owner).toBeNull()
    expect(deal.priority).toBe("normal")
  })
  it("orders sub-pipeline memberships", () => {
    const item = mapSubPipeline({ id: "s", account_id: "a", pipeline_id: "p", name: "Sales", position: 0 }, [{ sub_pipeline_id: "s", deal_id: "two", position: 2 }, { sub_pipeline_id: "s", deal_id: "one", position: 1 }])
    expect(item.dealIds).toEqual(["one", "two"])
  })
})
