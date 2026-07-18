// ============================================================
// One-off dev helper: re-sync seeded test bots with the current
// built-in template catalog (system prompt + greeting + tone).
//
// Bots snapshot their template at creation time; when the shipped
// templates improve, existing test bots keep the stale prompt.
// This refreshes every bot that still points at a template_key,
// so the Playground exercises the new enterprise prompts.
//
// Usage:
//   node --env-file-if-exists=/vercel/share/.env.project scripts/refresh-test-bots.mjs
//
// Dev-only: intended for the seeded test account while the multi-bot
// feature is verified end-to-end. Safe to re-run (idempotent).
// ============================================================

import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const sb = createClient(url, key)

// --- Parse the built-in templates straight from the TS source so this
// script never drifts from the shipped catalog. The file is data-only
// (template literals + plain strings), so a scoped eval of the array
// after stripping types is reliable enough for a dev helper.
async function loadTemplates() {
  const src = await readFile(
    path.join(root, 'src/lib/ai/bot-templates.ts'),
    'utf8',
  )
  const start = src.indexOf('export const BUILT_IN_BOT_TEMPLATES')
  const eq = src.indexOf('=', start)
  const end = src.indexOf('\n]\n', eq)
  if (start === -1 || eq === -1 || end === -1) {
    throw new Error('Could not locate BUILT_IN_BOT_TEMPLATES in source')
  }
  const arrayLiteral = src.slice(eq + 1, end + 2)
  // eslint-disable-next-line no-new-func -- dev script, trusted local source
  return new Function(`return (${arrayLiteral})`)()
}

const templates = await loadTemplates()
const byKey = new Map(templates.map((t) => [t.key, t]))
console.log(`Loaded ${templates.length} built-in templates`)

const { data: bots, error } = await sb
  .from('ai_bots')
  .select('id, name, template_key, greeting_message, is_active')
if (error) throw error

let updated = 0
for (const bot of bots ?? []) {
  const tpl = bot.template_key ? byKey.get(bot.template_key) : null
  if (!tpl) {
    console.log(`- skip "${bot.name}" (no matching template_key: ${bot.template_key})`)
    continue
  }
  const { error: upErr } = await sb
    .from('ai_bots')
    .update({
      system_prompt: tpl.systemPrompt,
      tone: tpl.tone,
      // Ensure a visible greeting for end-to-end testing: keep an
      // operator-customized greeting if present, otherwise take the
      // template's (or a sensible default so the feature is exercised).
      greeting_message:
        bot.greeting_message?.trim() ||
        tpl.greetingMessage ||
        'Hi! Thanks for reaching out — how can I help you today?',
    })
    .eq('id', bot.id)
  if (upErr) {
    console.error(`- FAILED "${bot.name}":`, upErr.message)
    continue
  }
  updated++
  console.log(`- refreshed "${bot.name}" from template "${tpl.key}"${bot.is_active ? ' (active)' : ''}`)
}
console.log(`Done: ${updated}/${bots?.length ?? 0} bots refreshed`)
