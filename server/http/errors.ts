import type { ErrorRequestHandler, RequestHandler } from "express"

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = "HttpError"
  }
}

export const notFound: RequestHandler = (request, response) => {
  response.status(404).json({
    error: {
      code: "not_found",
      message: "The requested API resource was not found",
      requestId: request.id,
    },
  })
}

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  const known = error instanceof HttpError
  const status = known ? error.status : 500

  if (!known) request.log.error({ error }, "Unhandled API error")

  response.status(status).json({
    error: {
      code: known ? error.code : "internal_error",
      message: known ? error.message : "Internal server error",
      requestId: request.id,
      ...(known && error.details !== undefined ? { details: error.details } : {}),
    },
  })
}
