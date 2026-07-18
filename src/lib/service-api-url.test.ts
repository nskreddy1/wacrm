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

  it("requires an explicit API URL on Vercel", () => {
    expect(() => resolveServiceApiUrl({ VERCEL: "1" })).toThrow(
      "EXPRESS_API_URL is required in production",
    )
  })

  it("requires an explicit API URL in other production environments", () => {
    expect(() => resolveServiceApiUrl({ NODE_ENV: "production" })).toThrow(
      "EXPRESS_API_URL is required in production",
    )
  })

  it("uses an explicit API URL on Vercel", () => {
    expect(
      resolveServiceApiUrl({
        VERCEL: "1",
        EXPRESS_API_URL: "https://wacrm-api.example.com/",
      }),
    ).toBe("https://wacrm-api.example.com")
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

  it("rejects non-HTTP service URLs", () => {
    expect(() => resolveServiceApiUrl({ EXPRESS_API_URL: "file:///tmp/socket" })).toThrow(
      "must use http or https",
    )
  })

  it("rejects credentials embedded in the service URL", () => {
    expect(() =>
      resolveServiceApiUrl({ EXPRESS_API_URL: "https://user:secret@api.internal.example" }),
    ).toThrow("must not contain credentials")
  })
})
