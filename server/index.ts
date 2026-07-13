import { createApp } from "./app"
import { loadServerConfig } from "./config"

const config = loadServerConfig()
const app = createApp(config)
const server = app.listen(config.API_PORT, config.API_HOST, () => {
  console.log(`[api] listening on http://${config.API_HOST}:${config.API_PORT}`)
})

// Without this handler a bind failure (e.g. EADDRINUSE from a stale process)
// exits the process silently and the API appears "up" while serving nothing.
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `[api] port ${config.API_PORT} is already in use; retrying in 2s...`,
    )
    setTimeout(() => {
      server.close()
      server.listen(config.API_PORT, config.API_HOST)
    }, 2_000)
    return
  }
  console.error("[api] failed to start", error)
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
