import { describe, expect, it } from "vitest"

import { resolveServiceApiUrl } from "./service-api-url"

describe("resolveServiceApiUrl", () => {
  it("uses the local defaults", () => {
    expect(resolveServiceApiUrl({})).toBe("http://127.0.0.1:4000")
  })

  it("derives the URL from API_HOST and API_PORT", () => {
    expect(resolveServiceApiUrl({ API_HOST: "localhost", API_PORT: "4400" })).toBe(
      "http://localhost:4400",
    )
  })

  it("prefers an explicit EXPRESS_API_URL", () => {
    expect(
      resolveServiceApiUrl({
        API_HOST: "localhost",
        API_PORT: "4400",
        EXPRESS_API_URL: "https://api.internal.example",
      }),
    ).toBe("https://api.internal.example")
  })

  it("rejects invalid ports", () => {
    expect(() => resolveServiceApiUrl({ API_PORT: "70000" })).toThrow("Invalid API_PORT")
  })
})
