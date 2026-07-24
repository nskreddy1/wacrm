// ============================================================
// Auto-reply schedule window.
//
// The account can restrict the bot to a daily time window (e.g. only
// after-hours 20:00–06:00, or only business hours 09:00–18:00),
// evaluated in the account's own timezone. Null start/end = always on.
// ============================================================

import type { AiConfig } from './types';

/** 'HH:MM' → minutes since midnight, or null when malformed. */
function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Current minutes-since-midnight in the given IANA timezone (UTC when
 *  null/invalid — fail open to a deterministic default, never throw). */
function nowMinutesInZone(timezone: string | null, now: Date): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone ?? 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = fmt.formatToParts(now);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return h * 60 + m;
  } catch {
    // Unknown timezone string — evaluate in UTC rather than blocking
    // every reply (the UI constrains input, this is defense in depth).
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/**
 * Is the bot allowed to auto-reply right now?
 *
 * - No window configured (either bound missing) → always allowed.
 * - start < end   → same-day window   (09:00–18:00).
 * - start > end   → overnight window  (20:00–06:00, spans midnight).
 * - start == end  → treated as always on (a zero-length window is
 *   almost certainly a misconfiguration; blocking everything would be
 *   the surprising reading).
 *
 * The window is inclusive of start, exclusive of end.
 */
export function isWithinAutoReplySchedule(
  config: Pick<
    AiConfig,
    'autoReplyScheduleStart' | 'autoReplyScheduleEnd' | 'autoReplyTimezone'
  >,
  now: Date = new Date()
): boolean {
  const { autoReplyScheduleStart: startRaw, autoReplyScheduleEnd: endRaw } =
    config;
  if (!startRaw || !endRaw) return true;

  const start = toMinutes(startRaw);
  const end = toMinutes(endRaw);
  // Malformed bounds → fail open (same rationale as unknown timezone).
  if (start === null || end === null) return true;
  if (start === end) return true;

  const current = nowMinutesInZone(config.autoReplyTimezone, now);
  if (start < end) return current >= start && current < end;
  // Overnight: inside if after start OR before end.
  return current >= start || current < end;
}

/**
 * UTC instant of "midnight today" in the given IANA timezone — the
 * boundary the per-day reply cap resets at. Falls back to the UTC day
 * start when the timezone is null or unknown.
 */
export function startOfTodayUtc(
  timezone: string | null,
  now: Date = new Date()
): Date {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const p = Object.fromEntries(
      fmt.formatToParts(now).map((part) => [part.type, part.value])
    );
    // Elapsed time since that zone's midnight, subtracted from `now`,
    // lands exactly on the zone-midnight instant in UTC.
    const elapsedMs =
      (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second)) * 1000;
    return new Date(now.getTime() - elapsedMs - now.getMilliseconds());
  } catch {
    const utc = new Date(now);
    utc.setUTCHours(0, 0, 0, 0);
    return utc;
  }
}
