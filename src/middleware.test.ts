import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — what getUser() resolves to (a refreshed session ⇒ user,
//                      or null for the logged-out path).
// `refreshedCookies` — cookies Supabase writes via setAll() during getUser(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the middleware returns — including redirects.
let mockUser: { id: string } | null = null;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    },
  ) => ({
    auth: {
      // Mirrors real auth-js: getClaims() verifies the JWT locally; when
      // the access token is expired it is transparently refreshed, which
      // rotates the refresh token and pushes the new cookies through
      // setAll() before resolving.
      getClaims: async () => {
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return {
          data: mockUser ? { claims: { sub: mockUser.id } } : null,
          error: null,
        };
      },
    },
  }),
}));

// Imported after the mock is registered.
const { proxy: middleware } = await import("./proxy");

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockUser = null;
  refreshedCookies = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

const ROTATED = {
  name: "sb-test-auth-token",
  value: "rotated-refresh-token",
  options: { path: "/", httpOnly: true },
};

/**
 * The proxy fast-path skips getUser() entirely when the request has no
 * `sb-*-auth-token` cookie (anonymous visitors cost zero network).
 * These tests exercise the *session* path, so every request must carry
 * an existing auth cookie — exactly like a real browser with a session.
 */
function requestWithSession(url: string) {
  return new NextRequest(url, {
    headers: { cookie: "sb-test-auth-token=existing-token" },
  });
}

describe("middleware — refreshed auth cookies survive redirects", () => {
  it("carries the rotated token when redirecting a signed-in user off /login", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(requestWithSession("https://app.test/login"));

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("carries the rotated token when redirecting an unauth user to /login", async () => {
    mockUser = null;
    // Even on the logged-out path getUser() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: "cleared" }];

    const res = await middleware(requestWithSession("https://app.test/dashboard"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/login");
    expect(res.headers.get("location")).not.toContain("next=");
    expect(res.cookies.get(ROTATED.name)?.value).toBe("cleared");
  });

  it("redirects a signed-in user with an invite token to /join/<token>", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(requestWithSession("https://app.test/login?invite=abc123"));

    expect(res.headers.get("location")).toContain("/join/abc123");
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("passes through (no redirect) for a signed-in user on a protected page", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(requestWithSession("https://app.test/dashboard"));

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("redirects an anonymous visitor (no auth cookie) to /login without calling Supabase", async () => {
    mockUser = { id: "should-not-be-consulted" };
    refreshedCookies = [ROTATED];

    const res = await middleware(new NextRequest("https://app.test/dashboard"));

    // Fast path: no sb-* cookie -> no getUser() network round trip.
    // The redirect happens purely from cookie inspection, so the mock's
    // rotated cookie must NOT appear on the response.
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://app.test/login");
    expect(res.cookies.get(ROTATED.name)).toBeUndefined();
  });

  it("lets an anonymous visitor pass through public pages without calling Supabase", async () => {
    mockUser = null;
    refreshedCookies = [];

    const res = await middleware(new NextRequest("https://app.test/login"));

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});
