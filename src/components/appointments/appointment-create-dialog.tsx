"use client"

// ============================================================
// Shared appointment creation dialog used by the appointments
// workspace and the dashboard quick-create widget.
// ============================================================

import { useState } from "react"
import useSWR from "swr"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import type { CatalogItem } from "@/lib/data/operations/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Textarea } from "@/components/ui/textarea"

type CatalogResponse = { data: CatalogItem[] }
type ContactsResponse = { data: { contacts: Array<{ id: string; values: Record<string, unknown> }> } }

/** 30-minute time slots between 7:00 AM and 9:00 PM, keyed "HH:mm". */
const TIME_SLOTS: Array<{ value: string; label: string }> = Array.from({ length: 29 }, (_, index) => {
  const hours = 7 + Math.floor(index / 2)
  const minutes = index % 2 === 0 ? 0 : 30
  const value = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  const period = hours >= 12 ? "PM" : "AM"
  const displayHour = hours % 12 === 0 ? 12 : hours % 12
  return { value, label: `${displayHour}:${String(minutes).padStart(2, "0")} ${period}` }
})

const DURATION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "15", label: "15 minutes" },
  { value: "30", label: "30 minutes" },
  { value: "45", label: "45 minutes" },
  { value: "60", label: "1 hour" },
  { value: "90", label: "1.5 hours" },
  { value: "120", label: "2 hours" },
]

function toLocalDateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function contactLabel(values: Record<string, unknown>) {
  const name = typeof values.name === "string" ? values.name.trim() : ""
  if (name) return name
  const phone = typeof values.phone === "string" ? values.phone.trim() : ""
  return phone || "Unnamed contact"
}

export function AppointmentCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: () => void
}) {
  const [title, setTitle] = useState("")
  const [contactId, setContactId] = useState("")
  const [catalogItemId, setCatalogItemId] = useState("")
  const [date, setDate] = useState(() => toLocalDateValue(new Date()))
  const [startTime, setStartTime] = useState("10:00")
  const [duration, setDuration] = useState("30")
  const [location, setLocation] = useState("")
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const { data: contactsData } = useSWR<ContactsResponse>(open ? "/api/v1/workspace/contacts" : null)
  const { data: catalogData } = useSWR<CatalogResponse>(open ? "/api/v1/workspace/catalog" : null)

  const contacts = contactsData?.data.contacts ?? []
  const services = (catalogData?.data ?? []).filter((item) => item.isActive)
  const canSubmit = title.trim().length > 0 && Boolean(contactId) && Boolean(date) && Boolean(startTime) && !submitting

  const contactItems = Object.fromEntries(contacts.map((contact) => [contact.id, contactLabel(contact.values)]))
  const serviceItems = { none: "No linked service", ...Object.fromEntries(services.map((item) => [item.id, item.name])) }
  const timeItems = Object.fromEntries(TIME_SLOTS.map((slot) => [slot.value, slot.label]))
  const durationItems = Object.fromEntries(DURATION_OPTIONS.map((option) => [option.value, option.label]))

  function reset() {
    setTitle("")
    setContactId("")
    setCatalogItemId("")
    setDate(toLocalDateValue(new Date()))
    setStartTime("10:00")
    setDuration("30")
    setLocation("")
    setNotes("")
  }

  function handleServiceChange(value: string | null) {
    const nextId = value && value !== "none" ? value : ""
    setCatalogItemId(nextId)
    // Prefill the title from the service name so most creates are two clicks.
    if (nextId && !title.trim()) {
      const service = services.find((item) => item.id === nextId)
      if (service) setTitle(service.name)
    }
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const [hours, minutes] = startTime.split(":").map(Number)
      const starts = new Date(`${date}T00:00:00`)
      starts.setHours(hours, minutes, 0, 0)
      const ends = new Date(starts.getTime() + Number(duration) * 60_000)

      const res = await fetch("/api/v1/workspace/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          contactId,
          startsAt: starts.toISOString(),
          endsAt: ends.toISOString(),
          catalogItemId: catalogItemId || null,
          location: location.trim() || null,
          notes: notes.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        throw new Error(body?.error?.message ?? "Could not create the appointment")
      }
      toast.success("Appointment scheduled")
      onOpenChange(false)
      reset()
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the appointment")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>New appointment</DialogTitle>
          <DialogDescription>Schedule a session with a contact, linked to your services catalog.</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto px-6 py-5">
          <fieldset className="flex flex-col gap-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Session</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="apt-contact">
                  Contact <span className="text-destructive">*</span>
                </Label>
                <Select items={contactItems} value={contactId} onValueChange={(value) => setContactId(value ?? "")}>
                  <SelectTrigger id="apt-contact">
                    <SelectValue placeholder="Select a contact" />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts.length === 0 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">No contacts yet</p>
                    )}
                    {contacts.map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contactLabel(contact.values)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="apt-service">Service</Label>
                <Select items={serviceItems} value={catalogItemId || "none"} onValueChange={handleServiceChange}>
                  <SelectTrigger id="apt-service">
                    <SelectValue placeholder="No linked service" />
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
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="apt-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="apt-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Admission counseling"
                maxLength={200}
              />
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date and time</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="apt-date">
                  Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="apt-date"
                  type="date"
                  min={toLocalDateValue(new Date())}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="apt-time">
                  Start time <span className="text-destructive">*</span>
                </Label>
                <Select items={timeItems} value={startTime} onValueChange={(value) => value && setStartTime(value)}>
                  <SelectTrigger id="apt-time">
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
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="apt-duration">Duration</Label>
                <Select items={durationItems} value={duration} onValueChange={(value) => value && setDuration(value)}>
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
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Details</legend>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="apt-location">Location</Label>
              <Input
                id="apt-location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="e.g. Main campus, Google Meet"
                maxLength={200}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="apt-notes">Notes</Label>
              <Textarea
                id="apt-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Anything the team should know beforehand"
                rows={2}
              />
            </div>
          </fieldset>
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Schedule appointment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
