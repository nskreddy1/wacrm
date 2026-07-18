"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { toast } from "sonner"
import {
  Archive,
  Check,
  ChevronRight,
  CirclePause,
  Clock3,
  Copy,
  FileText,
  GitBranch,
  LayoutGrid,
  List,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Workflow,
  Zap,
} from "lucide-react"

import type { Automation, AutomationTriggerType } from "@/types"
import { AUTOMATION_TEMPLATES, type TemplateSlug } from "@/lib/automations/templates"
import { formatRelative, triggerMeta } from "@/lib/automations/trigger-meta"
import { useCan } from "@/hooks/use-can"
import { cn } from "@/lib/utils"
import { pageContainerClassName } from "@/components/layout/page-container"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FeatureLoading, FeatureState } from "@/components/ui/feature-state"
import { GatedButton } from "@/components/ui/gated-button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

const fetcher = async (url: string) => {
  const response = await fetch(url, { cache: "no-store" })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error ?? "Request failed")
  return body
}

type FlowRow = {
  id: string
  name: string
  description: string | null
  status: "draft" | "active" | "archived"
  trigger_type: "keyword" | "first_inbound_message" | "manual"
  trigger_config: { keywords?: string[] } | Record<string, unknown>
  execution_count: number
  last_executed_at: string | null
  created_at: string
  updated_at: string
}

type WorkspaceItem = {
  id: string
  source: "rule" | "flow"
  name: string
  description: string | null
  status: "active" | "draft" | "archived"
  trigger: string
  runs: number
  lastRun: string | null
  updatedAt: string
  raw: Automation | FlowRow
}

type TriggerChoice = {
  id: AutomationTriggerType | "flow_keyword" | "flow_first_inbound" | "flow_manual"
  label: string
  description: string
  group: "Messages" | "Contacts and conversations" | "Schedule"
  source: "rule" | "flow"
  requiresChannel: boolean
  icon: typeof Zap
}

const TRIGGERS: TriggerChoice[] = [
  { id: "new_message_received", label: "New message received", description: "Run whenever a customer sends a message.", group: "Messages", source: "rule", requiresChannel: true, icon: MessageCircle },
  { id: "first_inbound_message", label: "First message from contact", description: "Welcome a contact the first time they reply.", group: "Messages", source: "rule", requiresChannel: true, icon: Sparkles },
  { id: "keyword_match", label: "Message contains keywords", description: "Run when an inbound message matches your words.", group: "Messages", source: "rule", requiresChannel: true, icon: Search },
  { id: "interactive_reply", label: "Button or list reply", description: "Continue when a customer taps an interactive option.", group: "Messages", source: "rule", requiresChannel: true, icon: GitBranch },
  { id: "flow_keyword", label: "Build a conversation from keywords", description: "Create a branching, multi-step customer conversation.", group: "Messages", source: "flow", requiresChannel: true, icon: Workflow },
  { id: "flow_first_inbound", label: "Build a first-message conversation", description: "Start a visual conversation on a contact’s first message.", group: "Messages", source: "flow", requiresChannel: true, icon: Workflow },
  { id: "new_contact_created", label: "New contact created", description: "Run when a contact is added to your CRM.", group: "Contacts and conversations", source: "rule", requiresChannel: false, icon: UserPlus },
  { id: "conversation_assigned", label: "Conversation assigned", description: "Run when ownership of a conversation changes.", group: "Contacts and conversations", source: "rule", requiresChannel: false, icon: Users },
  { id: "tag_added", label: "Tag added", description: "Run when a selected tag is applied to a contact.", group: "Contacts and conversations", source: "rule", requiresChannel: false, icon: Settings2 },
  { id: "time_based", label: "Scheduled time", description: "Run on a recurring schedule.", group: "Schedule", source: "rule", requiresChannel: false, icon: Clock3 },
  { id: "flow_manual", label: "Manual conversation flow", description: "Create a flow that is started manually.", group: "Contacts and conversations", source: "flow", requiresChannel: false, icon: Play },
]

const TEMPLATE_META: Array<{ source: "rule" | "flow"; slug: string; name: string; description: string; icon: typeof Zap }> = [
  ...Object.values(AUTOMATION_TEMPLATES).map((template) => ({ source: "rule" as const, slug: template.slug, name: template.name, description: template.description, icon: Zap })),
  { source: "flow", slug: "welcome_menu", name: "Welcome menu", description: "Greet customers and route them with reply buttons.", icon: MessageCircle },
  { source: "flow", slug: "faq_bot", name: "FAQ assistant", description: "Answer common questions with a guided list.", icon: FileText },
  { source: "flow", slug: "lead_capture", name: "Lead capture", description: "Collect details and hand qualified leads to your team.", icon: UserPlus },
]

export function AutomationsWorkspace() {
  const router = useRouter()
  const canCreate = useCan("send-messages")
  const { data: automationData, error: automationError, mutate: mutateAutomations } = useSWR<{ automations: Automation[] }>("/api/automations", fetcher)
  const { data: flowData, error: flowError, mutate: mutateFlows } = useSWR<{ flows: FlowRow[] }>("/api/flows", fetcher)
  const { data: channelData } = useSWR<{ connected?: boolean }>("/api/whatsapp/config", fetcher, { shouldRetryOnError: false })
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<"all" | "active" | "draft" | "archived">("all")
  const [type, setType] = useState<"all" | "rule" | "flow">("all")
  const [view, setView] = useState<"list" | "grid">("list")
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteItem, setDeleteItem] = useState<WorkspaceItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const items = useMemo<WorkspaceItem[]>(() => {
    const rules = (automationData?.automations ?? []).map((item) => ({
      id: item.id,
      source: "rule" as const,
      name: item.name,
      description: item.description ?? null,
      status: item.is_active ? "active" as const : "draft" as const,
      trigger: triggerMeta(item.trigger_type).label,
      runs: item.execution_count ?? 0,
      lastRun: item.last_executed_at ?? null,
      updatedAt: item.updated_at,
      raw: item,
    }))
    const flows = (flowData?.flows ?? []).map((item) => ({
      id: item.id,
      source: "flow" as const,
      name: item.name,
      description: item.description,
      status: item.status,
      trigger: item.trigger_type === "keyword" ? "Keyword conversation" : item.trigger_type === "first_inbound_message" ? "First message conversation" : "Manual conversation",
      runs: item.execution_count ?? 0,
      lastRun: item.last_executed_at,
      updatedAt: item.updated_at,
      raw: item,
    }))
    return [...rules, ...flows].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [automationData, flowData])

  const filteredItems = items.filter((item) => {
    const matchesQuery = `${item.name} ${item.description ?? ""} ${item.trigger}`.toLowerCase().includes(query.toLowerCase())
    return matchesQuery && (status === "all" || item.status === status) && (type === "all" || item.source === type)
  })

  const refresh = () => Promise.all([mutateAutomations(), mutateFlows()])
  const editHref = (item: WorkspaceItem) => item.source === "flow" ? `/automations/flows/${item.id}` : `/automations/${item.id}/edit`
  const historyHref = (item: WorkspaceItem) => item.source === "flow" ? `/automations/flows/${item.id}/runs` : `/automations/${item.id}/logs`

  async function setActive(item: WorkspaceItem, active: boolean) {
    const endpoint = item.source === "flow" ? `/api/flows/${item.id}` : `/api/automations/${item.id}`
    const body = item.source === "flow" ? { status: active ? "active" : "draft" } : { is_active: active }
    const response = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) return toast.error(payload.error ?? "Could not update automation")
    toast.success(active ? "Automation activated" : "Automation paused")
    refresh()
  }

  async function duplicate(item: WorkspaceItem) {
    if (item.source === "flow") {
      toast.info("Open the conversation flow and use Save as copy.")
      router.push(editHref(item))
      return
    }
    const response = await fetch(`/api/automations/${item.id}/duplicate`, { method: "POST" })
    if (!response.ok) return toast.error("Could not duplicate automation")
    toast.success("Automation duplicated")
    mutateAutomations()
  }

  async function confirmDelete() {
    if (!deleteItem) return
    setDeleting(true)
    const endpoint = deleteItem.source === "flow" ? `/api/flows/${deleteItem.id}` : `/api/automations/${deleteItem.id}`
    const response = await fetch(endpoint, { method: "DELETE" })
    setDeleting(false)
    if (!response.ok) return toast.error("Could not delete automation")
    toast.success("Automation deleted")
    setDeleteItem(null)
    refresh()
  }

  if (!automationData || !flowData) {
    if (automationError || flowError) {
      return <div className="flex min-h-[60vh] items-center justify-center p-6"><FeatureState icon={RefreshCw} title="Automation workspace unavailable" description="We could not load your automations. Existing rules were not changed." action={{ label: "Retry", onClick: refresh }} /></div>
    }
    return <FeatureLoading label="Loading automations" />
  }

  return (
    <main className={cn(pageContainerClassName, "flex flex-col gap-6")}>
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><Workflow className="size-5" aria-hidden /></span>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Automations</h1>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">Build message journeys and operational rules from one workspace.</p>
        </div>
        <GatedButton canAct={canCreate} gateReason="create automations" onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" /> New automation
        </GatedButton>
      </header>

      <section aria-label="Automation summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Total" value={items.length} icon={Workflow} />
        <Metric label="Active" value={items.filter((item) => item.status === "active").length} icon={Play} />
        <Metric label="Drafts" value={items.filter((item) => item.status === "draft").length} icon={CirclePause} />
        <Metric label="Runs" value={items.reduce((sum, item) => sum + item.runs, 0)} icon={RefreshCw} />
      </section>

      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div><CardTitle>All automations</CardTitle><CardDescription>Manage every rule and customer journey.</CardDescription></div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="relative min-w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <span className="sr-only">Search automations</span>
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search automations" className="pl-9" />
              </label>
              <FilterSelect label="Status" value={status} onChange={(value) => setStatus(value as typeof status)} options={["all", "active", "draft", "archived"]} />
              <FilterSelect label="Type" value={type} onChange={(value) => setType(value as typeof type)} options={["all", "rule", "flow"]} />
              <div className="flex rounded-md border bg-muted p-1" aria-label="View options">
                <Button variant={view === "list" ? "secondary" : "ghost"} size="icon-sm" onClick={() => setView("list")} aria-label="List view"><List /></Button>
                <Button variant={view === "grid" ? "secondary" : "ghost"} size="icon-sm" onClick={() => setView("grid")} aria-label="Grid view"><LayoutGrid /></Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-xl bg-muted"><Workflow className="size-5 text-muted-foreground" /></span>
              <div><h2 className="font-medium text-foreground">{items.length ? "No matching automations" : "Create your first automation"}</h2><p className="mt-1 text-sm text-muted-foreground">{items.length ? "Try changing your search or filters." : "Start with a trigger, then add the actions that should happen."}</p></div>
              {!items.length && <Button onClick={() => setCreateOpen(true)}><Plus data-icon="inline-start" /> New automation</Button>}
            </div>
          ) : view === "list" ? (
            <div className="divide-y">{filteredItems.map((item) => <AutomationRow key={`${item.source}-${item.id}`} item={item} onEdit={() => router.push(editHref(item))} onHistory={() => router.push(historyHref(item))} onActive={(active) => setActive(item, active)} onDuplicate={() => duplicate(item)} onDelete={() => setDeleteItem(item)} />)}</div>
          ) : (
            <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">{filteredItems.map((item) => <AutomationGridCard key={`${item.source}-${item.id}`} item={item} onEdit={() => router.push(editHref(item))} onActive={(active) => setActive(item, active)} />)}</div>
          )}
        </CardContent>
      </Card>

      <CreateAutomationDialog open={createOpen} onOpenChange={setCreateOpen} channelConnected={!!channelData?.connected} creating={creating} setCreating={setCreating} onCreated={() => refresh()} />
      <Dialog open={!!deleteItem} onOpenChange={(open) => !open && setDeleteItem(null)}>
        <DialogContent><DialogHeader><DialogTitle>Delete automation?</DialogTitle><DialogDescription>This permanently deletes “{deleteItem?.name}”. Existing execution history may be retained for auditing.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteItem(null)}>Cancel</Button><Button variant="destructive" disabled={deleting} onClick={confirmDelete}><Trash2 data-icon="inline-start" /> {deleting ? "Deleting…" : "Delete"}</Button></DialogFooter></DialogContent>
      </Dialog>
    </main>
  )
}

function Metric({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Workflow }) {
  return <Card><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p></div><span className="flex size-9 items-center justify-center rounded-lg bg-muted"><Icon className="size-4 text-muted-foreground" /></span></CardContent></Card>
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="flex items-center gap-2 rounded-md border bg-background px-3"><span className="sr-only">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 bg-transparent text-sm capitalize text-foreground outline-none">{options.map((option) => <option key={option} value={option}>{option === "all" ? `All ${label.toLowerCase()}s` : option === "flow" ? "Conversation flows" : option === "rule" ? "Rule automations" : option}</option>)}</select></label>
}

function AutomationRow({ item, onEdit, onHistory, onActive, onDuplicate, onDelete }: { item: WorkspaceItem; onEdit: () => void; onHistory: () => void; onActive: (active: boolean) => void; onDuplicate: () => void; onDelete: () => void }) {
  return <article className="flex flex-col gap-4 p-4 transition-colors hover:bg-muted/40 md:flex-row md:items-center">
    <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-start gap-3 text-left">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-background">{item.source === "flow" ? <GitBranch className="size-4 text-primary" /> : <Zap className="size-4 text-primary" />}</span>
      <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><strong className="truncate text-sm text-foreground">{item.name}</strong><StatusBadge status={item.status} /><Badge variant="outline">{item.source === "flow" ? "Conversation flow" : "Rule automation"}</Badge></span><span className="mt-1 block truncate text-xs text-muted-foreground">{item.description || item.trigger}</span></span>
    </button>
    <div className="grid grid-cols-3 gap-4 text-xs md:w-96"><Detail label="Trigger" value={item.trigger} /><Detail label="Runs" value={String(item.runs)} /><Detail label="Last run" value={formatRelative(item.lastRun)} /></div>
    <div className="flex items-center justify-end gap-2"><Switch checked={item.status === "active"} disabled={item.status === "archived"} onCheckedChange={(checked) => onActive(!!checked)} aria-label={item.status === "active" ? "Pause automation" : "Activate automation"} /><DropdownMenu><DropdownMenuTrigger aria-label={`Actions for ${item.name}`} className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="size-4" /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={onEdit}><Pencil /> Edit</DropdownMenuItem><DropdownMenuItem onClick={onHistory}><FileText /> Run history</DropdownMenuItem><DropdownMenuItem onClick={onDuplicate}><Copy /> Duplicate</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={onDelete} className="text-destructive"><Trash2 /> Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
  </article>
}

function AutomationGridCard({ item, onEdit, onActive }: { item: WorkspaceItem; onEdit: () => void; onActive: (active: boolean) => void }) {
  return <Card className="transition-colors hover:border-primary/40"><CardHeader><div className="flex items-start justify-between gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">{item.source === "flow" ? <GitBranch className="size-4" /> : <Zap className="size-4" />}</span><Switch checked={item.status === "active"} onCheckedChange={(checked) => onActive(!!checked)} aria-label={item.status === "active" ? "Pause automation" : "Activate automation"} /></div><CardTitle className="mt-2 text-base">{item.name}</CardTitle><CardDescription className="line-clamp-2">{item.description || item.trigger}</CardDescription></CardHeader><CardContent className="flex flex-col gap-4"><div className="flex flex-wrap gap-2"><StatusBadge status={item.status} /><Badge variant="outline">{item.source === "flow" ? "Conversation flow" : "Rule automation"}</Badge></div><div className="grid grid-cols-2 gap-3"><Detail label="Trigger" value={item.trigger} /><Detail label="Runs" value={String(item.runs)} /></div><Button variant="outline" onClick={onEdit}>Open builder <ChevronRight data-icon="inline-end" /></Button></CardContent></Card>
}

function StatusBadge({ status }: { status: WorkspaceItem["status"] }) { return <Badge variant={status === "active" ? "default" : "secondary"}>{status === "active" ? <Check /> : status === "archived" ? <Archive /> : <CirclePause />}{status}</Badge> }
function Detail({ label, value }: { label: string; value: string }) { return <span className="min-w-0"><span className="block text-muted-foreground">{label}</span><span className="mt-0.5 block truncate font-medium text-foreground" title={value}>{value}</span></span> }

function CreateAutomationDialog({ open, onOpenChange, channelConnected, creating, setCreating, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; channelConnected: boolean; creating: boolean; setCreating: (value: boolean) => void; onCreated: () => void }) {
  const router = useRouter()
  const [step, setStep] = useState<"start" | "trigger" | "name">("start")
  const [selectedTrigger, setSelectedTrigger] = useState<TriggerChoice | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<(typeof TEMPLATE_META)[number] | null>(null)
  const [name, setName] = useState("")
  const [search, setSearch] = useState("")
  const [mode, setMode] = useState<"blank" | "template">("blank")

  function close(next: boolean) { onOpenChange(next); if (!next) { setStep("start"); setSelectedTrigger(null); setSelectedTemplate(null); setName(""); setSearch(""); } }

  async function create() {
    setCreating(true)
    try {
      if (selectedTemplate) {
        const endpoint = selectedTemplate.source === "flow" ? "/api/flows" : "/api/automations"
        const body = selectedTemplate.source === "flow" ? { template_slug: selectedTemplate.slug, name: name.trim() || undefined } : { template: selectedTemplate.slug, name: name.trim() || undefined }
        const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error ?? "Could not create automation")
        onCreated(); close(false); router.push(selectedTemplate.source === "flow" ? `/automations/flows/${payload.flow.id}` : `/automations/${payload.automation.id}/edit`); return
      }
      if (!selectedTrigger || !name.trim()) return
      const isFlow = selectedTrigger.source === "flow"
      const flowTrigger = selectedTrigger.id === "flow_keyword" ? "keyword" : selectedTrigger.id === "flow_first_inbound" ? "first_inbound_message" : "manual"
      const endpoint = isFlow ? "/api/flows" : "/api/automations"
      const body = isFlow ? { name: name.trim(), trigger_type: flowTrigger, trigger_config: flowTrigger === "keyword" ? { keywords: [] } : {} } : { name: name.trim(), trigger_type: selectedTrigger.id, trigger_config: {}, is_active: false }
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? "Could not create automation")
      onCreated(); close(false); router.push(isFlow ? `/automations/flows/${payload.flow.id}` : `/automations/${payload.automation.id}/edit`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create automation") } finally { setCreating(false) }
  }

  const visibleTriggers = TRIGGERS.filter((trigger) => (!trigger.requiresChannel || channelConnected) && `${trigger.label} ${trigger.description}`.toLowerCase().includes(search.toLowerCase()))

  return <Dialog open={open} onOpenChange={close}><DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{step === "start" ? "Create an automation" : step === "trigger" ? "Start automation when…" : "Name your automation"}</DialogTitle><DialogDescription>{step === "start" ? "Start from scratch or choose a proven recipe." : step === "trigger" ? "Choose the event that starts this automation." : "Use a clear name your team will recognize."}</DialogDescription></DialogHeader>
    {step === "start" && <div className="flex flex-col gap-5"><div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setMode("blank")} className={cn("rounded-lg border p-4 text-left", mode === "blank" && "border-primary bg-primary/5")}><Zap className="size-5 text-primary" /><strong className="mt-3 block text-sm">Start from scratch</strong><span className="mt-1 block text-xs text-muted-foreground">Choose a trigger and build each step.</span></button><button type="button" onClick={() => setMode("template")} className={cn("rounded-lg border p-4 text-left", mode === "template" && "border-primary bg-primary/5")}><Copy className="size-5 text-primary" /><strong className="mt-3 block text-sm">Use a template</strong><span className="mt-1 block text-xs text-muted-foreground">Launch with prebuilt steps you can edit.</span></button></div>{mode === "template" && <div className="grid gap-3 sm:grid-cols-2">{TEMPLATE_META.map((template) => <button key={`${template.source}-${template.slug}`} type="button" onClick={() => { setSelectedTemplate(template); setName(template.name); setStep("name") }} className="flex items-start gap-3 rounded-lg border p-3 text-left hover:border-primary/50"><span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><ChoiceIcon icon={template.icon} /></span><span><strong className="text-sm">{template.name}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{template.description}</span></span></button>)}</div>}</div>}
    {step === "trigger" && <div className="flex flex-col gap-4"><label className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><span className="sr-only">Search triggers</span><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search triggers" className="pl-9" /></label>{!channelConnected && <Card><CardContent className="flex items-center justify-between gap-4 p-4"><div><p className="text-sm font-medium">Messaging triggers need a connected channel</p><p className="mt-1 text-xs text-muted-foreground">Connect WhatsApp to unlock message and conversation triggers.</p></div><Button variant="outline" onClick={() => router.push("/settings")}>Connect channel</Button></CardContent></Card>}{(["Messages", "Contacts and conversations", "Schedule"] as const).map((group) => { const options = visibleTriggers.filter((trigger) => trigger.group === group); if (!options.length) return null; return <section key={group}><h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</h3><div className="grid gap-2 sm:grid-cols-2">{options.map((trigger) => <button key={trigger.id} type="button" onClick={() => { setSelectedTrigger(trigger); setName(""); setStep("name") }} className="flex items-start gap-3 rounded-lg border p-3 text-left hover:border-primary/50 hover:bg-muted/40"><span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"><ChoiceIcon icon={trigger.icon} /></span><span><strong className="text-sm text-foreground">{trigger.label}</strong><span className="mt-1 block text-xs leading-5 text-muted-foreground">{trigger.description}</span></span></button>)}</div></section> })}</div>}
    {step === "name" && <div className="flex flex-col gap-4 py-2"><Card><CardContent className="flex items-center gap-3 p-4"><span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">{selectedTemplate ? <ChoiceIcon icon={selectedTemplate.icon} /> : selectedTrigger ? <ChoiceIcon icon={selectedTrigger.icon} /> : <Zap className="size-4" />}</span><div><p className="text-sm font-medium">{selectedTemplate?.name ?? selectedTrigger?.label}</p><p className="text-xs text-muted-foreground">{selectedTemplate ? "Template" : selectedTrigger?.source === "flow" ? "Conversation flow" : "Rule automation"}</p></div></CardContent></Card><label className="flex flex-col gap-2"><span className="text-sm font-medium">Automation name</span><Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Welcome new leads" onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) create() }} /></label></div>}
    <DialogFooter className="mt-2"><Button variant="outline" onClick={() => step === "start" ? close(false) : setStep(step === "name" && !selectedTemplate ? "trigger" : "start")}>{step === "start" ? "Cancel" : "Back"}</Button>{step === "start" && mode === "blank" && <Button onClick={() => setStep("trigger")}>Choose trigger <ChevronRight data-icon="inline-end" /></Button>}{step === "name" && <Button onClick={create} disabled={!name.trim() || creating}>{creating ? "Creating…" : "Create automation"}</Button>}</DialogFooter>
  </DialogContent></Dialog>
}

function ChoiceIcon({ icon: Icon }: { icon: typeof Zap }) {
  return <Icon className="size-4" aria-hidden />
}
