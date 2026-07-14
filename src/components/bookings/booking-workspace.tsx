"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, Loader2, MapPin, Plus, Search, Settings2, UserRound, XCircle } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Workspace = { id: string; name: string; timezone: string; address: string | null };
type Service = { id: string; workspace_id: string; name: string; duration_minutes: number; active: boolean };
type Booking = { id: string; workspace_id: string; service_id: string; customer_name: string; customer_phone: string | null; customer_email: string | null; starts_at: string; ends_at: string; status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show"; notes: string | null };

const statusStyle: Record<Booking["status"], string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-600",
  confirmed: "border-primary/30 bg-primary/10 text-primary",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  cancelled: "border-border bg-muted text-muted-foreground",
  no_show: "border-destructive/30 bg-destructive/10 text-destructive",
};

function toLocalInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function BookingWorkspace() {
  const supabase = useMemo(() => createClient(), []);
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [workspace, setWorkspace] = useState("all");
  const [bookingOpen, setBookingOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [bookingResult, workspaceResult, serviceResult] = await Promise.all([
      supabase.from("bookings").select("*").order("starts_at", { ascending: true }),
      supabase.from("workspaces").select("id,name,timezone,address").order("name"),
      supabase.from("booking_services").select("id,workspace_id,name,duration_minutes,active").eq("active", true).order("name"),
    ]);
    if (bookingResult.error || workspaceResult.error || serviceResult.error) toast.error("Could not load booking data");
    setBookings((bookingResult.data ?? []) as Booking[]);
    setWorkspaces((workspaceResult.data ?? []) as Workspace[]);
    setServices((serviceResult.data ?? []) as Service[]);
    setLoading(false);
  }, [supabase, user]);

  useEffect(() => { void load(); }, [load]);

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
  const upcoming = bookings.filter((item) => new Date(item.starts_at) >= now && item.status !== "cancelled");
  const today = bookings.filter((item) => new Date(item.starts_at) >= todayStart && new Date(item.starts_at) < todayEnd);
  const filtered = bookings.filter((item) => {
    const matchesQuery = `${item.customer_name} ${item.customer_email ?? ""} ${item.customer_phone ?? ""}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (status === "all" || item.status === status) && (workspace === "all" || item.workspace_id === workspace);
  });

  async function createBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const data = new FormData(event.currentTarget);
    const service = services.find((item) => item.id === data.get("service_id"));
    if (!service) return toast.error("Choose a service");
    const start = new Date(String(data.get("starts_at")));
    const end = new Date(start.getTime() + service.duration_minutes * 60000);
    setSaving(true);
    const { error } = await supabase.from("bookings").insert({
      user_id: user.id,
      workspace_id: service.workspace_id,
      service_id: service.id,
      customer_name: String(data.get("customer_name")),
      customer_phone: String(data.get("customer_phone") || "") || null,
      customer_email: String(data.get("customer_email") || "") || null,
      starts_at: start.toISOString(), ends_at: end.toISOString(),
      notes: String(data.get("notes") || "") || null,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Booking created"); setBookingOpen(false); void load();
  }

  async function createSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const data = new FormData(event.currentTarget);
    setSaving(true);
    const { data: newWorkspace, error: workspaceError } = await supabase.from("workspaces").insert({ user_id: user.id, name: String(data.get("workspace_name")), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, address: String(data.get("address") || "") || null }).select("id").single();
    if (workspaceError) { setSaving(false); return toast.error(workspaceError.message); }
    const { error } = await supabase.from("booking_services").insert({ user_id: user.id, workspace_id: newWorkspace.id, name: String(data.get("service_name")), duration_minutes: Number(data.get("duration_minutes")) });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Workspace and service added"); setSetupOpen(false); void load();
  }

  async function updateStatus(id: string, nextStatus: Booking["status"]) {
    const { error } = await supabase.from("bookings").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    setBookings((items) => items.map((item) => item.id === id ? { ...item, status: nextStatus } : item));
    toast.success("Booking updated");
  }

  const workspaceName = (id: string) => workspaces.find((item) => item.id === id)?.name ?? "Workspace";
  const serviceName = (id: string) => services.find((item) => item.id === id)?.name ?? "Service";

  return (
    <main className="flex min-h-full flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div className="flex flex-col gap-1"><p className="text-sm font-medium text-primary">Operations</p><h1 className="text-balance text-2xl font-semibold tracking-tight text-foreground md:text-3xl">Bookings</h1><p className="text-pretty text-sm text-muted-foreground">Manage appointments, customers, and locations from one calm workspace.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setSetupOpen(true)}><Settings2 className="h-4 w-4" /> Services & locations</Button><Button onClick={() => workspaces.length ? setBookingOpen(true) : setSetupOpen(true)}><Plus className="h-4 w-4" /> New booking</Button></div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Booking overview">
        {[
          { label: "Today", value: today.length, Icon: CalendarDays, note: "Appointments scheduled" },
          { label: "Upcoming", value: upcoming.length, Icon: Clock3, note: "Future confirmed visits" },
          { label: "Completed", value: bookings.filter((b) => b.status === "completed").length, Icon: CheckCircle2, note: "Finished appointments" },
          { label: "Locations", value: workspaces.length, Icon: MapPin, note: "Active workspaces" },
        ].map(({ label, value, Icon, note }) => <Card key={label}><CardContent className="flex items-start justify-between gap-3 p-5"><div className="flex flex-col gap-1"><p className="text-sm text-muted-foreground">{label}</p><p className="text-3xl font-semibold tracking-tight text-foreground">{value}</p><p className="text-xs text-muted-foreground">{note}</p></div><div className="rounded-lg bg-primary/10 p-2 text-primary"><Icon className="h-5 w-5" /></div></CardContent></Card>)}
      </section>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border"><div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center"><div><CardTitle>Schedule</CardTitle><p className="mt-1 text-sm text-muted-foreground">Your complete appointment queue</p></div><div className="flex flex-col gap-2 sm:flex-row"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search bookings" className="pl-9 sm:w-64" placeholder="Search customer" value={query} onChange={(e) => setQuery(e.target.value)} /></div><Select items={{ all: "All statuses", confirmed: "Confirmed", pending: "Pending", completed: "Completed", cancelled: "Cancelled" }} value={status} onValueChange={(value) => value && setStatus(value)}><SelectTrigger className="sm:w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="confirmed">Confirmed</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem></SelectContent></Select><Select items={{ all: "All locations", ...Object.fromEntries(workspaces.map((item) => [item.id, item.name])) }} value={workspace} onValueChange={(value) => value && setWorkspace(value)}><SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All locations</SelectItem>{workspaces.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div></div></CardHeader>
        <CardContent className="p-0">
          {loading ? <div className="flex items-center justify-center gap-2 p-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading schedule</div> : filtered.length === 0 ? <div className="flex flex-col items-center gap-3 p-16 text-center"><div className="rounded-xl bg-muted p-3 text-muted-foreground"><CalendarDays className="h-6 w-6" /></div><div><p className="font-medium text-foreground">No bookings found</p><p className="text-sm text-muted-foreground">Create your first booking or adjust the filters.</p></div><Button size="sm" onClick={() => workspaces.length ? setBookingOpen(true) : setSetupOpen(true)}><Plus className="h-4 w-4" /> Add booking</Button></div> : <div className="divide-y divide-border">{filtered.map((item) => <article key={item.id} className="flex flex-col gap-4 p-4 transition-colors hover:bg-muted/40 md:flex-row md:items-center"><div className="flex w-20 shrink-0 flex-col"><span className="text-sm font-semibold text-foreground">{new Date(item.starts_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span className="text-xs text-muted-foreground">{new Date(item.starts_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span></div><div className="flex min-w-0 flex-1 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="h-5 w-5" /></div><div className="min-w-0"><p className="truncate font-medium text-foreground">{item.customer_name}</p><p className="truncate text-sm text-muted-foreground">{serviceName(item.service_id)} · {workspaceName(item.workspace_id)}</p></div></div><span className={cn("w-fit rounded-full border px-2.5 py-1 text-xs font-medium capitalize", statusStyle[item.status])}>{item.status.replace("_", " ")}</span><Select value={item.status} onValueChange={(value) => value && void updateStatus(item.id, value as Booking["status"])}><SelectTrigger aria-label={`Update ${item.customer_name} status`} className="w-full md:w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="confirmed">Confirmed</SelectItem><SelectItem value="completed">Completed</SelectItem><SelectItem value="cancelled">Cancelled</SelectItem><SelectItem value="no_show">No show</SelectItem></SelectContent></Select></article>)}</div>}
        </CardContent>
      </Card>

      <Dialog open={bookingOpen} onOpenChange={setBookingOpen}><DialogContent><form onSubmit={createBooking}><DialogHeader><DialogTitle>Create booking</DialogTitle><DialogDescription>Add a confirmed appointment. Duration is calculated from the selected service.</DialogDescription></DialogHeader><div className="grid gap-4 py-5"><div className="grid gap-2"><Label htmlFor="customer_name">Customer name</Label><Input id="customer_name" name="customer_name" required autoComplete="name" /></div><div className="grid gap-2"><Label htmlFor="service_id">Service</Label><Select name="service_id" required><SelectTrigger id="service_id"><SelectValue placeholder="Choose service" /></SelectTrigger><SelectContent>{services.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.duration_minutes} min · {workspaceName(item.workspace_id)}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label htmlFor="starts_at">Date and time</Label><Input id="starts_at" name="starts_at" type="datetime-local" defaultValue={toLocalInput(new Date(Date.now() + 3600000))} required /></div><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="customer_phone">Phone</Label><Input id="customer_phone" name="customer_phone" type="tel" autoComplete="tel" /></div><div className="grid gap-2"><Label htmlFor="customer_email">Email</Label><Input id="customer_email" name="customer_email" type="email" autoComplete="email" /></div></div><div className="grid gap-2"><Label htmlFor="notes">Notes</Label><Textarea id="notes" name="notes" /></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setBookingOpen(false)}>Cancel</Button><Button disabled={saving} type="submit">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Create booking</Button></DialogFooter></form></DialogContent></Dialog>

      <Dialog open={setupOpen} onOpenChange={setSetupOpen}><DialogContent><form onSubmit={createSetup}><DialogHeader><DialogTitle>Add location and service</DialogTitle><DialogDescription>Set up where you work and what customers can book.</DialogDescription></DialogHeader><div className="grid gap-4 py-5"><div className="grid gap-2"><Label htmlFor="workspace_name">Location name</Label><Input id="workspace_name" name="workspace_name" placeholder="Downtown clinic" required /></div><div className="grid gap-2"><Label htmlFor="address">Address</Label><Input id="address" name="address" placeholder="123 Main Street" /></div><div className="grid gap-2"><Label htmlFor="service_name">Service name</Label><Input id="service_name" name="service_name" placeholder="Initial consultation" required /></div><div className="grid gap-2"><Label htmlFor="duration_minutes">Duration</Label><Select name="duration_minutes" defaultValue="30"><SelectTrigger id="duration_minutes"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="15">15 minutes</SelectItem><SelectItem value="30">30 minutes</SelectItem><SelectItem value="45">45 minutes</SelectItem><SelectItem value="60">60 minutes</SelectItem><SelectItem value="90">90 minutes</SelectItem></SelectContent></Select></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setSetupOpen(false)}>Cancel</Button><Button disabled={saving} type="submit">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save setup</Button></DialogFooter></form></DialogContent></Dialog>
    </main>
  );
}
