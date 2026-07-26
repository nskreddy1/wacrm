import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { authRouteSet, routes } from '@/lib/routing/routes';
import { authCookieOptions } from '@/lib/supabase/cookie-options';

const PUBLIC_PREFIXES = [
  '/auth/',
  '/brand',
  '/join/',
  '/api/webhooks/',
  '/api/v1/',
  // Provider webhooks authenticate via request signatures inside the route handlers.
  '/api/channels/webhooks/',
  '/api/whatsapp/webhook',
  // Scheduler endpoint. It has no user session by definition (Vercel Cron
  // sends `Authorization: Bearer $CRON_SECRET`; external pingers send
  // `x-cron-secret`) and authenticates with a constant-time compare inside
  // the route handler. Without this exemption the proxy 307-redirects the
  // scheduler to /login, so the flow engine's time-based work — resuming
  // `wait` steps, starting scheduled flows, sweeping stale runs — never runs.
  '/api/flows/cron',
];

function isPublicPath(pathname: string) {
  return (
    pathname === routes.home ||
    authRouteSet.has(pathname) ||
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

function redirectWithCookies(
  request: NextRequest,
  pathname: string,
  source: NextResponse
) {
  const target = request.nextUrl.clone();
  target.pathname = pathname;
  target.search = '';
  const response = NextResponse.redirect(target);
  source.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  return response;
}

function authenticatedDestination(request: NextRequest) {
  const invite = request.nextUrl.searchParams.get('invite');
  return invite ? routes.app.invite(invite) : routes.app.dashboard;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const pathname = request.nextUrl.pathname;

  // PERF: `supabase.auth.getUser()` is a network round-trip to the
  // Supabase Auth server on EVERY request — the main reason page
  // navigation felt slow. If the visitor has no Supabase auth cookie
  // (`sb-*-auth-token*`), there is no session to validate or refresh:
  // skip the call entirely. Anonymous users navigating between public
  // pages (login <-> signup <-> forgot-password) now pass through with
  // zero network cost; everyone else gets the full validation below.
  const hasAuthCookie = request.cookies
    .getAll()
    .some(({ name }) => name.startsWith('sb-') && name.includes('-auth-token'));

  if (!hasAuthCookie) {
    if (isPublicPath(pathname)) return response;
    return redirectWithCookies(request, routes.auth.login, response);
  }

  const supabase = createServerClient(url, key, {
    // Same attributes as the browser/server clients: refreshed tokens
    // must survive in embedded preview iframes (third-party context).
    cookieOptions: authCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // PERF: `getClaims()` verifies the JWT locally (signature + `exp`
  // expiration check against the project's public signing keys) with no
  // network round-trip on the hot path — unlike `getUser()`, which
  // called the Supabase Auth server on every request. When the access
  // token is expired, the client transparently refreshes it via the
  // refresh token (one network call, only near expiry) and the new
  // cookies propagate through the `setAll` handler above. Security is
  // unchanged: expired or tampered tokens fail verification and the
  // request is treated as signed out.
  const { data: claims } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(claims?.claims.sub);

  if (
    isAuthenticated &&
    (pathname === routes.home || authRouteSet.has(pathname))
  ) {
    return redirectWithCookies(
      request,
      authenticatedDestination(request),
      response
    );
  }
  if (!isAuthenticated && !isPublicPath(pathname)) {
    return redirectWithCookies(request, routes.auth.login, response);
  }
  return response;
}

export const config = {
  matcher: [
    // `robots.txt` and `icon` are generated metadata routes that must stay
    // publicly reachable. Without excluding them the auth guard 307s
    // crawlers to /login, so our "do not index" rules are never actually
    // delivered — the guard silently defeats the very file meant to keep
    // this private CRM out of search results.
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
