import { toNextJsHandler } from "better-auth/next-js"

async function handler(request: Request) {
  const { neonAuth } = await import("@/lib/neon/auth")
  return toNextJsHandler(neonAuth.handler)[request.method === "GET" ? "GET" : "POST"](request)
}

export const GET = handler
export const POST = handler
