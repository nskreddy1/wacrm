'use client';

import { useState } from 'react';
import { CalendarClock, MapPin, Plus } from 'lucide-react';

import type { UpcomingAppointment } from '@/lib/data/dashboard/types';
import { AppointmentRecordSheet } from '@/features/appointments/components/appointment-record-sheet';
import { Button } from '@/components/ui/button';
import { ChartCard } from './chart-card';

const timeFormatter = new Intl.DateTimeFormat('en', {
  hour: 'numeric',
  minute: '2-digit',
});
const dateFormatter = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

/** "Today · 2:30 PM" / "Tomorrow · 10:15 AM" / "Wed, Jun 3 · 4:00 PM" */
function formatWhen(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round(
    (startOfDay(date) - startOfDay(now)) / 86_400_000
  );
  const day =
    diffDays === 0
      ? 'Today'
      : diffDays === 1
        ? 'Tomorrow'
        : dateFormatter.format(date);
  return `${day} · ${timeFormatter.format(date)}`;
}

/** Next scheduled appointments, soonest first, with inline quick-create. */
export function UpcomingAppointments({
  appointments,
  onChanged,
}: {
  appointments: UpcomingAppointment[];
  onChanged: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <ChartCard
      title="Upcoming appointments"
      caption="Next scheduled sessions"
      contentClassName="p-0"
      meta={
        <Button
          variant="ghost"
          size="sm"
          className="text-primary hover:text-primary h-7 gap-1 px-2 text-xs font-medium"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-3.5" aria-hidden="true" /> New
        </Button>
      }
    >
      {appointments.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-center text-xs">
          No upcoming appointments. Schedule one with the New button.
        </p>
      ) : (
        <ul className="divide-border divide-y">
          {appointments.map((appointment) => (
            <li
              key={appointment.id}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <span className="bg-primary-soft text-primary flex size-8 shrink-0 items-center justify-center rounded-lg">
                <CalendarClock className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">
                    {appointment.contact}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-[11px] font-medium tabular-nums">
                    {formatWhen(appointment.startsAt)}
                  </span>
                </span>
                <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-[11px]">
                  <span className="truncate">{appointment.service}</span>
                  {appointment.location && (
                    <span className="flex min-w-0 items-center gap-0.5">
                      <MapPin className="size-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{appointment.location}</span>
                    </span>
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <AppointmentRecordSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onChanged}
      />
    </ChartCard>
  );
}
