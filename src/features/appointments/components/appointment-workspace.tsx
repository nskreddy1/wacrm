'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  AlertCircle,
  CalendarDays,
  Loader2,
  MapPin,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import type {
  Appointment,
  AppointmentStatus,
  CatalogItem,
} from '@/lib/data/operations/types';
import { AppointmentRecordSheet } from '@/features/appointments/components/appointment-record-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type AppointmentsResponse = { data: Appointment[] };
type CatalogResponse = { data: CatalogItem[] };
type ScheduleScope = 'upcoming' | 'today' | 'past' | 'all';

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  scheduled: 'bg-primary/10 text-primary',
  completed: 'bg-positive/10 text-positive',
  cancelled: 'bg-muted text-muted-foreground',
  no_show: 'bg-destructive/10 text-destructive',
};

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No show',
};

const SCOPES: Array<{ value: ScheduleScope; label: string }> = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'today', label: 'Today' },
  { value: 'past', label: 'Past' },
  { value: 'all', label: 'All' },
];

const timeFormatter = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
});
const weekdayFormatter = new Intl.DateTimeFormat('en', { weekday: 'long' });
const dateFormatter = new Intl.DateTimeFormat('en', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

function dayKey(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatDayHeading(value: string) {
  const date = new Date(value);
  const today = startOfToday();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const key = dayKey(value);
  const relative =
    key === dayKey(today.toISOString())
      ? 'Today'
      : key === dayKey(tomorrow.toISOString())
        ? 'Tomorrow'
        : weekdayFormatter.format(date);
  return { relative, date: dateFormatter.format(date) };
}

function formatDuration(item: Appointment) {
  if (!item.endsAt) return null;
  const minutes = Math.max(
    0,
    Math.round(
      (new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) /
        60_000
    )
  );
  if (!minutes) return null;
  return minutes >= 60 && minutes % 60 === 0
    ? `${minutes / 60}h`
    : `${minutes}m`;
}

function ScheduleSkeleton() {
  return (
    <div aria-label="Loading schedule" className="animate-pulse">
      {[0, 1].map((group) => (
        <div key={group}>
          <div className="border-border bg-muted/30 h-10 border-b px-4 py-3">
            <div className="bg-muted h-3 w-40 rounded" />
          </div>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="border-border flex h-20 items-center gap-5 border-b px-4 md:px-5"
            >
              <div className="bg-muted h-4 w-16 rounded" />
              <div className="flex flex-1 flex-col gap-2">
                <div className="bg-muted h-4 w-48 rounded" />
                <div className="bg-muted h-3 w-72 max-w-full rounded" />
              </div>
              <div className="bg-muted hidden h-6 w-20 rounded sm:block" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function AppointmentWorkspace() {
  const { data, error, isLoading, mutate } = useSWR<AppointmentsResponse>(
    '/api/v1/workspace/appointments?limit=200'
  );
  const { data: catalogData } = useSWR<CatalogResponse>(
    '/api/v1/workspace/catalog'
  );
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<ScheduleScope>('upcoming');
  const [statusFilter, setStatusFilter] = useState('all');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const appointments = useMemo(() => data?.data ?? [], [data]);
  const services = catalogData?.data ?? [];
  const { today, tomorrow } = useMemo(() => {
    const dayStart = startOfToday();
    const nextDay = new Date(dayStart);
    nextDay.setDate(nextDay.getDate() + 1);
    return { today: dayStart, tomorrow: nextDay };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return appointments
      .filter((item) => {
        const starts = new Date(item.startsAt);
        const inScope =
          scope === 'all' ||
          (scope === 'today' && starts >= today && starts < tomorrow) ||
          (scope === 'upcoming' && starts >= today) ||
          (scope === 'past' && starts < today);
        const matchesQuery =
          !q ||
          `${item.title} ${item.contactName ?? ''} ${item.catalogItemName ?? ''} ${item.location ?? ''}`
            .toLowerCase()
            .includes(q);
        return (
          inScope &&
          matchesQuery &&
          (statusFilter === 'all' || item.status === statusFilter) &&
          (serviceFilter === 'all' || item.catalogItemId === serviceFilter)
        );
      })
      .sort(
        (a, b) =>
          new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
      );
  }, [
    appointments,
    query,
    scope,
    statusFilter,
    serviceFilter,
    today,
    tomorrow,
  ]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Appointment[]>();
    for (const item of filtered) {
      const key = dayKey(item.startsAt);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.values()];
  }, [filtered]);

  const hasFilters =
    Boolean(query) || statusFilter !== 'all' || serviceFilter !== 'all';

  function clearFilters() {
    setQuery('');
    setStatusFilter('all');
    setServiceFilter('all');
  }

  async function updateStatus(id: string, status: AppointmentStatus) {
    if (updatingId) return;
    setUpdatingId(id);
    try {
      const res = await fetch('/api/v1/workspace/appointments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error();
      toast.success('Appointment updated');
      await mutate();
    } catch {
      toast.error('Could not update the appointment');
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <main className="bg-background flex min-h-full flex-col">
      <header className="border-border border-b px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-foreground text-xl font-semibold tracking-tight text-balance">
              Appointments
            </h1>
            <p className="text-muted-foreground text-sm">
              Coordinate sessions and keep the team on schedule.
            </p>
          </div>
          <Button size="lg" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" /> New appointment
          </Button>
        </div>
      </header>

      <section
        className="flex min-h-0 flex-1 flex-col"
        aria-label="Appointment schedule"
      >
        <div className="border-border border-b px-4 md:px-6">
          <div className="flex flex-col gap-3 py-3 xl:flex-row xl:items-center xl:justify-between">
            <div
              className="flex flex-wrap items-center gap-1"
              aria-label="Schedule range"
            >
              {SCOPES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setScope(item.value)}
                  aria-pressed={scope === item.value}
                  className={cn(
                    'text-muted-foreground hover:text-foreground focus-visible:ring-ring relative min-h-9 px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-2',
                    scope === item.value &&
                      'text-foreground after:bg-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5'
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative min-w-0 sm:w-64">
                <Search
                  className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden="true"
                />
                <Input
                  aria-label="Search appointments"
                  className="h-9 pl-9"
                  placeholder="Search appointments"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <Select
                items={{ all: 'All statuses', ...STATUS_LABEL }}
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value ?? 'all')}
              >
                <SelectTrigger
                  className="h-9 sm:w-36"
                  aria-label="Filter by status"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map(
                    (status) => (
                      <SelectItem key={status} value={status}>
                        {STATUS_LABEL[status]}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
              <Select
                items={{
                  all: 'All services',
                  ...Object.fromEntries(
                    services.map((item) => [item.id, item.name])
                  ),
                }}
                value={serviceFilter}
                onValueChange={(value) => setServiceFilter(value ?? 'all')}
              >
                <SelectTrigger
                  className="h-9 sm:w-44"
                  aria-label="Filter by service"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All services</SelectItem>
                  {services.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="border-border/60 text-muted-foreground flex min-h-9 items-center justify-between border-t text-xs">
            <span>
              {filtered.length}{' '}
              {filtered.length === 1 ? 'appointment' : 'appointments'}
            </span>
            {hasFilters && (
              <Button variant="ghost" size="xs" onClick={clearFilters}>
                <X aria-hidden="true" /> Clear filters
              </Button>
            )}
          </div>
        </div>

        {error ? (
          <div className="border-destructive/30 bg-destructive/5 m-4 flex items-start justify-between gap-4 border p-4 md:m-6">
            <div className="flex gap-3">
              <AlertCircle
                className="text-destructive mt-0.5 size-5"
                aria-hidden="true"
              />
              <div>
                <p className="text-foreground font-medium">
                  Schedule could not be loaded
                </p>
                <p className="text-muted-foreground text-sm">
                  Check your connection and try again.
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void mutate()}>
              Retry
            </Button>
          </div>
        ) : isLoading ? (
          <ScheduleSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-20 text-center">
            <CalendarDays
              className="text-muted-foreground size-8"
              aria-hidden="true"
            />
            <div>
              <p className="text-foreground font-medium">
                {appointments.length === 0
                  ? 'No appointments scheduled'
                  : 'No matching appointments'}
              </p>
              <p className="text-muted-foreground mt-1 max-w-md text-sm">
                {appointments.length === 0
                  ? 'Create an appointment to start building your team schedule.'
                  : 'Change the schedule range or clear your filters to see more results.'}
              </p>
            </div>
            {appointments.length === 0 ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus aria-hidden="true" /> New appointment
              </Button>
            ) : (
              <Button variant="outline" onClick={clearFilters}>
                <SlidersHorizontal aria-hidden="true" /> Clear filters
              </Button>
            )}
          </div>
        ) : (
          <div>
            {grouped.map((items) => {
              const heading = formatDayHeading(items[0].startsAt);
              return (
                <section
                  key={dayKey(items[0].startsAt)}
                  aria-label={`${heading.relative}, ${heading.date}`}
                >
                  <div className="border-border bg-muted/70 sticky top-0 z-10 flex h-10 items-center gap-2 border-b px-4 backdrop-blur-sm md:px-6">
                    <h2 className="text-foreground text-sm font-semibold">
                      {heading.relative}
                    </h2>
                    <span className="text-muted-foreground text-xs">
                      {heading.date}
                    </span>
                  </div>
                  <div className="divide-border divide-y">
                    {items.map((item) => {
                      const duration = formatDuration(item);
                      return (
                        <article
                          key={item.id}
                          className="group hover:bg-muted/30 flex min-h-20 flex-col gap-3 px-4 py-4 transition-colors md:grid md:grid-cols-[7rem_minmax(0,1fr)_minmax(8rem,0.35fr)_9rem] md:items-center md:gap-5 md:px-6"
                        >
                          <div className="flex items-baseline gap-2 md:flex-col md:items-start md:gap-0.5">
                            <time
                              className="text-foreground font-semibold tabular-nums"
                              dateTime={item.startsAt}
                            >
                              {timeFormatter.format(new Date(item.startsAt))}
                            </time>
                            <span className="text-muted-foreground text-xs tabular-nums">
                              {item.endsAt
                                ? `to ${timeFormatter.format(new Date(item.endsAt))}`
                                : ''}
                              {duration ? ` · ${duration}` : ''}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-foreground truncate text-sm font-semibold">
                              {item.title}
                            </h3>
                            <p className="text-muted-foreground mt-1 truncate text-sm">
                              {item.contactName ?? 'Unknown contact'}
                              {item.catalogItemName
                                ? ` · ${item.catalogItemName}`
                                : ''}
                            </p>
                          </div>
                          <div className="text-muted-foreground min-w-0 text-sm">
                            {item.location ? (
                              <span className="flex items-center gap-1.5 truncate">
                                <MapPin
                                  className="size-3.5 shrink-0"
                                  aria-hidden="true"
                                />
                                {item.location}
                              </span>
                            ) : (
                              <span className="hidden md:inline">—</span>
                            )}
                          </div>
                          <Select
                            items={STATUS_LABEL}
                            value={item.status}
                            disabled={updatingId === item.id}
                            onValueChange={(value) =>
                              value &&
                              void updateStatus(
                                item.id,
                                value as AppointmentStatus
                              )
                            }
                          >
                            <SelectTrigger
                              className={cn(
                                'h-8 w-36 border-transparent text-xs font-medium',
                                STATUS_STYLE[item.status]
                              )}
                              aria-label={`Status for ${item.title}`}
                            >
                              {updatingId === item.id ? (
                                <Loader2
                                  className="size-3.5 animate-spin"
                                  aria-hidden="true"
                                />
                              ) : (
                                <SelectValue />
                              )}
                            </SelectTrigger>
                            <SelectContent>
                              {(
                                Object.keys(STATUS_LABEL) as AppointmentStatus[]
                              ).map((status) => (
                                <SelectItem key={status} value={status}>
                                  {STATUS_LABEL[status]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>
      <AppointmentRecordSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void mutate()}
      />
    </main>
  );
}
