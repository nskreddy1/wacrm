import type { WorkingHours } from './types'

// ============================================================
// Working-hours evaluation for bot auto-reply.
//
// A bot with `working_hours = null` is always on. Otherwise the shape
// is { timezone, days: { mon: {start,end} | null, ... } } — a missing
// or null day means the bot is off that day. Times are "HH:MM" 24h in
// the bot's own timezone.
//
// Fail-open policy: a malformed schedule or unknown timezone must not
// silently mute the account's auto-reply, so any evaluation error
// counts as "within hours" (with a logged breadcrumb).
// ============================================================

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** "HH:MM" → minutes since midnight; NaN when malformed. */
function toMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return NaN
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return NaN
  return h * 60 + min
}

/**
 * Is `now` inside the bot's working hours? `null` schedule = always on.
 *
 * Overnight windows are supported: `{start:"20:00", end:"04:00"}` means
 * 8pm through 4am the next day (the after-midnight part is evaluated
 * against the PREVIOUS day's window, so Tuesday 02:00 is "open" when
 * Monday runs 20:00–04:00).
 */
export function isWithinWorkingHours(
  schedule: WorkingHours | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!schedule) return true
  try {
    const { dayIndex, minutes } = localDayAndMinutes(now, schedule.timezone)

    const todayKey = DAY_KEYS[dayIndex]
    const today = schedule.days?.[todayKey]
    if (today) {
      const start = toMinutes(today.start)
      const end = toMinutes(today.end)
      if (Number.isNaN(start) || Number.isNaN(end)) {
        console.error('[ai working-hours] malformed window, failing open:', today)
        return true
      }
      if (start <= end) {
        // Normal same-day window (start === end → zero-width → closed).
        if (minutes >= start && minutes < end) return true
      } else {
        // Overnight window's evening half (e.g. 20:00–24:00).
        if (minutes >= start) return true
      }
    }

    // Overnight spillover from yesterday (e.g. yesterday 20:00–04:00,
    // now 02:00).
    const yesterdayKey = DAY_KEYS[(dayIndex + 6) % 7]
    const yesterday = schedule.days?.[yesterdayKey]
    if (yesterday) {
      const start = toMinutes(yesterday.start)
      const end = toMinutes(yesterday.end)
      if (!Number.isNaN(start) && !Number.isNaN(end) && start > end) {
        if (minutes < end) return true
      }
    }

    return false
  } catch (err) {
    // Unknown timezone or Intl failure — never mute auto-reply over it.
    console.error('[ai working-hours] evaluation failed, failing open:', err)
    return true
  }
}

/** Resolve `now` to { dayIndex (0=sun..6=sat), minutes since midnight }
 *  in the given IANA timezone. Throws on an invalid timezone. */
function localDayAndMinutes(
  now: Date,
  timezone: string,
): { dayIndex: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(now)
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? ''
  const weekday = get('weekday').toLowerCase().slice(0, 3)
  const dayIndex = DAY_KEYS.indexOf(weekday as (typeof DAY_KEYS)[number])
  if (dayIndex === -1) throw new Error(`unresolvable weekday: ${weekday}`)
  // "24" can appear for midnight with hourCycle h24 quirks — normalize.
  const hour = Number(get('hour')) % 24
  const minute = Number(get('minute'))
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error('unresolvable local time')
  }
  return { dayIndex, minutes: hour * 60 + minute }
}
