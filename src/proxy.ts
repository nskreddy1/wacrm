import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { authRouteSet, routes } from "@/lib/routing/routes"

const PUBLIC_PREFIXES = [
  "/auth/",
  "/brand",
  "/join/",
  "/api/service/",
  "/api/webhooks/",
  "/api/v1/",
  // Provider webhooks authenticate via request signatures inside the route handlers.
  "/api/channels/webhooks/",
  "/api/whatsapp/webhook",
]

function isPublicPath(pathname: string) {
  return pathname === routes.home || authRouteSet.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function redirectWithCookies(request: NextRequest, pathname: string, source: NextResponse) {
  const target = request.nextUrl.clone()
  target.pathname = pathname
  target.search = ""
  const response = NextResponse.redirect(target)
  source.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
  return response
}

function authenticatedDestination(request: NextRequest) {
  const invite = request.nextUrl.searchParams.get("invite")
  return invite ? routes.app.invite(invite) : routes.app.dashboard
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return response

  const pathname = request.nextUrl.pathname

  // PERF: `supabase.auth.getUser()` is a network round-trip to the
  // Supabase Auth server on EVERY request — the main reason page
  // navigation felt slow. If the visitor has no Supabase auth cookie
  // (`sb-*-auth-token*`), there is no session to validate or refresh:
  // skip the call entirely. Anonymous users navigating between public
  // pages (login <-> signup <-> forgot-password) now pass through with
  // zero network cost; everyone else gets the full validation below.
  const hasAuthCookie = request.cookies
    .getAll()
    .some(({ name }) => name.startsWith("sb-") && name.includes("-auth-token"))

  if (!hasAuthCookie) {
    if (isPublicPath(pathname)) return response
    return redirectWithCookies(request, routes.auth.login, response)
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()

  if (user && (pathname === routes.home || authRouteSet.has(pathname))) {
    return redirectWithCookies(request, authenticatedDestination(request), response)
  }
  if (!user && !isPublicPath(pathname)) {
    return redirectWithCookies(request, routes.auth.login, response)
  }
  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
