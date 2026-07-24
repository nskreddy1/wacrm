import { describe, expect, it } from 'vitest';

import { isWithinAutoReplySchedule, startOfTodayUtc } from './schedule';

/** Minimal config shape the schedule helpers read. */
function cfg(
  start: string | null,
  end: string | null,
  timezone: string | null = null
) {
  return {
    autoReplyScheduleStart: start,
    autoReplyScheduleEnd: end,
    autoReplyTimezone: timezone,
  };
}

describe('isWithinAutoReplySchedule', () => {
  it('always on when no window is set', () => {
    expect(isWithinAutoReplySchedule(cfg(null, null))).toBe(true);
  });

  it('always on when the window is half-open', () => {
    expect(isWithinAutoReplySchedule(cfg('09:00', null))).toBe(true);
    expect(isWithinAutoReplySchedule(cfg(null, '18:00'))).toBe(true);
  });

  it('always on when start equals end (degenerate window)', () => {
    const now = new Date('2026-07-21T12:00:00Z');
    expect(isWithinAutoReplySchedule(cfg('09:00', '09:00'), now)).toBe(true);
  });

  it('inside a same-day window (UTC)', () => {
    const noon = new Date('2026-07-21T12:00:00Z');
    expect(isWithinAutoReplySchedule(cfg('09:00', '18:00'), noon)).toBe(true);
  });

  it('outside a same-day window (UTC)', () => {
    const night = new Date('2026-07-21T22:00:00Z');
    expect(isWithinAutoReplySchedule(cfg('09:00', '18:00'), night)).toBe(false);
  });

  it('window boundaries: start inclusive, end exclusive', () => {
    const atStart = new Date('2026-07-21T09:00:00Z');
    const atEnd = new Date('2026-07-21T18:00:00Z');
    expect(isWithinAutoReplySchedule(cfg('09:00', '18:00'), atStart)).toBe(
      true
    );
    expect(isWithinAutoReplySchedule(cfg('09:00', '18:00'), atEnd)).toBe(false);
  });

  it('overnight window spans midnight', () => {
    const lateNight = new Date('2026-07-21T23:00:00Z');
    const earlyMorning = new Date('2026-07-21T03:00:00Z');
    const midday = new Date('2026-07-21T12:00:00Z');
    expect(isWithinAutoReplySchedule(cfg('20:00', '06:00'), lateNight)).toBe(
      true
    );
    expect(isWithinAutoReplySchedule(cfg('20:00', '06:00'), earlyMorning)).toBe(
      true
    );
    expect(isWithinAutoReplySchedule(cfg('20:00', '06:00'), midday)).toBe(
      false
    );
  });

  it('evaluates in the configured timezone', () => {
    // 12:00 UTC = 17:30 in Asia/Kolkata (+05:30) — inside 09:00-18:00
    // locally, but a 17:30-18:00 window in UTC terms would exclude it.
    const noonUtc = new Date('2026-07-21T12:00:00Z');
    expect(
      isWithinAutoReplySchedule(cfg('09:00', '18:00', 'Asia/Kolkata'), noonUtc)
    ).toBe(true);
    // 14:00 UTC = 19:30 Kolkata — outside the local window.
    const laterUtc = new Date('2026-07-21T14:00:00Z');
    expect(
      isWithinAutoReplySchedule(cfg('09:00', '18:00', 'Asia/Kolkata'), laterUtc)
    ).toBe(false);
  });

  it('unknown timezone fails open (bot keeps replying)', () => {
    const noon = new Date('2026-07-21T12:00:00Z');
    expect(
      isWithinAutoReplySchedule(cfg('09:00', '18:00', 'Not/AZone'), noon)
    ).toBe(true);
  });
});

describe('startOfTodayUtc', () => {
  it('UTC midnight for null timezone', () => {
    const now = new Date('2026-07-21T15:30:45.123Z');
    expect(startOfTodayUtc(null, now).toISOString()).toBe(
      '2026-07-21T00:00:00.000Z'
    );
  });

  it('zone midnight for a positive-offset timezone', () => {
    // Kolkata (+05:30): 2026-07-21T15:30 UTC is 21:00 local, so local
    // midnight was 2026-07-20T18:30 UTC.
    const now = new Date('2026-07-21T15:30:00Z');
    expect(startOfTodayUtc('Asia/Kolkata', now).toISOString()).toBe(
      '2026-07-20T18:30:00.000Z'
    );
  });

  it('falls back to UTC midnight for an unknown timezone', () => {
    const now = new Date('2026-07-21T15:30:00Z');
    expect(startOfTodayUtc('Not/AZone', now).toISOString()).toBe(
      '2026-07-21T00:00:00.000Z'
    );
  });
});
