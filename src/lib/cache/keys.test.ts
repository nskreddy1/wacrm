import { describe, expect, it } from "vitest"
import { cacheKeys } from "./keys"

describe("tenant cache keys", () => {
  it("isolates snapshots by account and pipeline", () => {
    expect(cacheKeys.pipelineSnapshot("a", "p")).not.toEqual(cacheKeys.pipelineSnapshot("b", "p"))
    expect(cacheKeys.pipelineSnapshot("a", "p")).not.toEqual(cacheKeys.pipelineSnapshot("a", "q"))
  })
})
