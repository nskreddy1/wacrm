import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

const command = process.argv[2]
if (command !== "dev" && command !== "start") {
  console.error("Usage: node scripts/run-web.mjs <dev|start>")
  process.exit(1)
}

const rawPort = process.env.WEB_PORT ?? "3000"
const port = Number(rawPort)
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error(`Invalid WEB_PORT: ${rawPort}. Expected an integer from 1 to 65535.`)
  process.exit(1)
}

const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url))
const child = spawn(process.execPath, [nextBin, command, "--port", String(port)], {
  env: process.env,
  stdio: "inherit",
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal))
}

child.on("error", (error) => {
  console.error(`[web] failed to start: ${error.message}`)
  process.exit(1)
})

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
