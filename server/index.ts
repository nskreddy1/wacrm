import { createApp } from "./app"
import { loadServerConfig } from "./config"

const config = loadServerConfig()
const app = createApp(config)
const server = app.listen(config.API_PORT, config.API_HOST, () => {
  console.log(`[api] listening on http://${config.API_HOST}:${config.API_PORT}`)
})

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    // During a v0 environment restart, the previous API process can remain
    // alive briefly. Do not retry forever: that keeps concurrently in a
    // broken initialization state and prevents the preview from attaching.
    console.error(`[api] port ${config.API_PORT} is already in use`)
  } else {
    console.error("[api] failed to start", error)
  }
  process.exit(1)
})

let shuttingDown = false
function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[api] received ${signal}; shutting down`)

  server.close((error) => {
    if (error) {
      console.error("[api] graceful shutdown failed", error)
      process.exitCode = 1
    }
  })

  setTimeout(() => {
    console.error("[api] forced shutdown after timeout")
    process.exit(1)
  }, 10_000).unref()
}

process.on("SIGINT", () => shutdown("SIGINT"))
process.on("SIGTERM", () => shutdown("SIGTERM"))
