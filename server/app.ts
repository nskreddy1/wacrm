/**
 * @deprecated LEGACY — Express service (local/dev compatibility only).
 *
 * All production API traffic is served by same-origin Next.js Route
 * Handlers under `src/app/api/*`, deployed on Vercel. This Express
 * process is NOT part of the production path: nothing in `src/`
 * references it, and the Vercel deployment neither builds nor runs it.
 * The account endpoint now lives at `src/app/api/account/route.ts`.
 *
 * Run locally (only if needed): `pnpm legacy:api`
 */
import { randomUUID } from "node:crypto"

import express from "express"
import helmet from "helmet"
import pinoHttp from "pino-http"

import type { ServerConfig } from "./config"
import { accountRouter } from "./domains/account/routes"
import { authenticate } from "./http/auth"
import { errorHandler, notFound } from "./http/errors"

export function createApp(config: ServerConfig) {
  const app = express()

  app.disable("x-powered-by")
  app.use(helmet())
  app.use(
    pinoHttp({
      genReqId(request, response) {
        const incoming = request.headers["x-request-id"]
        const requestId = typeof incoming === "string" && incoming.length <= 128 ? incoming : randomUUID()
        response.setHeader("x-request-id", requestId)
        return requestId
      },
      redact: ["req.headers.authorization", "req.headers.cookie"],
    }),
  )
  app.use(express.json({ limit: "1mb" }))

  app.get("/health/live", (_request, response) => response.json({ status: "ok" }))
  app.get("/health/ready", (_request, response) => response.json({ status: "ready" }))

  const authenticated = express.Router()
  authenticated.use(authenticate(config))
  authenticated.use("/account", accountRouter())
  app.use("/v1", authenticated)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
