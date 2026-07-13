import { apiErrorSchema } from "@/contracts/api"
import { routes } from "@/lib/routing/routes"

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "request_failed",
    readonly requestId?: string,
  ) {
    super(message)
    this.name = "ApiClientError"
  }
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown }

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set("accept", "application/json")

  let body: BodyInit | undefined
  if (options.body !== undefined) {
    headers.set("content-type", "application/json")
    body = JSON.stringify(options.body)
  }

  const response = await fetch(routes.api.service(path), {
    ...options,
    headers,
    body,
    credentials: "same-origin",
  })

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload)
    throw new ApiClientError(
      parsed.success ? parsed.data.error.message : "The request could not be completed",
      response.status,
      parsed.success ? parsed.data.error.code : "request_failed",
      parsed.success ? parsed.data.error.requestId : undefined,
    )
  }

  return payload as T
}
