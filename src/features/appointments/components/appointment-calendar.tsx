'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import type {
  Appointment,
  AppointmentStatus,
} from '@/lib/data/operations/types';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// ============================================================
// AppointmentCalendar — Outlook-style scheduling surface with
// three ranges: Day, Week and Month.
//
//  - Day / Week render a real time grid (one row per hour) so
//    duration reads as height, the way a calendar should.
//    Overlapping appointments split the column into lanes rather
//    than stacking on top of each other.
//  - Month keeps the compact cell grid: at that zoom level a time
//    axis is noise, so each day lists its first few entries.
//
// Every appointment chip is a real <button> that hands the record
// back to the workspace, which opens the same edit sheet the agenda
// rows use. Nothing here writes on its own.
//
// Motion notes: range changes replay a short fade + directional
// slide (200ms, --ease-out) under motion-safe:*, so reduced-motion
// users get the swap with no travel.
// ============================================================

export type CalendarRange = 'day' | 'week' | 'month';

/** Row height for one hour in the day/week time grid, in px. */
const HOUR_HEIGHT = 48;
/** Scroll position on mount — the working day, not midnight. */
const SCROLL_TO_HOUR = 7;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const RANGES: Array<{ value: CalendarRange; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

const monthFormatter = new Intl.DateTimeFormat('en', {
  month: 'long',
  year: 'numeric',
});
const dayHeadingFormatter = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
const rangeDayFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
});
const timeFormatter = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
});
const hourFormatter = new Intl.DateTimeFormat('en', { hour: 'numeric' });
const fullDayFormatter = new Intl.DateTimeFormat('en', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

const CHIP_STYLE: Record<AppointmentStatus, string> = {
  scheduled: 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/15',
  completed:
    'bg-positive/10 text-positive border-positive/30 hover:bg-positive/15',
  cancelled:
    'bg-muted text-muted-foreground border-border line-through hover:bg-muted/80',
  no_show:
    'bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/15',
};

function localDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

/** Monday-first week start, matching the month grid's column order. */
function startOfWeek(date: Date) {
  const next = startOfDay(date);
  next.setDate(next.getDate() - ((next.getDay() + 6) % 7));
  return next;
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

/**
 * The 42 cells (6 weeks) covering a month, Monday-first.
 *
 * Fixed at 6 weeks so the grid never changes height between months —
 * a resizing container would shift everything below it every time you
 * paged through the year.
 */
function buildMonthGrid(anchor: Date) {
  const start = startOfWeek(
    new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  );
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

/** Minutes from midnight, clamped into the rendered day. */
function minutesInto(day: Date, value: Date) {
  return Math.min(
    24 * 60,
    Math.max(0, (value.getTime() - day.getTime()) / 60_000)
  );
}

type PositionedAppointment = {
  item: Appointment;
  top: number;
  height: number;
  lane: number;
  lanes: number;
};

/**
 * Places a day's appointments on the time grid and splits overlapping
 * runs into side-by-side lanes.
 *
 * Events are swept in start order; a cluster stays open while any of its
 * members is still running, and the whole cluster shares a lane count so
 * columns line up instead of jittering per event.
 */
function layoutDay(day: Date, items: Appointment[]): PositionedAppointment[] {
  const sorted = [...items].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );

  const placed: PositionedAppointment[] = [];
  let cluster: PositionedAppointment[] = [];
  /** Lane end times (minutes) for the open cluster. */
  let laneEnds: number[] = [];

  const flush = () => {
    const lanes = laneEnds.length || 1;
    for (const entry of cluster) entry.lanes = lanes;
    placed.push(...cluster);
    cluster = [];
    laneEnds = [];
  };

  for (const item of sorted) {
    const start = minutesInto(day, new Date(item.startsAt));
    const rawEnd = item.endsAt
      ? minutesInto(day, new Date(item.endsAt))
      : start + 30;
    // 20 minutes keeps a zero-length or very short record readable.
    const end = Math.max(rawEnd, start + 20);

    if (cluster.length > 0 && laneEnds.every((laneEnd) => laneEnd <= start)) {
      flush();
    }

    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }

    cluster.push({
      item,
      top: (start / 60) * HOUR_HEIGHT,
      height: Math.max(((end - start) / 60) * HOUR_HEIGHT, 18),
      lane,
      lanes: 1,
    });
  }
  if (cluster.length > 0) flush();

  return placed;
}

function AppointmentChip({
  item,
  onSelect,
  className,
  style,
  compact,
}: {
  item: Appointment;
  onSelect?: (item: Appointment) => void;
  className?: string;
  style?: React.CSSProperties;
  compact?: boolean;
}) {
  const label = `${timeFormatter.format(new Date(item.startsAt))} ${item.title}${
    item.contactName ? ` with ${item.contactName}` : ''
  }`;

  return (
    <button
      type="button"
      // Read-only calendars invite a click that goes nowhere; this one
      // hands the record to the same sheet the agenda rows open.
      onClick={onSelect ? () => onSelect(item) : undefined}
      disabled={!onSelect}
      title={label}
      aria-label={onSelect ? `Edit ${item.title}, ${label}` : label}
      style={style}
      className={cn(
        'focus-visible:ring-ring overflow-hidden rounded border px-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:cursor-default',
        CHIP_STYLE[item.status],
        compact
          ? 'truncate py-0.5 text-[11px] leading-tight'
          : 'flex flex-col py-1 text-[11px] leading-tight',
        className
      )}
    >
      {compact ? (
        <>
          <span className="tabular-nums">
            {timeFormatter.format(new Date(item.startsAt))}
          </span>{' '}
          {item.title}
        </>
      ) : (
        <>
          <span className="truncate font-medium">{item.title}</span>
          <span className="truncate tabular-nums opacity-80">
            {timeFormatter.format(new Date(item.startsAt))}
            {item.endsAt
              ? ` – ${timeFormatter.format(new Date(item.endsAt))}`
              : ''}
          </span>
          {item.contactName ? (
            <span className="truncate opacity-80">{item.contactName}</span>
          ) : null}
        </>
      )}
    </button>
  );
}

/** Shared hour rail + column body used by both the day and week grids. */
function TimeGrid({
  days,
  byDay,
  onSelect,
}: {
  days: Date[];
  byDay: Map<string, Appointment[]>;
  onSelect?: (item: Appointment) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const todayKey = localDayKey(new Date());

  // Open on the working day rather than midnight. Runs per range change
  // so paging days doesn't leave you looking at empty small hours.
  useEffect(() => {
    if (scroller.current) {
      scroller.current.scrollTop = SCROLL_TO_HOUR * HOUR_HEIGHT;
    }
  }, [days.length]);

  const nowOffset = useMemo(() => {
    const now = new Date();
    return ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT;
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Column headers stay outside the scroller so dates remain visible
          while the time axis scrolls. */}
      <div className="bg-card flex border-b">
        <div className="w-14 shrink-0 border-r" aria-hidden="true" />
        {days.map((day) => {
          const key = localDayKey(day);
          const isToday = key === todayKey;
          return (
            <div
              key={key}
              className={cn(
                'flex flex-1 items-baseline justify-center gap-1.5 border-r px-2 py-1.5 last:border-r-0',
                isToday && 'bg-primary/5'
              )}
            >
              <span className="text-muted-foreground text-xs font-medium">
                {WEEKDAYS[(day.getDay() + 6) % 7]}
              </span>
              <span
                className={cn(
                  'text-sm tabular-nums',
                  isToday
                    ? 'bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-full font-semibold'
                    : 'text-foreground'
                )}
              >
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      <div
        ref={scroller}
        className="app-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="flex">
          {/* Hour rail */}
          <div className="w-14 shrink-0 border-r" aria-hidden="true">
            {HOURS.map((hour) => (
              <div
                key={hour}
                style={{ height: HOUR_HEIGHT }}
                className="text-muted-foreground relative text-[11px] tabular-nums"
              >
                <span className="absolute -top-1.5 right-1.5">
                  {hour === 0
                    ? ''
                    : hourFormatter.format(new Date(2000, 0, 1, hour))}
                </span>
              </div>
            ))}
          </div>

          {days.map((day) => {
            const key = localDayKey(day);
            const isToday = key === todayKey;
            const positioned = layoutDay(day, byDay.get(key) ?? []);

            return (
              <div
                key={key}
                className={cn(
                  'relative flex-1 border-r last:border-r-0',
                  isToday && 'bg-primary/5'
                )}
                style={{ height: HOURS.length * HOUR_HEIGHT }}
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    style={{ height: HOUR_HEIGHT }}
                    className="border-border/60 border-b"
                    aria-hidden="true"
                  />
                ))}

                {/* Current-time marker, the one piece of chrome that tells
                    you where "now" sits without reading the rail. */}
                {isToday && (
                  <div
                    className="bg-destructive pointer-events-none absolute inset-x-0 z-10 h-px"
                    style={{ top: nowOffset }}
                    aria-hidden="true"
                  >
                    <span className="bg-destructive absolute -top-[3px] left-0 size-[7px] rounded-full" />
                  </div>
                )}

                {positioned.map(({ item, top, height, lane, lanes }) => (
                  <AppointmentChip
                    key={item.id}
                    item={item}
                    onSelect={onSelect}
                    className="absolute"
                    style={{
                      top,
                      height,
                      left: `calc(${(lane / lanes) * 100}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                    }}
                  />
                ))}

                {positioned.length === 0 && (
                  <span className="sr-only">
                    {fullDayFormatter.format(day)}: no appointments
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({
  anchor,
  byDay,
  onSelect,
}: {
  anchor: Date;
  byDay: Map<string, Appointment[]>;
  onSelect?: (item: Appointment) => void;
}) {
  const todayKey = localDayKey(new Date());
  const cells = useMemo(() => buildMonthGrid(anchor), [anchor]);
  const activeMonth = anchor.getMonth();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className="text-muted-foreground bg-card grid grid-cols-7 border-b"
        aria-hidden="true"
      >
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-2 py-1.5 text-xs font-medium">
            {day}
          </div>
        ))}
      </div>

      <div className="grid flex-1 grid-cols-7 grid-rows-6">
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
                  <AppointmentChip
                    key={item.id}
                    item={item}
                    onSelect={onSelect}
                    compact
                  />
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

export function AppointmentCalendar({
  appointments,
  range: rangeProp,
  onRangeChange,
  onSelect,
}: {
  appointments: Appointment[];
  /** Controlled range; omit to let the calendar own it. */
  range?: CalendarRange;
  onRangeChange?: (range: CalendarRange) => void;
  /** Called when an appointment chip is activated. */
  onSelect?: (item: Appointment) => void;
}) {
  const [internalRange, setInternalRange] = useState<CalendarRange>('week');
  const range = rangeProp ?? internalRange;
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  // Drives which side the incoming grid travels from.
  const [direction, setDirection] = useState<'forward' | 'back'>('forward');

  function setRange(next: CalendarRange) {
    setInternalRange(next);
    onRangeChange?.(next);
  }

  /** Appointments bucketed by local day, so each cell is an O(1) lookup. */
  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const item of appointments) {
      const key = localDayKey(new Date(item.startsAt));
      const existing = map.get(key);
      if (existing) existing.push(item);
      else map.set(key, [item]);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
      );
    }
    return map;
  }, [appointments]);

  const days = useMemo(() => {
    if (range === 'day') return [startOfDay(anchor)];
    if (range === 'week') {
      const start = startOfWeek(anchor);
      return Array.from({ length: 7 }, (_, index) => addDays(start, index));
    }
    return [];
  }, [range, anchor]);

  function shift(delta: number) {
    setDirection(delta > 0 ? 'forward' : 'back');
    setAnchor((current) => {
      if (range === 'day') return addDays(current, delta);
      if (range === 'week') return addDays(current, delta * 7);
      return new Date(current.getFullYear(), current.getMonth() + delta, 1);
    });
  }

  const heading =
    range === 'day'
      ? dayHeadingFormatter.format(anchor)
      : range === 'week'
        ? `${rangeDayFormatter.format(days[0])} – ${rangeDayFormatter.format(days[6])}, ${days[6].getFullYear()}`
        : monthFormatter.format(anchor);

  const visibleCount = useMemo(() => {
    if (range === 'month') {
      return appointments.filter((item) => {
        const date = new Date(item.startsAt);
        return (
          date.getMonth() === anchor.getMonth() &&
          date.getFullYear() === anchor.getFullYear()
        );
      }).length;
    }
    return days.reduce(
      (total, day) => total + (byDay.get(localDayKey(day))?.length ?? 0),
      0
    );
  }, [appointments, anchor, byDay, days, range]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Range nav: label first, then the controls that change it — the
          same left-to-right reading order the workspace toolbar uses. */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <h2 className="text-foreground text-sm font-semibold tabular-nums">
          {heading}
        </h2>
        <span
          className="text-muted-foreground mr-auto text-xs tabular-nums"
          aria-live="polite"
        >
          {visibleCount}
        </span>

        <Tabs
          value={range}
          onValueChange={(value) => setRange(value as CalendarRange)}
        >
          <TabsList aria-label="Calendar range">
            {RANGES.map((item) => (
              <TabsTrigger key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => shift(-1)}
          aria-label={`Previous ${range}`}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDirection('forward');
            setAnchor(startOfDay(new Date()));
          }}
        >
          Today
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => shift(1)}
          aria-label={`Next ${range}`}
        >
          <ChevronRight />
        </Button>
      </div>

      {/* key={} remounts the grid so the entrance replays on each range
          change. tw-animate-css uses transitions under the hood, so a
          rapid second click retargets instead of restarting from zero. */}
      <div
        key={`${range}-${localDayKey(anchor)}`}
        className={cn(
          'flex min-h-0 flex-1 flex-col border-t',
          'motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200 motion-safe:ease-[var(--ease-out)]',
          direction === 'forward'
            ? 'motion-safe:slide-in-from-right-2'
            : 'motion-safe:slide-in-from-left-2'
        )}
      >
        {range === 'month' ? (
          <MonthGrid anchor={anchor} byDay={byDay} onSelect={onSelect} />
        ) : (
          <TimeGrid days={days} byDay={byDay} onSelect={onSelect} />
        )}
      </div>
    </div>
  );
}
