import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { getDatabaseProvider } from "@/lib/config/database-provider"

const AUTH_ROUTES = new Set(["/login", "/signup", "/forgot-password"])
const PUBLIC_PREFIXES = ["/auth/", "/api/auth/", "/join/", "/api/webhooks/", "/api/v1/"]

function isPublicPath(pathname: string) {
  return pathname === "/" || AUTH_ROUTES.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function redirectWithCookies(request: NextRequest, pathname: string, source: NextResponse) {
  const target = request.nextUrl.clone()
  target.pathname = pathname
  target.search = ""
  const response = NextResponse.redirect(target)
  source.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
  return response
}

function destinationForAuthenticatedRequest(request: NextRequest) {
  const invite = request.nextUrl.searchParams.get("invite")
  return invite ? `/join/${encodeURIComponent(invite)}` : "/dashboard"
}

async function supabaseMiddleware(request: NextRequest) {
  let response = NextResponse.next({ request })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) return response

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
  const pathname = request.nextUrl.pathname

  if (user && (pathname === "/" || AUTH_ROUTES.has(pathname))) {
    return redirectWithCookies(request, destinationForAuthenticatedRequest(request), response)
  }
  if (!user && !isPublicPath(pathname)) {
    const target = request.nextUrl.clone()
    target.pathname = "/login"
    target.search = ""
    target.searchParams.set("next", `${pathname}${request.nextUrl.search}`)
    const redirect = NextResponse.redirect(target)
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
    return redirect
  }
  return response
}

function hasBetterAuthSession(request: NextRequest) {
  return request.cookies.getAll().some(({ name, value }) =>
    Boolean(value) && (name === "better-auth.session_token" || name === "__Secure-better-auth.session_token"),
  )
}

function neonMiddleware(request: NextRequest) {
  const response = NextResponse.next({ request })
  const pathname = request.nextUrl.pathname
  const authenticated = hasBetterAuthSession(request)

  if (authenticated && (pathname === "/" || AUTH_ROUTES.has(pathname))) {
    return redirectWithCookies(request, destinationForAuthenticatedRequest(request), response)
  }
  if (!authenticated && !isPublicPath(pathname)) {
    const target = request.nextUrl.clone()
    target.pathname = "/login"
    target.search = ""
    target.searchParams.set("next", `${pathname}${request.nextUrl.search}`)
    return NextResponse.redirect(target)
  }
  return response
}

export async function middleware(request: NextRequest) {
  return getDatabaseProvider() === "neon" ? neonMiddleware(request) : supabaseMiddleware(request)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
