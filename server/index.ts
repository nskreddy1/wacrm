import { createApp } from "./app"
import { loadServerConfig } from "./config"

const config = loadServerConfig()
const app = createApp(config)
const server = app.listen(config.API_PORT, config.API_HOST, () => {
  console.log(`[api] listening on http://${config.API_HOST}:${config.API_PORT}`)
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
