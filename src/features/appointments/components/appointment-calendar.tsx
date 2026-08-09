'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type { Appointment } from '@/lib/data/operations/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ============================================================
// AppointmentCalendar — month overview for the Appointments view
//
// Deliberately display-only. There is no edit sheet for an existing
// appointment yet, so day cells are not buttons: inventing a pressable
// affordance that does nothing would be worse than none. When an edit
// flow lands, the cells become the natural trigger.
//
// Motion notes:
//  - Month changes replay a short fade + directional slide, so the grid
//    enters from the side you travelled toward rather than appearing.
//  - Enter uses --ease-out. ease-in would delay the first frame, which
//    is exactly when the eye is on the grid.
//  - Kept at 200ms; month nav is clicked in bursts and anything slower
//    stacks up behind a second click.
//  - motion-safe:* so reduced-motion users get the swap with no travel.
// ============================================================

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const monthFormatter = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
});
const fullDayFormatter = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

function localDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * The 42 cells (6 weeks) covering a month, Monday-first.
 *
 * Fixed at 6 weeks so the grid never changes height between months —
 * a resizing container would shift the toolbar and the page below it
 * every time you paged through the year.
 */
function buildMonthGrid(anchor: Date) {
  const firstOfMonth = new Date(
    anchor.getFullYear(),
    anchor.getMonth(),
    1,
    0,
    0,
    0,
    0
  );
  // getDay() is Sunday-first; shift so Monday is column 0.
  const leading = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(firstOfMonth);
  start.setDate(start.getDate() - leading);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function AppointmentCalendar({
  appointments,
}: {
  appointments: Appointment[];
}) {
  const [anchor, setAnchor] = useState(() => new Date());
  // Drives which side the incoming grid travels from.
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  const todayKey = useMemo(() => localDayKey(new Date()), []);
  const cells = useMemo(() => buildMonthGrid(anchor), [anchor]);

  /** Appointments bucketed by local day, so each cell is an O(1) lookup. */
  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const item of appointments) {
      const key = localDayKey(new Date(item.startsAt));
      const existing = map.get(key);
      if (existing) existing.push(item);
      else map.set(key, [item]);
    }
    return map;
  }, [appointments]);

  function shiftMonth(delta: number) {
    setDirection(delta > 0 ? 'forward' : 'back');
    setAnchor(
      (current) => new Date(current.getFullYear(), current.getMonth() + delta, 1)
    );
  }

  const activeMonth = anchor.getMonth();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 py-2">
        <h2 className="text-foreground mr-auto text-sm font-semibold tabular-nums">
          {monthFormatter.format(anchor)}
        </h2>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDirection('forward');
            setAnchor(new Date());
          }}
        >
          Today
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
        >
          <ChevronRight />
        </Button>
      </div>

      <div
        className="text-muted-foreground grid grid-cols-7 border-y"
        aria-hidden="true"
      >
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-2 py-1.5 text-xs font-medium">
            {day}
          </div>
        ))}
      </div>

      {/* key={} remounts the grid so the entrance replays on each month
          change. tw-animate-css uses transitions under the hood, so a
          rapid second click retargets instead of restarting from zero. */}
      <div
        key={`${anchor.getFullYear()}-${activeMonth}`}
        className={cn(
          'grid flex-1 grid-cols-7 grid-rows-6',
          'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 motion-safe:ease-[var(--ease-out)]',
          direction === 'forward'
            ? 'motion-safe:slide-in-from-right-2'
            : 'motion-safe:slide-in-from-left-2'
        )}
      >
        {cells.map((date) => {
          const key = localDayKey(date);
          const items = byDay.get(key) ?? [];
          const isCurrentMonth = date.getMonth() === activeMonth;
          const isToday = key === todayKey;

          return (
            <div
              key={key}
              className={cn(
                'flex min-h-0 flex-col gap-1 border-r border-b p-1.5 last:border-r-0',
                // Trailing/leading days stay visible for continuity but
                // recede, so the current month reads as one block.
                !isCurrentMonth && 'bg-muted/30'
              )}
            >
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    isCurrentMonth
                      ? 'text-foreground'
                      : 'text-muted-foreground/60',
                    isToday &&
                      'bg-primary text-primary-foreground flex size-5 items-center justify-center rounded-full font-semibold'
                  )}
                >
                  {date.getDate()}
                </span>
              </div>

              <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                {items.slice(0, 3).map((item) => (
                  <div
                    key={item.id}
                    // title gives the full text back on hover, since the
                    // cell is too narrow to show it without truncating.
                    title={`${timeFormatter.format(new Date(item.startsAt))} · ${item.title}`}
                    className={cn(
                      'bg-primary/10 text-primary truncate rounded px-1 py-0.5 text-[11px] leading-tight',
                      item.status === 'cancelled' &&
                        'bg-muted text-muted-foreground line-through',
                      item.status === 'completed' &&
                        'bg-positive/10 text-positive',
                      item.status === 'no_show' &&
                        'bg-destructive/10 text-destructive'
                    )}
                  >
                    <span className="tabular-nums">
                      {timeFormatter.format(new Date(item.startsAt))}
                    </span>{' '}
                    {item.title}
                  </div>
                ))}
                {items.length > 3 && (
                  <span className="text-muted-foreground px-1 text-[11px]">
                    +{items.length - 3} more
                  </span>
                )}
              </div>

              {/* Screen readers get the day's real summary; the visual
                  cell is too fragmented to read linearly. */}
              {items.length > 0 && (
                <span className="sr-only">
                  {fullDayFormatter.format(date)}: {items.length}{' '}
                  {items.length === 1 ? 'appointment' : 'appointments'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
