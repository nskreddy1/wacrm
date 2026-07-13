import { describe, expect, it } from "vitest"
import {
  accountIdFromPath,
  contactsPath,
  dashboardHref,
  enterpriseContactPath,
  enterpriseContactsPath,
  enterpriseDealsPath,
  isModulePath,
  isOpaqueId,
  isUuid,
  pipelineModeFromRoute,
  pipelinePath,
} from "./dashboard-routes"

const accountId = "123e4567-e89b-42d3-a456-426614174000"
const pipelineId = "223e4567-e89b-42d3-a456-426614174001"
const subPipelineId = "323e4567-e89b-42d3-a456-426614174002"
const viewId = "423e4567-e89b-42d3-a456-426614174003"

describe("dashboard routes", () => {
  it("builds simple canonical module URLs", () => {
    expect(dashboardHref(accountId, "/contacts")).toBe("/contacts")
    expect(dashboardHref(accountId, "/pipelines")).toBe("/pipelines")
    expect(contactsPath(accountId, { mode: "sheet", view: viewId })).toBe(`/contacts?mode=sheet&view=${viewId}`)
    expect(pipelinePath(accountId, pipelineId, "sheet", { subPipeline: subPipelineId, savedView: viewId })).toBe(`/pipelines?pipeline=${pipelineId}&view=sheet&sub_pipeline=${subPipelineId}&saved_view=${viewId}`)
  })

  it("retains legacy URL builders for compatibility redirects", () => {
    expect(enterpriseDealsPath(accountId, pipelineId, "board", { subPipeline: subPipelineId, savedView: viewId })).toBe(`/bigin/org/${accountId}/home/deals/kanban/${viewId}?pipeline=${pipelineId}&sub_pipeline=${subPipelineId}`)
    expect(enterpriseContactsPath(accountId, "sheet", viewId)).toBe(`/bigin/org/${accountId}/home/contacts/sheet/${viewId}`)
    expect(enterpriseContactPath(accountId, pipelineId, { view: viewId, mode: "cards" })).toBe(`/bigin/org/${accountId}/home/contacts/${pipelineId}?view=${viewId}&mode=cards`)
  })

  it("extracts tenant identity only from legacy paths", () => {
    expect(accountIdFromPath(`/bigin/org/${accountId}/home/deals`)).toBe(accountId)
    expect(accountIdFromPath(`/org/${accountId}/pipelines`)).toBe(accountId)
    expect(accountIdFromPath("/pipelines")).toBeNull()
  })

  it("normalizes kanban and rejects unknown modes", () => {
    expect(pipelineModeFromRoute("kanban")).toBe("board")
    expect(pipelineModeFromRoute("timeline")).toBeNull()
  })

  it("validates identifiers and module activity", () => {
    expect(isUuid(accountId)).toBe(true)
    expect(isUuid("org60077240367")).toBe(false)
    expect(isOpaqueId("all")).toBe(true)
    expect(isOpaqueId("../escape")).toBe(false)
    expect(isModulePath(`/bigin/org/${accountId}/home/deals/kanban/${viewId}`, "deals")).toBe(true)
  })
})
