"use client"

// ============================================================
// Appointments workspace — full scheduling surface backed by
// /api/v1/workspace/appointments and the services catalog.
// ============================================================

import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  MapPin,
  Plus,
  Search,
  UserRound,
} from "lucide-react"
import { toast } from "sonner"

import type { Appointment, AppointmentStatus, CatalogItem } from "@/lib/data/operations/types"
import { AppointmentCreateDialog } from "@/components/appointments/appointment-create-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

type AppointmentsResponse = { data: Appointment[] }
type CatalogResponse = { data: CatalogItem[] }

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  scheduled: "border-primary/30 bg-primary/10 text-primary",
  completed: "border-positive/30 bg-positive/10 text-positive",
  cancelled: "border-border bg-muted text-muted-foreground",
  no_show: "border-destructive/30 bg-destructive/10 text-destructive",
}

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
}

const timeFormatter = new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" })
const dateFormatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })

/** Full appointments workspace: KPI strip, filterable schedule, quick status updates. */
export function AppointmentWorkspace() {
  const { data, isLoading, mutate } = useSWR<AppointmentsResponse>("/api/v1/workspace/appointments?limit=200")
  const { data: catalogData } = useSWR<CatalogResponse>("/api/v1/workspace/catalog")

  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [serviceFilter, setServiceFilter] = useState("all")
  const [createOpen, setCreateOpen] = useState(false)

  const appointments = useMemo(() => data?.data ?? [], [data])
  const services = catalogData?.data ?? []

  const now = Date.now()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(todayStart)
  todayEnd.setDate(todayEnd.getDate() + 1)

  const stats = useMemo(() => {
    const today = appointments.filter((item) => {
      const t = new Date(item.startsAt).getTime()
      return t >= todayStart.getTime() && t < todayEnd.getTime() && item.status === "scheduled"
    }).length
    const upcoming = appointments.filter(
      (item) => item.status === "scheduled" && new Date(item.startsAt).getTime() >= now,
    ).length
    const completed = appointments.filter((item) => item.status === "completed").length
    return { today, upcoming, completed, services: services.filter((s) => s.isActive).length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, services])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return appointments.filter((item) => {
      const haystack = `${item.title} ${item.contactName ?? ""} ${item.catalogItemName ?? ""} ${item.location ?? ""}`.toLowerCase()
      if (q && !haystack.includes(q)) return false
      if (statusFilter !== "all" && item.status !== statusFilter) return false
      if (serviceFilter !== "all" && item.catalogItemId !== serviceFilter) return false
      return true
    })
  }, [appointments, query, statusFilter, serviceFilter])

  async function updateStatus(id: string, status: AppointmentStatus) {
    const res = await fetch("/api/v1/workspace/appointments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    })
    if (!res.ok) {
      toast.error("Could not update the appointment")
      return
    }
    toast.success("Appointment updated")
    void mutate()
  }

  const kpis = [
    { label: "Today", value: stats.today, Icon: CalendarDays, note: "Sessions scheduled today" },
    { label: "Upcoming", value: stats.upcoming, Icon: Clock3, note: "Future scheduled sessions" },
    { label: "Completed", value: stats.completed, Icon: CheckCircle2, note: "Finished appointments" },
    { label: "Active services", value: stats.services, Icon: CalendarClock, note: "Bookable catalog items" },
  ]

  return (
    <main className="flex min-h-full flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-primary">Operations</p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
            Appointments
          </h1>
          <p className="text-pretty text-sm text-muted-foreground">
            Schedule and track sessions with your contacts, linked to your services catalog.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" aria-hidden="true" /> New appointment
        </Button>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Appointment overview">
        {kpis.map(({ label, value, Icon, note }) => (
          <Card key={label}>
            <CardContent className="flex items-start justify-between gap-3 p-5">
              <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
                <p className="text-xs text-muted-foreground">{note}</p>
              </div>
              <div className="rounded-lg bg-primary/10 p-2 text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border">
          <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
            <div>
              <CardTitle>Schedule</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Your complete appointment queue</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative">
                <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
                <Input
                  aria-label="Search appointments"
                  className="pl-9 sm:w-64"
                  placeholder="Search title, contact, service"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <Select
                items={{ all: "All statuses", ...STATUS_LABEL }}
                value={statusFilter}
                onValueChange={(value) => setStatusFilter(value ?? "all")}
              >
                <SelectTrigger className="sm:w-36" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_LABEL[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                items={{ all: "All services", ...Object.fromEntries(services.map((item) => [item.id, item.name])) }}
                value={serviceFilter}
                onValueChange={(value) => setServiceFilter(value ?? "all")}
              >
                <SelectTrigger className="sm:w-44" aria-label="Filter by service">
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
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-16 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading schedule
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-16 text-center">
              <div className="rounded-xl bg-muted p-3 text-muted-foreground">
                <CalendarDays className="size-6" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium text-foreground">No appointments found</p>
                <p className="text-sm text-muted-foreground">Create your first appointment or adjust the filters.</p>
              </div>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" aria-hidden="true" /> Add appointment
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map((item) => (
                <article
                  key={item.id}
                  className="flex flex-col gap-4 p-4 transition-colors hover:bg-muted/40 md:flex-row md:items-center"
                >
                  <div className="flex w-20 shrink-0 flex-col">
                    <span className="text-sm font-semibold text-foreground tabular-nums">
                      {timeFormatter.format(new Date(item.startsAt))}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {dateFormatter.format(new Date(item.startsAt))}
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <UserRound className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{item.title}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {item.contactName ?? "Unknown contact"}
                        {item.catalogItemName ? ` · ${item.catalogItemName}` : ""}
                        {item.location ? (
                          <span className="inline-flex items-center gap-0.5">
                            {" · "}
                            <MapPin className="size-3" aria-hidden="true" />
                            {item.location}
                          </span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "w-fit rounded-full border px-2.5 py-1 text-xs font-medium",
                      STATUS_STYLE[item.status],
                    )}
                  >
                    {STATUS_LABEL[item.status]}
                  </span>
                  <Select
                    items={STATUS_LABEL}
                    value={item.status}
                    onValueChange={(value) => value && void updateStatus(item.id, value as AppointmentStatus)}
                  >
                    <SelectTrigger className="w-36" aria-label={`Update status for ${item.title}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(STATUS_LABEL) as AppointmentStatus[]).map((status) => (
                        <SelectItem key={status} value={status}>
                          {STATUS_LABEL[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AppointmentCreateDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={() => void mutate()} />
    </main>
  )
}
