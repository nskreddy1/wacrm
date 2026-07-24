'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { CalendarClock, Contact, Plus, Tag } from 'lucide-react';
import { toast } from 'sonner';

import type { CatalogItem } from '@/lib/data/operations/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  RecordField,
  RecordLookup,
  RecordSection,
  RecordSheet,
} from '@/components/shared/record-sheet';
import { ModuleFieldsEditor } from '@/features/module-fields/components/module-fields-editor';
import { getModuleFieldLayoutAction } from '@/features/module-fields/lib/actions';
import { EMPTY_MODULE_FIELD_LAYOUT } from '@/features/module-fields/lib/validation';
import type { RecordEditorField } from '@/components/shared/record-fields-editor';
import { QuickCreateContact } from '@/features/contacts/components/quick-create-contact';

type CatalogResponse = { data: CatalogItem[] };
type ContactsResponse = {
  data: { contacts: Array<{ id: string; values: Record<string, unknown> }> };
};
type FormErrors = Partial<
  Record<'contact' | 'title' | 'date' | 'time', string>
>;

// Standard fields pinned on every appointment form (cannot be removed)
const APPOINTMENT_REQUIRED_FIELDS: RecordEditorField[] = [
  { id: 'contact', label: 'Contact', typeLabel: 'Lookup', required: true },
  { id: 'title', label: 'Title', typeLabel: 'Single Line', required: true },
  {
    id: 'schedule',
    label: 'Date & Time',
    typeLabel: 'Date Picker',
    required: true,
  },
];

// Standard fields that can be hidden via Customize Fields
const APPOINTMENT_OPTIONAL_FIELDS: RecordEditorField[] = [
  { id: 'service', label: 'Service', typeLabel: 'Lookup', removable: true },
  {
    id: 'location',
    label: 'Location',
    typeLabel: 'Single Line',
    removable: true,
  },
  {
    id: 'notes',
    label: 'Notes',
    typeLabel: 'Multi-line (Large)',
    removable: true,
  },
];

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

const timeItems = Object.fromEntries(
  TIME_SLOTS.map((slot) => [slot.value, slot.label])
);
const durationItems = Object.fromEntries(
  DURATION_OPTIONS.map((option) => [option.value, option.label])
);

function toLocalDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function contactLabel(values: Record<string, unknown>) {
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  if (name) return name;
  const phone = typeof values.phone === 'string' ? values.phone.trim() : '';
  return phone || 'Unnamed contact';
}

/**
 * "Create Appointment" sheet — same RecordSheet design as Create Contact and
 * Create Deal, including the Customize Fields editor backed by the shared
 * module_field_settings layout.
 */
export function AppointmentRecordSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [contactId, setContactId] = useState<string | null>(null);
  const [catalogItemId, setCatalogItemId] = useState<string | null>(null);
  const [date, setDate] = useState(() => toLocalDateValue(new Date()));
  const [startTime, setStartTime] = useState('10:00');
  const [duration, setDuration] = useState('30');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [quickContactOpen, setQuickContactOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [extraContacts, setExtraContacts] = useState<
    { id: string; name: string }[]
  >([]);

  const { data: contactsData } = useSWR<ContactsResponse>(
    open ? '/api/v1/workspace/contacts' : null
  );
  const { data: catalogData } = useSWR<CatalogResponse>(
    open ? '/api/v1/workspace/catalog' : null
  );
  const { data: layout, mutate: mutateLayout } = useSWR(
    open ? ['module-field-layout', 'appointments'] : null,
    async () => {
      const result = await getModuleFieldLayoutAction('appointments');
      return result.ok ? result.data : EMPTY_MODULE_FIELD_LAYOUT;
    }
  );

  const hidden = useMemo(() => new Set(layout?.hidden ?? []), [layout]);

  const contactOptions = useMemo(() => {
    const contacts = contactsData?.data.contacts ?? [];
    const known = contacts.map((contact) => ({
      id: contact.id,
      label: contactLabel(contact.values),
    }));
    const extras = extraContacts
      .filter((extra) => !contacts.some((contact) => contact.id === extra.id))
      .map((extra) => ({ id: extra.id, label: extra.name }));
    return [...extras, ...known];
  }, [contactsData, extraContacts]);
  const serviceOptions = useMemo(
    () =>
      (catalogData?.data ?? [])
        .filter((item) => item.isActive)
        .map((item) => ({ id: item.id, label: item.name })),
    [catalogData]
  );

  function reset() {
    setTitle('');
    setContactId(null);
    setCatalogItemId(null);
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
    setCatalogItemId(value);
    if (value && !title.trim()) {
      const service = serviceOptions.find((option) => option.id === value);
      if (service) setTitle(service.label);
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

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
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
    <>
      <RecordSheet
        open={open}
        title="Create Appointment"
        description="Add an appointment to the team schedule"
        saving={submitting}
        isCreate
        onOpenChange={handleOpenChange}
        onSubmit={handleSubmit}
        onCustomize={() => setFieldsOpen(true)}
      >
        <RecordSection
          id="appointment-information"
          title="Appointment Information"
        >
          <RecordField
            label="Contact"
            htmlFor="appointment-contact"
            error={errors.contact}
          >
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <RecordLookup
                  id="appointment-contact"
                  value={contactId}
                  options={contactOptions}
                  placeholder="Choose a contact"
                  icon={
                    <Contact
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden="true"
                    />
                  }
                  createLabel="New Contact"
                  onSelect={(id) => {
                    setContactId(id);
                    setErrors((current) => ({
                      ...current,
                      contact: undefined,
                    }));
                  }}
                  onCreateNew={() => setQuickContactOpen(true)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground shrink-0"
                aria-label="Quick create contact"
                onClick={() => setQuickContactOpen(true)}
              >
                <Plus className="size-5" />
              </Button>
            </div>
          </RecordField>
          <RecordField
            label="Title"
            htmlFor="appointment-title"
            error={errors.title}
          >
            <Input
              id="appointment-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setErrors((current) => ({ ...current, title: undefined }));
              }}
              placeholder="Consultation, follow-up, demo…"
              aria-invalid={Boolean(errors.title)}
              className="h-11"
            />
          </RecordField>
          {!hidden.has('service') && (
            <RecordField label="Service" htmlFor="appointment-service">
              <RecordLookup
                id="appointment-service"
                value={catalogItemId}
                options={serviceOptions}
                placeholder="No linked service"
                icon={
                  <Tag
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                }
                onSelect={handleServiceChange}
              />
            </RecordField>
          )}
          <RecordField
            label="Date & Time"
            htmlFor="appointment-date"
            error={errors.date ?? errors.time}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="relative">
                <Input
                  id="appointment-date"
                  type="date"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setErrors((current) => ({ ...current, date: undefined }));
                  }}
                  aria-invalid={Boolean(errors.date)}
                  className="h-11"
                />
                <CalendarClock
                  className="text-muted-foreground pointer-events-none absolute top-1/2 right-9 hidden size-4 -translate-y-1/2"
                  aria-hidden="true"
                />
              </div>
              <Select
                items={timeItems}
                value={startTime}
                onValueChange={(value) => value && setStartTime(value)}
              >
                <SelectTrigger aria-label="Start time" className="h-11 w-full">
                  <SelectValue placeholder="Start time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {TIME_SLOTS.map((slot) => (
                      <SelectItem key={slot.value} value={slot.value}>
                        {slot.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </RecordField>
          <RecordField label="Duration" htmlFor="appointment-duration">
            <Select
              items={durationItems}
              value={duration}
              onValueChange={(value) => value && setDuration(value)}
            >
              <SelectTrigger
                id="appointment-duration"
                aria-label="Duration"
                className="h-11 w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {DURATION_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </RecordField>
          {!hidden.has('location') && (
            <RecordField label="Location" htmlFor="appointment-location">
              <Input
                id="appointment-location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Office, video call, client site…"
                className="h-11"
              />
            </RecordField>
          )}
          {!hidden.has('notes') && (
            <RecordField label="Notes" htmlFor="appointment-notes">
              <Textarea
                id="appointment-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                placeholder="Anything the team should know beforehand"
                className="min-h-11 resize-none"
              />
            </RecordField>
          )}
        </RecordSection>

        {(layout?.custom.length ?? 0) > 0 && (
          <RecordSection
            id="appointment-additional"
            title="Additional Information"
          >
            {layout?.custom.map((field) => (
              <RecordField
                key={field.id}
                label={field.label}
                htmlFor={`appointment-custom-${field.id}`}
              >
                <Input
                  id={`appointment-custom-${field.id}`}
                  type={
                    field.type === 'number'
                      ? 'number'
                      : field.type === 'date'
                        ? 'date'
                        : 'text'
                  }
                  value={customValues[field.id] ?? ''}
                  onChange={(event) =>
                    setCustomValues((current) => ({
                      ...current,
                      [field.id]: event.target.value,
                    }))
                  }
                  className="h-11"
                />
              </RecordField>
            ))}
          </RecordSection>
        )}
      </RecordSheet>

      <QuickCreateContact
        open={quickContactOpen}
        onOpenChange={setQuickContactOpen}
        onCreated={(contact) => {
          setExtraContacts((current) => [...current, contact]);
          setContactId(contact.id);
        }}
      />

      {fieldsOpen && layout && (
        <ModuleFieldsEditor
          open={fieldsOpen}
          module="appointments"
          title="Edit Appointment Fields"
          sectionTitle="Appointment Information"
          requiredFields={APPOINTMENT_REQUIRED_FIELDS}
          optionalFields={APPOINTMENT_OPTIONAL_FIELDS}
          layout={layout}
          onOpenChange={setFieldsOpen}
          onSaved={(next) => mutateLayout(next, { revalidate: false })}
        />
      )}
    </>
  );
}
