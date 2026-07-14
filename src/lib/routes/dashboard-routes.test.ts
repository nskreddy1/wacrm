import { describe, expect, it } from "vitest"
import {
  contactsPath,
  isOpaqueId,
  isUuid,
  pipelinePath,
} from "./dashboard-routes"

const accountId = "123e4567-e89b-42d3-a456-426614174000"
const pipelineId = "223e4567-e89b-42d3-a456-426614174001"
const subPipelineId = "323e4567-e89b-42d3-a456-426614174002"
const viewId = "423e4567-e89b-42d3-a456-426614174003"

describe("dashboard routes", () => {
  it("builds simple canonical module URLs", () => {
    expect(contactsPath(accountId, { mode: "sheet", view: viewId })).toBe(`/contacts?mode=sheet&view=${viewId}`)
    expect(pipelinePath(accountId, pipelineId, "sheet", { subPipeline: subPipelineId, savedView: viewId })).toBe(`/pipelines?pipeline=${pipelineId}&view=sheet&sub_pipeline=${subPipelineId}&saved_view=${viewId}`)
  })

  it("omits default state from canonical URLs", () => {
    expect(contactsPath(accountId)).toBe("/contacts")
    expect(contactsPath(accountId, { mode: "list", view: "all" })).toBe("/contacts")
    expect(pipelinePath(accountId, pipelineId)).toBe(`/pipelines?pipeline=${pipelineId}`)
  })

  it("validates identifiers", () => {
    expect(isUuid(accountId)).toBe(true)
    expect(isUuid("org60077240367")).toBe(false)
    expect(isOpaqueId("all")).toBe(true)
    expect(isOpaqueId("../escape")).toBe(false)
  })
})
