import { describe, expect, it } from "vitest"
import { accountIdFromPath, pipelinePath } from "./dashboard-routes"

describe("dashboard routes", () => {
  it("builds canonical pipeline URLs with durable state", () => {
    expect(pipelinePath("account one", "pipeline/one", "sheet", { subPipeline: "sub 1", savedView: "view 1" })).toBe("/org/account%20one/pipelines/pipeline%2Fone/sheet?subPipeline=sub+1&savedView=view+1")
  })
  it("extracts the account identity", () => expect(accountIdFromPath("/org/acct-1/pipelines/p-1/board")).toBe("acct-1"))
  it("does not confuse tenant paths", () => expect(accountIdFromPath("/pipelines")).toBeNull())
})
