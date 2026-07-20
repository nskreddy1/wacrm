"use client"

import { useState } from "react"
import useSWR from "swr"
import { CalendarClock, MapPin, Plus } from "lucide-react"

import type { UpcomingAppointment } from "@/lib/data/dashboard/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ChartCard } from "./chart-card"

type ContactsResponse = {
  data: { contacts: Array<{ id: string; values: Record<string, unknown> }> }
}

type CatalogResponse = {
  data: Array<{ id: string; name: string; isActive: boolean }>
}

const timeFormatter = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" })
const dateFormatter = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric" })

/** "Today · 2:30 PM" / "Tomorrow · 10:15 AM" / "Wed, Jun 3 · 4:00 PM" */
function formatWhen(iso: string) {
  const date = new Date(iso)
  const now = new Date()
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000)
  const day = diffDays === 0 ? "Today" : diffDays === 1 ? "Tomorrow" : dateFormatter.format(date)
  return `${day} · ${timeFormatter.format(date)}`
}

function contactLabel(values: Record<string, unknown>) {
  const name = typeof values.name === "string" ? values.name.trim() : ""
  if (name) return name
  const phone = typeof values.phone === "string" ? values.phone.trim() : ""
  return phone || "Unnamed contact"
}

function AppointmentCreateDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [contactId, setContactId] = useState("")
  const [catalogItemId, setCatalogItemId] = useState("")
  const [startsAt, setStartsAt] = useState("")
  const [location, setLocation] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Options load lazily — only once the dialog opens.
  const { data: contactsData } = useSWR<ContactsResponse>(open ? "/api/v1/workspace/contacts" : null)
  const { data: catalogData } = useSWR<CatalogResponse>(open ? "/api/v1/workspace/catalog" : null)

  const contacts = contactsData?.data.contacts ?? []
  const catalogItems = (catalogData?.data ?? []).filter((item) => item.isActive)
  const canSubmit = title.trim().length > 0 && contactId && startsAt && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/workspace/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          contactId,
          startsAt: new Date(startsAt).toISOString(),
          catalogItemId: catalogItemId || null,
          location: location.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        throw new Error(body?.error?.message ?? "Could not create the appointment")
      }
      setOpen(false)
      setTitle("")
      setContactId("")
      setCatalogItemId("")
      setStartsAt("")
      setLocation("")
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the appointment")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs font-medium text-primary hover:text-primary" />
        }
      >
        <Plus className="size-3.5" aria-hidden="true" /> New
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New appointment</DialogTitle>
          <DialogDescription>Schedule time with a contact. It appears on the dashboard instantly.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="appointment-title">Title</Label>
            <Input
              id="appointment-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Admission counseling"
              maxLength={200}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="appointment-contact">Contact</Label>
            <Select value={contactId} onValueChange={(value) => setContactId(value ?? "")}>
              <SelectTrigger id="appointment-contact">
                <SelectValue placeholder="Select a contact" />
              </SelectTrigger>
              <SelectContent>
                {contacts.map((contact) => (
                  <SelectItem key={contact.id} value={contact.id}>
                    {contactLabel(contact.values)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="appointment-service">Service (optional)</Label>
            <Select value={catalogItemId} onValueChange={(value) => setCatalogItemId(value ?? "")}>
              <SelectTrigger id="appointment-service">
                <SelectValue placeholder="Link a catalog item" />
              </SelectTrigger>
              <SelectContent>
                {catalogItems.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="appointment-starts">Date &amp; time</Label>
              <Input
                id="appointment-starts"
                type="datetime-local"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="appointment-location">Location (optional)</Label>
              <Input
                id="appointment-location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="e.g. Main campus"
                maxLength={200}
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? "Scheduling…" : "Schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Next scheduled appointments, soonest first, with inline quick-create. */
export function UpcomingAppointments({
  appointments,
  onChanged,
}: {
  appointments: UpcomingAppointment[]
  onChanged: () => void
}) {
  return (
    <ChartCard
      title="Upcoming appointments"
      caption="Next scheduled sessions"
      contentClassName="p-0"
      meta={<AppointmentCreateDialog onCreated={onChanged} />}
    >
      {appointments.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          No upcoming appointments. Schedule one with the New button.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {appointments.map((appointment) => (
            <li key={appointment.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <CalendarClock className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{appointment.contact}</span>
                  <span className="shrink-0 text-[11px] font-medium text-muted-foreground tabular-nums">
                    {formatWhen(appointment.startsAt)}
                  </span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
    </ChartCard>
  )
}
