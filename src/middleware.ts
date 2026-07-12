import { NextResponse, type NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  if (["/", "/login", "/signup", "/forgot-password"].includes(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
}
