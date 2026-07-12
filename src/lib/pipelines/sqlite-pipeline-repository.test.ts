import { describe, expect, it } from "vitest"

import {
  DEMO_ACCOUNT_ID,
  DEMO_PIPELINE_ID,
  SqlitePipelineRepository,
} from "./sqlite-pipeline-repository"

describe("SqlitePipelineRepository", () => {
  it("lists seeded pipelines in their configured order", async () => {
    const repository = new SqlitePipelineRepository()

    const pipelines = await repository.listPipelines()

    expect(pipelines.map((pipeline) => pipeline.name)).toEqual([
      "Sales Pipeline",
      "Renewals",
    ])
    expect(pipelines.every((pipeline) => pipeline.accountId === DEMO_ACCOUNT_ID)).toBe(true)
  })

  it("builds a complete relational snapshot for the demo pipeline", async () => {
    const repository = new SqlitePipelineRepository()

    const snapshot = await repository.getSnapshot(DEMO_PIPELINE_ID)

    expect(snapshot).not.toBeNull()
    expect(snapshot?.stages.map((stage) => stage.name)).toEqual([
      "Qualified",
      "Proposal",
      "Won",
    ])
    expect(snapshot?.deals).toHaveLength(2)
    expect(snapshot?.deals[0].contact?.name).toBe("Jordan Lee")
    expect(snapshot?.deals[0].owner?.name).toBe("Avery Johnson")
    expect(snapshot?.savedViews[0].visibleFields).toEqual([
      "title",
      "value",
      "owner",
    ])
    expect(snapshot?.subPipelines[0].dealIds).toEqual([
      "00000000-0000-4000-8000-000000000701",
      "00000000-0000-4000-8000-000000000702",
    ])
  })

  it("returns null for a pipeline outside the selected account", async () => {
    const repository = new SqlitePipelineRepository(
      "00000000-0000-4000-8000-000000009999"
    )

    await expect(repository.listPipelines()).resolves.toEqual([])
    await expect(repository.getSnapshot(DEMO_PIPELINE_ID)).resolves.toBeNull()
  })
})
