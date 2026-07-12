import { describe, expect, it } from "vitest"
import { BoundedMemoryCache } from "./dashboard-cache-provider"

describe("bounded dashboard memory cache", () => {
  it("evicts the least recently used entry", () => {
    const cache = new BoundedMemoryCache(2)
    cache.set("account-a:contacts", { data: "contacts" })
    cache.set("account-a:deals", { data: "deals" })
    cache.get("account-a:contacts")
    cache.set("account-a:settings", { data: "settings" })
    expect(cache.has("account-a:contacts")).toBe(true)
    expect(cache.has("account-a:deals")).toBe(false)
  })

  it("clears all in-memory tenant records without persistence", () => {
    const cache = new BoundedMemoryCache(2)
    cache.set("account-a:contacts", { data: [] })
    cache.clear()
    expect(cache.size).toBe(0)
  })
})
