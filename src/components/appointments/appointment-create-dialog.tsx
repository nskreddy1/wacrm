'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { CalendarClock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import type { CatalogItem } from '@/lib/data/operations/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

type CatalogResponse = { data: CatalogItem[] };
type ContactsResponse = {
  data: { contacts: Array<{ id: string; values: Record<string, unknown> }> };
};
type FormErrors = Partial<
  Record<'contact' | 'title' | 'date' | 'time', string>
>;

const TIME_SLOTS = Array.from({ length: 29 }, (_, index) => {
  const hours = 7 + Math.floor(index / 2);
  const minutes = index % 2 === 0 ? 0 : 30;
  const value = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return {
    value,
    label: `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`,
  };
});

const DURATION_OPTIONS = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '45', label: '45 minutes' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '1.5 hours' },
  { value: '120', label: '2 hours' },
];

const summaryDateFormatter = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

function toLocalDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function contactLabel(values: Record<string, unknown>) {
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  if (name) return name;
  const phone = typeof values.phone === 'string' ? values.phone.trim() : '';
  return phone || 'Unnamed contact';
}

export function AppointmentCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState('');
  const [catalogItemId, setCatalogItemId] = useState('');
  const [date, setDate] = useState(() => toLocalDateValue(new Date()));
  const [startTime, setStartTime] = useState('10:00');
  const [duration, setDuration] = useState('30');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const { data: contactsData, isLoading: contactsLoading } =
    useSWR<ContactsResponse>(open ? '/api/v1/workspace/contacts' : null);
  const { data: catalogData, isLoading: servicesLoading } =
    useSWR<CatalogResponse>(open ? '/api/v1/workspace/catalog' : null);
  const contacts = contactsData?.data.contacts ?? [];
  const services = (catalogData?.data ?? []).filter((item) => item.isActive);
  const selectedContact = contacts.find((contact) => contact.id === contactId);
  const selectedTime = TIME_SLOTS.find(
    (slot) => slot.value === startTime
  )?.label;
  const selectedDuration = DURATION_OPTIONS.find(
    (option) => option.value === duration
  )?.label;

  const contactItems = Object.fromEntries(
    contacts.map((contact) => [contact.id, contactLabel(contact.values)])
  );
  const serviceItems = {
    none: 'No linked service',
    ...Object.fromEntries(services.map((item) => [item.id, item.name])),
  };
  const timeItems = Object.fromEntries(
    TIME_SLOTS.map((slot) => [slot.value, slot.label])
  );
  const durationItems = Object.fromEntries(
    DURATION_OPTIONS.map((option) => [option.value, option.label])
  );

  const summaryDate = useMemo(() => {
    if (!date) return 'Choose a date';
    const parsed = new Date(`${date}T12:00:00`);
    return Number.isNaN(parsed.getTime())
      ? 'Choose a date'
      : summaryDateFormatter.format(parsed);
  }, [date]);

  function reset() {
    setTitle('');
    setContactId('');
    setCatalogItemId('');
    setDate(toLocalDateValue(new Date()));
    setStartTime('10:00');
    setDuration('30');
    setLocation('');
    setNotes('');
    setCustomValues({});
    setErrors({});
  }

  function handleOpenChange(nextOpen: boolean) {
    if (submitting) return;
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  function handleServiceChange(value: string | null) {
    const nextId = value && value !== 'none' ? value : '';
    setCatalogItemId(nextId);
    if (nextId && !title.trim()) {
      const service = services.find((item) => item.id === nextId);
      if (service) setTitle(service.name);
    }
  }

  function validate() {
    const next: FormErrors = {};
    if (!contactId)
      next.contact = 'Select the contact attending this appointment.';
    if (!title.trim()) next.title = 'Enter a clear appointment title.';
    if (!date) next.date = 'Choose an appointment date.';
    if (!startTime) next.time = 'Choose a start time.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (!validate() || submitting) return;
    setSubmitting(true);
    try {
      const [hours, minutes] = startTime.split(':').map(Number);
      const starts = new Date(`${date}T00:00:00`);
      starts.setHours(hours, minutes, 0, 0);
      const ends = new Date(starts.getTime() + Number(duration) * 60_000);
      const res = await fetch('/api/v1/workspace/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          contactId,
          startsAt: starts.toISOString(),
          endsAt: ends.toISOString(),
          catalogItemId: catalogItemId || null,
          location: location.trim() || null,
          notes: notes.trim() || null,
          customValues,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          body?.error?.message ?? 'Could not create the appointment'
        );
      }
      toast.success('Appointment scheduled');
      reset();
      onOpenChange(false);
      onCreated();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not create the appointment'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-border border-b px-5 py-4 sm:px-6">
          <DialogTitle>New appointment</DialogTitle>
          <DialogDescription>
            Add a contact to the team schedule. Required fields are marked.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[68vh] overflow-y-auto">
          <div className="flex flex-col gap-6 px-5 py-5 sm:px-6">
            <section aria-labelledby="booking-details-heading">
              <div className="mb-4">
                <h2
                  id="booking-details-heading"
                  className="text-foreground text-sm font-semibold"
                >
                  Booking details
                </h2>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Who the session is for and what it covers.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="apt-contact">
                    Contact{' '}
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                    <span className="sr-only">required</span>
                  </Label>
                  <Select
                    items={contactItems}
                    value={contactId}
                    onValueChange={(value) => {
                      setContactId(value ?? '');
                      setErrors((current) => ({
                        ...current,
                        contact: undefined,
                      }));
                    }}
                  >
                    <SelectTrigger
                      id="apt-contact"
                      aria-invalid={Boolean(errors.contact)}
                      aria-describedby={
                        errors.contact
                          ? 'apt-contact-error'
                          : 'apt-contact-help'
                      }
                    >
                      <SelectValue
                        placeholder={
                          contactsLoading
                            ? 'Loading contacts…'
                            : 'Select a contact'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {contacts.length === 0 && !contactsLoading ? (
                        <p className="text-muted-foreground px-3 py-2 text-sm">
                          No contacts available. Add a contact first.
                        </p>
                      ) : (
                        contacts.map((contact) => (
                          <SelectItem key={contact.id} value={contact.id}>
                            {contactLabel(contact.values)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <p
                    id={
                      errors.contact ? 'apt-contact-error' : 'apt-contact-help'
                    }
                    className={
                      errors.contact
                        ? 'text-destructive text-xs'
                        : 'text-muted-foreground text-xs'
                    }
                  >
                    {errors.contact ?? 'The person attending this session.'}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="apt-service">Service</Label>
                  <Select
                    items={serviceItems}
                    value={catalogItemId || 'none'}
                    onValueChange={handleServiceChange}
                  >
                    <SelectTrigger id="apt-service">
                      <SelectValue
                        placeholder={
                          servicesLoading
                            ? 'Loading services…'
                            : 'No linked service'
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No linked service</SelectItem>
                      {services.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    Optional catalog connection.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <Label htmlFor="apt-title">
                    Appointment title{' '}
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                    <span className="sr-only">required</span>
                  </Label>
                  <Input
                    id="apt-title"
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      setErrors((current) => ({
                        ...current,
                        title: undefined,
                      }));
                    }}
                    placeholder="e.g. Admission counseling"
                    maxLength={200}
                    aria-invalid={Boolean(errors.title)}
                    aria-describedby={
                      errors.title ? 'apt-title-error' : undefined
                    }
                  />
                  {errors.title && (
                    <p
                      id="apt-title-error"
                      className="text-destructive text-xs"
                    >
                      {errors.title}
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section
              aria-labelledby="schedule-heading"
              className="border-border border-t pt-5"
            >
              <div className="mb-4">
                <h2
                  id="schedule-heading"
                  className="text-foreground text-sm font-semibold"
                >
                  Schedule
                </h2>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Set the date, start time, and expected duration.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="apt-date">
                    Date{' '}
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                  </Label>
                  <Input
                    id="apt-date"
                    type="date"
                    min={toLocalDateValue(new Date())}
                    value={date}
                    onChange={(event) => {
                      setDate(event.target.value);
                      setErrors((current) => ({ ...current, date: undefined }));
                    }}
                    aria-invalid={Boolean(errors.date)}
                    aria-describedby={
                      errors.date ? 'apt-date-error' : undefined
                    }
                  />
                  {errors.date && (
                    <p id="apt-date-error" className="text-destructive text-xs">
                      {errors.date}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="apt-time">
                    Start time{' '}
                    <span aria-hidden="true" className="text-destructive">
                      *
                    </span>
                  </Label>
                  <Select
                    items={timeItems}
                    value={startTime}
                    onValueChange={(value) => {
                      if (value) setStartTime(value);
                      setErrors((current) => ({ ...current, time: undefined }));
                    }}
                  >
                    <SelectTrigger
                      id="apt-time"
                      aria-invalid={Boolean(errors.time)}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_SLOTS.map((slot) => (
                        <SelectItem key={slot.value} value={slot.value}>
                          {slot.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.time && (
                    <p className="text-destructive text-xs">{errors.time}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="apt-duration">Duration</Label>
                  <Select
                    items={durationItems}
                    value={duration}
                    onValueChange={(value) => value && setDuration(value)}
                  >
                    <SelectTrigger id="apt-duration">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DURATION_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <section
              aria-labelledby="optional-heading"
              className="border-border border-t pt-5"
            >
              <div className="mb-4">
                <h2
                  id="optional-heading"
                  className="text-foreground text-sm font-semibold"
                >
                  Operational details{' '}
                  <span className="text-muted-foreground font-normal">
                    (optional)
                  </span>
                </h2>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Context your team may need before the session.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="apt-location">Location or meeting link</Label>
                  <Input
                    id="apt-location"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    placeholder="Office, campus, or video link"
                    maxLength={200}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="apt-notes">Internal notes</Label>
                  <Textarea
                    id="apt-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Preparation or handoff notes"
                    rows={3}
                  />
                </div>
              </div>
            </section>

            <ModuleCustomFieldsSection
              module="appointments"
              values={customValues}
              onChange={setCustomValues}
              disabled={submitting}
            />
          </div>
        </div>

        <DialogFooter className="border-border bg-muted/30 flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <CalendarClock
              className="text-muted-foreground size-5 shrink-0"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-foreground truncate text-sm font-medium">
                {selectedContact
                  ? contactLabel(selectedContact.values)
                  : 'Contact not selected'}
              </p>
              <p className="text-muted-foreground truncate text-xs">
                {summaryDate} at {selectedTime ?? '—'} ·{' '}
                {selectedDuration ?? '—'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2 self-end sm:self-auto">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              {submitting ? 'Scheduling…' : 'Schedule appointment'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
