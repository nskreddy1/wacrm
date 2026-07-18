// ============================================================
// Bot payload parsing/validation shared by the bots API routes
// (POST /api/ai/bots and PATCH /api/ai/bots/[id]).
//
// One strict parser so create and edit enforce identical rules and
// the DB CHECK constraints are never the first line of defense.
// Field-presence aware: PATCH sends only what changed, so every field
// is optional and reported in `provided` — absent means "leave as is".
// ============================================================

import { isBotTone } from './bot-templates'
import type {
  BotTone,
  OutsideHoursBehavior,
  WorkingHours,
  WorkingHoursDay,
} from './types'

/** Columns the bots API returns to the client (everything — no secrets
 *  live on `ai_bots`; credentials stay on `ai_configs`). */
export const BOT_SELECT_COLUMNS =
  'id, account_id, created_by, name, description, emoji, system_prompt, tone, language, greeting_message, temperature, model_override, auto_reply_max_per_conversation, handoff_agent_id, working_hours, outside_hours_behavior, away_message, use_knowledge_base, is_active, template_key, created_at, updated_at'

export interface ParsedBotPayload {
  /** Column → value, only for fields present in the request body. */
  fields: Record<string, unknown>
  /** Handoff agent id needs a membership check by the caller. */
  handoffAgentId: string | null
  handoffProvided: boolean
}

export class BotPayloadError extends Error {}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function parseWorkingHoursDay(value: unknown): WorkingHoursDay | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') {
    throw new BotPayloadError('working_hours day must be {start,end} or null')
  }
  const { start, end } = value as Record<string, unknown>
  if (
    typeof start !== 'string' ||
    typeof end !== 'string' ||
    !HHMM.test(start) ||
    !HHMM.test(end)
  ) {
    throw new BotPayloadError('working_hours times must be "HH:MM" (24h)')
  }
  return { start, end }
}

/** Validate the `{ timezone, days }` schedule shape; null = always on. */
export function parseWorkingHours(value: unknown): WorkingHours | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BotPayloadError('working_hours must be an object or null')
  }
  const { timezone, days } = value as Record<string, unknown>
  if (typeof timezone !== 'string' || !timezone.trim()) {
    throw new BotPayloadError('working_hours.timezone is required')
  }
  // Reject unknown IANA zones up front — Intl throws on bad zones.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone.trim() })
  } catch {
    throw new BotPayloadError(
      `working_hours.timezone is not a valid IANA timezone: ${timezone}`,
    )
  }
  if (typeof days !== 'object' || days === null || Array.isArray(days)) {
    throw new BotPayloadError('working_hours.days must be an object')
  }
  const parsedDays: WorkingHours['days'] = {}
  for (const key of Object.keys(days)) {
    if (!DAY_KEYS.includes(key as (typeof DAY_KEYS)[number])) {
      throw new BotPayloadError(`working_hours.days has unknown day: ${key}`)
    }
    parsedDays[key as (typeof DAY_KEYS)[number]] = parseWorkingHoursDay(
      (days as Record<string, unknown>)[key],
    )
  }
  return { timezone: timezone.trim(), days: parsedDays }
}

/**
 * Parse + validate a bot create/update body. Only fields PRESENT in
 * the body land in `fields` (snake_case column names, ready to
 * insert/update). Throws `BotPayloadError` with a user-safe message.
 */
export function parseBotPayload(body: Record<string, unknown>): ParsedBotPayload {
  const fields: Record<string, unknown> = {}

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) throw new BotPayloadError('name is required')
    if (name.length > 80) throw new BotPayloadError('name must be ≤ 80 characters')
    fields.name = name
  }

  if ('description' in body) {
    const d = typeof body.description === 'string' ? body.description.trim() : ''
    if (d.length > 500) {
      throw new BotPayloadError('description must be ≤ 500 characters')
    }
    fields.description = d || null
  }

  if ('emoji' in body) {
    const e = typeof body.emoji === 'string' ? body.emoji.trim() : ''
    if (e.length > 16) throw new BotPayloadError('emoji must be a single emoji')
    fields.emoji = e || null
  }

  if ('system_prompt' in body) {
    const p = typeof body.system_prompt === 'string' ? body.system_prompt.trim() : ''
    if (!p) throw new BotPayloadError('system_prompt is required')
    if (p.length > 8000) {
      throw new BotPayloadError('system_prompt must be ≤ 8000 characters')
    }
    fields.system_prompt = p
  }

  if ('tone' in body) {
    if (!isBotTone(body.tone)) {
      throw new BotPayloadError(
        'tone must be one of: professional, friendly, casual, formal, playful',
      )
    }
    fields.tone = body.tone satisfies BotTone
  }

  if ('language' in body) {
    const l = typeof body.language === 'string' ? body.language.trim() : ''
    if (l.length > 40) throw new BotPayloadError('language must be ≤ 40 characters')
    fields.language = l || 'auto'
  }

  if ('greeting_message' in body) {
    const g =
      typeof body.greeting_message === 'string' ? body.greeting_message.trim() : ''
    if (g.length > 1000) {
      throw new BotPayloadError('greeting_message must be ≤ 1000 characters')
    }
    fields.greeting_message = g || null
  }

  if ('temperature' in body) {
    if (body.temperature === null || body.temperature === '') {
      fields.temperature = null
    } else {
      const t = Number(body.temperature)
      if (!Number.isFinite(t) || t < 0 || t > 2) {
        throw new BotPayloadError('temperature must be between 0 and 2')
      }
      fields.temperature = t
    }
  }

  if ('model_override' in body) {
    const m = typeof body.model_override === 'string' ? body.model_override.trim() : ''
    if (m.length > 120) {
      throw new BotPayloadError('model_override must be ≤ 120 characters')
    }
    fields.model_override = m || null
  }

  if ('auto_reply_max_per_conversation' in body) {
    if (
      body.auto_reply_max_per_conversation === null ||
      body.auto_reply_max_per_conversation === ''
    ) {
      fields.auto_reply_max_per_conversation = null
    } else {
      const n = Number(body.auto_reply_max_per_conversation)
      if (!Number.isInteger(n) || n < 0 || n > 500) {
        throw new BotPayloadError(
          'auto_reply_max_per_conversation must be an integer between 0 (unlimited) and 500',
        )
      }
      fields.auto_reply_max_per_conversation = n
    }
  }

  // Reported separately — the route must verify account membership
  // before persisting (a bot must not hand off to a stranger).
  let handoffAgentId: string | null = null
  const handoffProvided = 'handoff_agent_id' in body
  if (handoffProvided) {
    const raw =
      typeof body.handoff_agent_id === 'string' ? body.handoff_agent_id.trim() : ''
    handoffAgentId = raw || null
  }

  if ('working_hours' in body) {
    fields.working_hours = parseWorkingHours(body.working_hours)
  }

  if ('outside_hours_behavior' in body) {
    const b = body.outside_hours_behavior
    if (b !== 'silent' && b !== 'away_message') {
      throw new BotPayloadError(
        "outside_hours_behavior must be 'silent' or 'away_message'",
      )
    }
    fields.outside_hours_behavior = b satisfies OutsideHoursBehavior
  }

  if ('away_message' in body) {
    const a = typeof body.away_message === 'string' ? body.away_message.trim() : ''
    if (a.length > 1000) {
      throw new BotPayloadError('away_message must be ≤ 1000 characters')
    }
    fields.away_message = a || null
  }

  if ('use_knowledge_base' in body) {
    fields.use_knowledge_base = body.use_knowledge_base === true
  }

  if ('template_key' in body) {
    const k = typeof body.template_key === 'string' ? body.template_key.trim() : ''
    if (k.length > 80) {
      throw new BotPayloadError('template_key must be ≤ 80 characters')
    }
    fields.template_key = k || null
  }

  return { fields, handoffAgentId, handoffProvided }
}
