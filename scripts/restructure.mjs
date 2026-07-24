#!/usr/bin/env node
/**
 * One-off feature-module restructure codemod (safe to delete after migration).
 * 1. git mv directories/files into src/features/<domain>/
 * 2. Rewrite @/ import specifiers project-wide (regex with boundary lookahead)
 */
import { execSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const root = "/vercel/share/v0-project"
process.chdir(root)

const sh = (cmd) => execSync(cmd, { stdio: "pipe" }).toString()

// ---- move map ----
const componentDomains = {
  admin: "admin", agents: "agents", appointments: "appointments",
  assistant: "assistant", auth: "auth", automations: "automations",
  brand: "brand", broadcasts: "broadcasts", catalog: "catalog",
  contacts: "contacts", dashboard: "dashboards", flows: "flows",
  inbox: "inbox", interactive: "interactive", pipelines: "pipelines",
  presence: "presence", settings: "settings", support: "support",
  "team-chat": "team-chat", templates: "templates",
}

const libDirDomains = {
  "api-keys": "api-keys", auth: "auth", automations: "automations",
  channels: "channels", contacts: "contacts", dashboards: "dashboards",
  "external-sources": "external-sources", flows: "flows", inbox: "inbox",
  "module-fields": "module-fields", pipelines: "pipelines",
  support: "support", templates: "templates", webhooks: "webhooks",
  whatsapp: "whatsapp", assistant: "assistant",
}

// special lib dirs nested under a feature's lib/
const libNested = [
  ["src/lib/ai", "src/features/assistant/lib/ai", "@/lib/ai", "@/features/assistant/lib/ai"],
  ["src/lib/platform", "src/features/admin/lib/platform", "@/lib/platform", "@/features/admin/lib/platform"],
  ["src/lib/orchestration", "src/features/admin/lib/orchestration", "@/lib/orchestration", "@/features/admin/lib/orchestration"],
]

// loose lib files
const libFiles = [
  ["src/lib/broadcast-status.ts", "src/features/broadcasts/lib/broadcast-status.ts", "@/lib/broadcast-status", "@/features/broadcasts/lib/broadcast-status"],
  ["src/lib/broadcast-status.test.ts", "src/features/broadcasts/lib/broadcast-status.test.ts", null, null],
  ["src/lib/template-status.ts", "src/features/templates/lib/template-status.ts", "@/lib/template-status", "@/features/templates/lib/template-status"],
  ["src/lib/presence.ts", "src/features/presence/lib/presence.ts", "@/lib/presence", "@/features/presence/lib/presence"],
  ["src/lib/presence.test.ts", "src/features/presence/lib/presence.test.ts", null, null],
]

// hooks
const hookMoves = [
  ["use-auth.tsx", "auth"], ["use-can.ts", "auth"],
  ["use-broadcast-sending.ts", "broadcasts"],
  ["use-dashboard-overview.ts", "dashboards"],
  ["use-presence.ts", "presence"],
  ["use-realtime.ts", "inbox"], ["use-total-unread.ts", "inbox"],
  ["use-studio-templates.ts", "templates"], ["use-template-variables.ts", "templates"],
  ["use-team-chat.ts", "team-chat"],
]

const rewrites = []

// ---- perform moves ----
const gitMv = (src, dest) => {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  sh(`git mv "${src}" "${dest}"`)
  console.log(`moved ${src} -> ${dest}`)
}

for (const [src, domain] of Object.entries(componentDomains)) {
  gitMv(`src/components/${src}`, `src/features/${domain}/components`)
  rewrites.push([`@/components/${src}`, `@/features/${domain}/components`])
}
for (const [src, domain] of Object.entries(libDirDomains)) {
  gitMv(`src/lib/${src}`, `src/features/${domain}/lib`)
  rewrites.push([`@/lib/${src}`, `@/features/${domain}/lib`])
}
for (const [src, dest, from, to] of libNested) {
  gitMv(src, dest)
  rewrites.push([from, to])
}
for (const [src, dest, from, to] of libFiles) {
  gitMv(src, dest)
  if (from) rewrites.push([from, to])
}
for (const [file, domain] of hookMoves) {
  const base = file.replace(/\.(tsx?|ts)$/, "")
  gitMv(`src/hooks/${file}`, `src/features/${domain}/hooks/${file}`)
  rewrites.push([`@/hooks/${base}`, `@/features/${domain}/hooks/${base}`])
}

// ---- rewrite imports ----
// longest keys first to avoid prefix shadowing; boundary lookahead (quote or /)
rewrites.sort((a, b) => b[0].length - a[0].length)

const exts = new Set([".ts", ".tsx", ".mts", ".mjs", ".js"])
const targets = []
;(function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    if (["node_modules", ".next", ".git", "dist"].includes(entry)) continue
    const p = path.join(dir, entry)
    const stat = fs.statSync(p)
    if (stat.isDirectory()) walk(p)
    else if (exts.has(path.extname(p))) targets.push(p)
  }
})("src")

let changed = 0
for (const file of targets) {
  let text = fs.readFileSync(file, "utf8")
  const orig = text
  for (const [from, to] of rewrites) {
    const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + `(?=['"/])`, "g")
    text = text.replace(re, to)
  }
  if (text !== orig) {
    fs.writeFileSync(file, text)
    changed++
  }
}
console.log(`\nrewrote imports in ${changed} files`)
