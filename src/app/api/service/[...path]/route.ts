import { randomUUID } from "node:crypto"

import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"

export const runtime = "nodejs"

const allowedRequestHeaders = ["accept", "content-type", "if-match", "if-none-match"]
const allowedResponseHeaders = ["cache-control", "content-type", "etag", "retry-after", "x-request-id"]

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Authentication is required" } }, { status: 401 })
  }

  const { path } = await context.params
  const baseUrl = process.env.EXPRESS_API_URL ?? "http://127.0.0.1:4000"
  const upstream = new URL(`/v1/${path.map(encodeURIComponent).join("/")}`, baseUrl)
  upstream.search = request.nextUrl.search

  const headers = new Headers()
  for (const name of allowedRequestHeaders) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  headers.set("authorization", `Bearer ${session.access_token}`)
  headers.set("x-request-id", request.headers.get("x-request-id") ?? randomUUID())

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      signal: controller.signal,
    })
    const responseHeaders = new Headers()
    for (const name of allowedResponseHeaders) {
      const value = response.headers.get(name)
      if (value) responseHeaders.set(name, value)
    }
    return new NextResponse(response.body, { status: response.status, headers: responseHeaders })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError"
    return NextResponse.json(
      { error: { code: timedOut ? "upstream_timeout" : "upstream_unavailable", message: timedOut ? "The API request timed out" : "The API service is unavailable" } },
      { status: timedOut ? 504 : 503 },
    )
  } finally {
    clearTimeout(timeout)
  }
}

export const GET = forward
export const POST = forward
export const PUT = forward
export const PATCH = forward
export const DELETE = forward
