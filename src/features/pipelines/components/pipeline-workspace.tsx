"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { ArrowDown, ArrowUp, CalendarClock, ChevronDown, CircleDollarSign, Crown, Download, Ellipsis, Filter, LayoutGrid, List, Maximize2, Minimize2, Plus, Search, Table2, Target, Trash2, TrendingUp, Users, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SubPipelineTabs } from "./sub-pipeline-tabs"
import { PipelineDealEditor } from "./pipeline-deal-editor"
import { PipelineSheet } from "./pipeline-data-sheet"
import { cacheKeys } from "@/lib/cache/keys"
import { createSubPipelineAction, deleteDealsAction, moveDealAction, reorderSubPipelinesAction, saveDealAction } from "@/features/pipelines/lib/actions"
import type { PipelineDeal, PipelineMode, PipelineSnapshot, PipelineStage } from "@/features/pipelines/lib/domain"
import { formatCurrency } from "@/lib/currency"
import { useAuth } from "@/features/auth/hooks/use-auth"
import { downloadCsv } from "@/lib/download-csv"
import { pipelinePath } from "@/lib/routes/dashboard-routes"
import { cn } from "@/lib/utils"

type SortKey = "createdAt" | "value" | "due"
type FilterPreset = { name: string; owner: string; stage: string }

const money = formatCurrency

function dueState(due: string | null) {
  if (!due) return null
  const days = Math.ceil((new Date(`${due}T23:59:59`).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return { label: "Overdue", urgent: true }
  if (days <= 7) return { label: days === 0 ? "Due today" : `Due in ${days}d`, urgent: false }
  return null
}

export function PipelineWorkspace({ initialSnapshot, initialMode, initialSubPipelineId, initialSavedViewId }: { initialSnapshot: PipelineSnapshot; initialMode: PipelineMode; initialSubPipelineId?: string; initialSavedViewId?: string }) {
  const router = useRouter()
  const searchRef = useRef<HTMLInputElement>(null)
  // Client-side cache only: all updates flow through explicit `mutate`
  // calls with { revalidate: false }. Revalidation must stay fully off —
  // otherwise SWR joins the array key into a bogus URL ("/account,…,snapshot")
  // and hits the global fetcher with it (observed as repeating 404s).
  const { data: snapshot = initialSnapshot, mutate } = useSWR<PipelineSnapshot>(
    cacheKeys.pipelineSnapshot(initialSnapshot.accountId, initialSnapshot.pipeline.id),
    null,
    {
      fallbackData: initialSnapshot,
      revalidateOnMount: false,
      revalidateIfStale: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  )
  const [query, setQuery] = useState("")
  const [owner, setOwner] = useState("all")
  const [stage, setStage] = useState("all")
  const [sort, setSort] = useState<SortKey>("createdAt")
  const [ascending, setAscending] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [presets, setPresets] = useState<FilterPreset[]>(() => {
    if (typeof window === "undefined") return []
    try { return JSON.parse(localStorage.getItem(`pipeline-presets:${initialSnapshot.pipeline.id}`) ?? "[]") as FilterPreset[] } catch { return [] }
  })
  const [presetName, setPresetName] = useState("")
  const [activeSubPipelineId, setActiveSubPipelineId] = useState(initialSubPipelineId ?? snapshot.subPipelines[0]?.id ?? snapshot.pipeline.id)
  // Stage columns minimized to a narrow vertical strip, persisted per pipeline
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set()
    try { return new Set(JSON.parse(localStorage.getItem(`pipeline-collapsed:${initialSnapshot.pipeline.id}`) ?? "[]") as string[]) } catch { return new Set() }
  })
  function toggleStageCollapsed(stageId: string) {
    setCollapsedStages((current) => {
      const next = new Set(current)
      if (next.has(stageId)) next.delete(stageId)
      else next.add(stageId)
      localStorage.setItem(`pipeline-collapsed:${initialSnapshot.pipeline.id}`, JSON.stringify([...next]))
      return next
    })
  }
  const [editing, setEditing] = useState<PipelineDeal | "new" | null>(null)
  const [defaultStageId, setDefaultStageId] = useState(snapshot.stages[0]?.id ?? "")
  const [pending, startTransition] = useTransition()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor))
  const activeSubPipeline = snapshot.subPipelines.find((item) => item.id === activeSubPipelineId)
  const activeFilterCount = Number(owner !== "all") + Number(stage !== "all")
  // Workspace currency (Settings → Deals) — the single source of truth
  // for every money figure across the pipeline surfaces.
  const { defaultCurrency: currency } = useAuth()

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement
      if (target.matches("input, textarea, select, [contenteditable=true]")) return
      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus() }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); setDefaultStageId(snapshot.stages[0]?.id ?? ""); setEditing("new") }
      if (event.key.toLowerCase() === "b") changeMode("board")
      if (event.key.toLowerCase() === "l") changeMode("list")
      if (event.key.toLowerCase() === "s") changeMode("sheet")
    }
    window.addEventListener("keydown", shortcuts)
    return () => window.removeEventListener("keydown", shortcuts)
  })

  const deals = useMemo(() => {
    const allowed = new Set(activeSubPipeline?.dealIds ?? snapshot.deals.map((deal) => deal.id))
    const term = query.trim().toLowerCase()
    return snapshot.deals.filter((deal) => allowed.has(deal.id) && (stage === "all" || deal.stageId === stage) && (owner === "all" || deal.assignedTo === owner) && (!term || `${deal.title} ${deal.contact?.name ?? ""} ${deal.company ?? ""}`.toLowerCase().includes(term))).sort((a, b) => {
      const left = a[sort] ?? ""; const right = b[sort] ?? ""
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * (ascending ? 1 : -1)
    })
  }, [activeSubPipeline, ascending, owner, query, snapshot.deals, sort, stage])

  const insights = useMemo(() => ({
    value: deals.reduce((sum, deal) => sum + deal.value, 0),
    open: deals.filter((deal) => deal.status === "open").length,
    forecast: deals.reduce((sum, deal) => sum + deal.value * deal.probability / 100, 0),
    overdue: deals.filter((deal) => dueState(deal.due)?.urgent).length,
  }), [deals])

  function changeMode(mode: PipelineMode) {
    router.replace(pipelinePath(snapshot.accountId, snapshot.pipeline.id, mode, { subPipeline: activeSubPipelineId, savedView: initialSavedViewId }))
  }
  function createInStage(stageId: string) { setDefaultStageId(stageId); setEditing("new") }
  function clearFilters() { setOwner("all"); setStage("all") }
  function savePreset() {
    const name = presetName.trim()
    if (!name || activeFilterCount === 0) return
    const next = [...presets.filter((item) => item.name.toLowerCase() !== name.toLowerCase()), { name, owner, stage }]
    setPresets(next); localStorage.setItem(`pipeline-presets:${snapshot.pipeline.id}`, JSON.stringify(next)); setPresetName(""); toast.success("Filter preset saved")
  }
  async function optimisticDeal(next: PipelineDeal) { return mutate({ ...snapshot, deals: snapshot.deals.map((deal) => deal.id === next.id ? next : deal) }, { revalidate: false }) }
  async function moveDeal(dealId: string, stageId: string) {
    const previous = snapshot; const current = snapshot.deals.find((deal) => deal.id === dealId)
    if (!current || current.stageId === stageId) return
    await optimisticDeal({ ...current, stageId })
    const result = await moveDealAction(dealId, snapshot.pipeline.id, stageId)
    if (!result.ok) { await mutate(previous, { revalidate: false }); toast.error(result.error); return }
    await optimisticDeal(result.data); toast.success(`Moved to ${snapshot.stages.find((item) => item.id === stageId)?.name ?? "stage"}`)
  }
  async function deleteSelected() {
    const previous = snapshot; const ids = [...selected]
    setDeleteOpen(false); await mutate({ ...snapshot, deals: snapshot.deals.filter((deal) => !selected.has(deal.id)) }, { revalidate: false })
    const result = await deleteDealsAction(snapshot.pipeline.id, ids)
    if (!result.ok) { await mutate(previous, { revalidate: false }); toast.error(result.error); return }
    setSelected(new Set()); toast.success(`${ids.length} deal${ids.length === 1 ? "" : "s"} deleted`)
  }
  async function saveDeal(input: Parameters<typeof saveDealAction>[0]) {
    const isNew = !(input && typeof input === "object" && "id" in input && input.id)
    const realSubPipelineId = isNew && activeSubPipelineId !== snapshot.pipeline.id ? activeSubPipelineId : undefined
    const result = await saveDealAction(input, realSubPipelineId)
    if (!result.ok) return result
    await mutate((current) => {
      const source = current ?? snapshot
      const exists = source.deals.some((deal) => deal.id === result.data.id)
      return {
        ...source,
        deals: exists ? source.deals.map((deal) => deal.id === result.data.id ? result.data : deal) : [result.data, ...source.deals],
        subPipelines: realSubPipelineId
          ? source.subPipelines.map((pipeline) => pipeline.id === realSubPipelineId && !pipeline.dealIds.includes(result.data.id) ? { ...pipeline, dealIds: [result.data.id, ...pipeline.dealIds] } : pipeline)
          : source.subPipelines,
      }
    }, { revalidate: false })
    setEditing(null); toast.success(isNew ? "Deal created" : "Deal saved"); return result
  }
  async function createSubPipeline(name: string) {
    const result = await createSubPipelineAction({ pipelineId: snapshot.pipeline.id, name, position: snapshot.subPipelines.length })
    if (!result.ok) return toast.error(result.error)
    await mutate({ ...snapshot, subPipelines: [...snapshot.subPipelines, result.data] }, { revalidate: false }); setActiveSubPipelineId(result.data.id)
  }
  async function reorderSubPipelines(items: { id: string; name: string; dealIds: string[] }[]) {
    const previous = snapshot; const next = items.map((item, position) => ({ ...snapshot.subPipelines.find((pipeline) => pipeline.id === item.id)!, ...item, position }))
    await mutate({ ...snapshot, subPipelines: next }, { revalidate: false })
    const result = await reorderSubPipelinesAction(snapshot.pipeline.id, next)
    if (!result.ok) { await mutate(previous, { revalidate: false }); toast.error(result.error) } else toast.success("Board order saved")
  }
  function exportDeals() {
    const ok = downloadCsv("pipeline-deals.csv", [["Deal", "Contact", "Company", "Value", "Stage", "Owner", "Closing date"], ...deals.map((deal) => [deal.title, deal.contact?.name ?? "", deal.company ?? "", deal.value, snapshot.stages.find((item) => item.id === deal.stageId)?.name ?? "", deal.owner?.name ?? "", deal.due ?? ""])])
    if (ok) toast.success(`${deals.length} deals exported`)
    else toast.error("No deals to export")
  }

  return <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2 lg:px-4">
      <Popover><PopoverTrigger render={<Button variant="ghost" size="icon" className="relative rounded-full bg-primary-soft text-primary hover:bg-primary-soft-2 hover:text-primary" aria-label={`Filters${activeFilterCount ? `, ${activeFilterCount} active` : ""}`} />}><Filter />{activeFilterCount > 0 && <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">{activeFilterCount}</span>}</PopoverTrigger><PopoverContent align="start" className="w-80"><div className="flex flex-col gap-4"><div><p className="font-medium">Filter deals</p><p className="text-sm text-muted-foreground">Search and narrow this board.</p></div><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9 pr-9" placeholder="Search deals" aria-label="Search deals" />{query && <Button variant="ghost" size="icon-sm" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setQuery("")} aria-label="Clear search"><X /></Button>}</div><Select items={{ all: "All owners", ...Object.fromEntries(snapshot.members.map((member) => [member.id, member.name])) }} value={owner} onValueChange={(value) => value && setOwner(value)}><SelectTrigger className="w-full"><SelectValue placeholder="Owner" /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All owners</SelectItem>{snapshot.members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectGroup></SelectContent></Select><Select items={{ all: "All stages", ...Object.fromEntries(snapshot.stages.map((item) => [item.id, item.name])) }} value={stage} onValueChange={(value) => value && setStage(value)}><SelectTrigger className="w-full"><SelectValue placeholder="Stage" /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All stages</SelectItem>{snapshot.stages.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent></Select>{presets.length > 0 && <div className="flex flex-wrap gap-2">{presets.map((preset) => <Button key={preset.name} variant="secondary" size="sm" onClick={() => { setOwner(preset.owner); setStage(preset.stage) }}>{preset.name}</Button>)}</div>}<div className="flex gap-2"><Input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Preset name" aria-label="Filter preset name" /><Button variant="outline" onClick={savePreset} disabled={!presetName.trim() || activeFilterCount === 0}>Save</Button></div><Button variant="ghost" onClick={clearFilters} disabled={activeFilterCount === 0}>Clear filters</Button></div></PopoverContent></Popover>
      <Select items={Object.fromEntries(snapshot.pipelines.map((pipeline) => [pipeline.id, pipeline.name]))} value={snapshot.pipeline.id} onValueChange={(id) => id && router.push(pipelinePath(snapshot.accountId, id, initialMode))}><SelectTrigger className="min-w-36 rounded-full sm:w-44"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{snapshot.pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}</SelectGroup></SelectContent></Select>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <span className="hidden text-sm text-muted-foreground lg:inline">Sort By</span>
        <Select items={{ createdAt: "Created Time", value: "Amount", due: "Closing Date" }} value={sort} onValueChange={(value) => value && setSort(value as SortKey)}><SelectTrigger className="w-36 rounded-full" aria-label="Sort deals by"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="createdAt">Created Time</SelectItem><SelectItem value="value">Amount</SelectItem><SelectItem value="due">Closing Date</SelectItem></SelectGroup></SelectContent></Select>
        <Button variant="outline" size="icon" onClick={() => setAscending((value) => !value)} aria-label={`Sort ${ascending ? "descending" : "ascending"}`}>{ascending ? <ArrowUp /> : <ArrowDown />}</Button>
        <Tabs value={initialMode} onValueChange={(value) => changeMode(value as PipelineMode)}><TabsList><TabsTrigger value="board" aria-label="Board view"><LayoutGrid /></TabsTrigger><TabsTrigger value="list" aria-label="List view"><List /></TabsTrigger><TabsTrigger value="sheet" aria-label="Sheet view"><Table2 /></TabsTrigger></TabsList></Tabs>
        <span className="flex items-center">
          <Button className="rounded-l-full rounded-r-none pl-4" onClick={() => createInStage(snapshot.stages[0]?.id ?? "")}><Plus data-icon="inline-start" />Deal</Button>
          <DropdownMenu><DropdownMenuTrigger render={<Button size="icon" className="rounded-l-none rounded-r-full border-l border-primary-foreground/25" aria-label="Create deal in a specific stage" />}><ChevronDown /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>{snapshot.stages.map((item) => <DropdownMenuItem key={item.id} onClick={() => createInStage(item.id)}><span className="size-2 rounded-full" style={{ backgroundColor: item.color }} aria-hidden="true" />Add in {item.name}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
        </span>
        <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full bg-primary-soft text-primary hover:bg-primary-soft-2 hover:text-primary" aria-label="More pipeline actions" />}><Ellipsis /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={exportDeals}><Download />Export CSV</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
      </div>
    </header>

    {initialMode !== "board" && <div className="grid shrink-0 grid-cols-2 border-b bg-card sm:grid-cols-4" aria-label="Pipeline insights">
      <Insight icon={CircleDollarSign} label="Pipeline value" value={money(insights.value, currency)} />
      <Insight icon={Users} label="Open deals" value={String(insights.open)} />
      <Insight icon={TrendingUp} label="Weighted forecast" value={money(insights.forecast, currency)} />
      <Insight icon={CalendarClock} label="Overdue" value={String(insights.overdue)} urgent={insights.overdue > 0} />
    </div>}

    {selected.size > 0 && <div className="flex items-center gap-2 border-b bg-muted px-4 py-2 text-sm"><strong>{selected.size} selected</strong><Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}><Trash2 data-icon="inline-start" />Delete</Button><Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button></div>}

    {deals.length === 0 && (query || activeFilterCount > 0) ? <EmptyResults onReset={() => { setQuery(""); clearFilters() }} /> : initialMode === "board" ? <DndContext sensors={sensors} onDragEnd={(event: DragEndEvent) => { if (event.over) void moveDeal(String(event.active.id), String(event.over.id)) }}><div className="flex min-h-0 flex-1 gap-3 overflow-x-auto bg-muted/20 p-3">{snapshot.stages.map((item) => <StageColumn key={item.id} stage={item} deals={deals.filter((deal) => deal.stageId === item.id)} onOpen={setEditing} onCreate={createInStage} currency={currency} collapsed={collapsedStages.has(item.id)} onToggleCollapsed={toggleStageCollapsed} />)}</div></DndContext> : initialMode === "sheet" ? <PipelineSheet deals={deals} stages={snapshot.stages} members={snapshot.members} onSave={saveDeal} /> : <DealTable deals={deals} selected={selected} onSelected={setSelected} onOpen={setEditing} stages={snapshot.stages} />}

    {initialMode === "board" && <SubPipelineTabs pipelines={snapshot.subPipelines} activePipelineId={activeSubPipelineId} onActivate={(id) => { setActiveSubPipelineId(id); router.replace(pipelinePath(snapshot.accountId, snapshot.pipeline.id, initialMode, { subPipeline: id, savedView: initialSavedViewId })) }} onCreate={(name) => startTransition(() => void createSubPipeline(name))} onReorder={(items) => startTransition(() => void reorderSubPipelines(items))} />}
    {editing !== null && <PipelineDealEditor key={editing === "new" ? `new-${defaultStageId}` : editing.id} open deal={editing === "new" ? null : editing} defaultStageId={defaultStageId} snapshot={snapshot} pending={pending} onOpenChange={(open) => { if (!open) setEditing(null) }} onSave={saveDeal} />}
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Delete selected deals?</DialogTitle><DialogDescription>This will permanently delete {selected.size} selected deal{selected.size === 1 ? "" : "s"}. This action cannot be undone.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="destructive" onClick={() => void deleteSelected()}>Delete deals</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

function Insight({ icon: Icon, label, value, urgent }: { icon: typeof Target; label: string; value: string; urgent?: boolean }) {
  return <div className="flex min-w-0 items-center gap-3 border-r border-b px-4 py-3 sm:border-b-0"><span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground", urgent && "bg-destructive/10 text-destructive")}><Icon className="size-4" aria-hidden="true" /></span><div className="min-w-0"><p className="truncate text-xs text-muted-foreground">{label}</p><p className={cn("truncate text-sm font-semibold", urgent && "text-destructive")}>{value}</p></div></div>
}

function dealCountLabel(count: number) {
  return `${count} Deal${count > 1 ? "s" : ""}`
}

function StageColumn({ stage, deals, onOpen, onCreate, currency, collapsed, onToggleCollapsed }: { stage: PipelineStage; deals: PipelineDeal[]; onOpen: (deal: PipelineDeal) => void; onCreate: (stageId: string) => void; currency: string; collapsed: boolean; onToggleCollapsed: (stageId: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const total = money(deals.reduce((sum, deal) => sum + deal.value, 0), currency)

  if (collapsed) {
    // Minimized strip — still a drop target; the whole strip expands on click
    return <section ref={setNodeRef} aria-label={`${stage.name} stage, minimized`} className={cn("flex min-h-0 w-14 shrink-0 flex-col items-stretch overflow-hidden rounded-md border bg-muted/40 shadow-xs transition-[box-shadow,border-color,width] duration-200", isOver && "border-primary ring-2 ring-primary/20")}>
      <span className="h-1 w-full shrink-0" style={{ backgroundColor: stage.color }} aria-hidden="true" />
      <button type="button" onClick={() => onToggleCollapsed(stage.id)} aria-label={`Expand ${stage.name} stage`} className="flex min-h-0 flex-1 cursor-pointer flex-col items-center py-4 transition-colors hover:bg-muted/70">
        <span className="text-sm font-semibold [writing-mode:vertical-rl]">{stage.name}</span>
        <span className="mt-auto text-xs text-muted-foreground [writing-mode:vertical-rl]">{total} <span aria-hidden="true">·</span> {dealCountLabel(deals.length)}</span>
        <span className="mt-4 text-muted-foreground" aria-hidden="true"><Maximize2 className="size-3.5" /></span>
      </button>
    </section>
  }

  return <section ref={setNodeRef} className={cn("group/stage relative flex min-h-0 w-72 flex-1 shrink-0 flex-col overflow-hidden rounded-md border bg-muted/40 shadow-xs transition-[box-shadow,border-color] duration-200", "min-w-[16rem]", isOver && "border-primary ring-2 ring-primary/20")}>
    <header className="shrink-0 border-b bg-card">
      <span className="block h-1 w-full" style={{ backgroundColor: stage.color }} aria-hidden="true" />
      <div className="flex items-start justify-between gap-2 px-3 pb-2.5 pt-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold">{stage.name}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground"><span className="font-medium text-foreground/80">{total}</span> <span aria-hidden="true">·</span> {dealCountLabel(deals.length)}</p>
        </div>
        <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/stage:opacity-100 aria-expanded:opacity-100" aria-label={`${stage.name} stage actions`} />}><Ellipsis /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => onCreate(stage.id)}><Plus />Add deal</DropdownMenuItem><DropdownMenuItem onClick={() => onToggleCollapsed(stage.id)}><Minimize2 />Minimize stage</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
      </div>
    </header>
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
      <p className="rounded-md border border-dashed bg-card/60 px-3 py-2.5 text-sm text-muted-foreground">Add a Description for this stage</p>
      {deals.map((deal) => <DealCard key={deal.id} deal={deal} onOpen={onOpen} />)}
      {deals.length === 0 && <div className={cn("flex flex-1 items-center justify-center rounded-md p-6 text-center", isOver && "border border-dashed border-primary bg-primary/5")}><p className="text-sm text-muted-foreground">This stage is empty</p></div>}
    </div>
    <footer className="flex shrink-0 items-center justify-between border-t bg-card px-2 py-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/stage:opacity-100">
      <Button variant="ghost" size="sm" className="text-primary hover:text-primary" onClick={() => onCreate(stage.id)} aria-label={`Add deal to ${stage.name}`}><Plus data-icon="inline-start" />Deal</Button>
      <Button variant="ghost" size="icon-sm" className="rounded-md border bg-card text-muted-foreground shadow-xs" onClick={() => onToggleCollapsed(stage.id)} aria-label={`Minimize ${stage.name} stage`}><Minimize2 /></Button>
    </footer>
  </section>
}

function DealCard({ deal, onOpen }: { deal: PipelineDeal; onOpen: (deal: PipelineDeal) => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: deal.id })
  const { defaultCurrency: workspaceCurrency } = useAuth()
  const timing = dueState(deal.due)
  const dueLabel = deal.due ? new Date(`${deal.due}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null
  return <article ref={setNodeRef} {...attributes} {...listeners} onDoubleClick={() => onOpen(deal)} className={cn("pipeline-deal-card group cursor-grab rounded-md border bg-card p-3 shadow-xs transition-shadow hover:shadow-sm active:cursor-grabbing", isDragging && "opacity-40")} aria-label={`Deal ${deal.title}. Double-click to edit.`}>
    <div className="flex items-start justify-between gap-2">
      <button className="min-w-0 flex-1 truncate text-left text-sm font-bold leading-5 hover:text-primary" onClick={() => onOpen(deal)}>{deal.title}</button>
      {deal.priority !== "normal" && <span className={cn("shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground", deal.priority === "hot" && "bg-destructive/10 text-destructive")}>{deal.priority}</span>}
    </div>
    {(deal.contact?.name || deal.company) && <p className="mt-1.5 truncate text-sm text-muted-foreground">{deal.contact?.name ?? deal.company}</p>}
    <p className="mt-1.5 text-sm text-muted-foreground"><span className="font-medium tabular-nums text-foreground/80">{money(deal.value, workspaceCurrency)}</span>{dueLabel && <> <span aria-hidden="true">·</span> <span className={cn(timing?.urgent ? "font-medium text-destructive" : "text-muted-foreground")}>{dueLabel}</span></>}</p>
    <div className="mt-2 flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground"><Crown className="size-3.5 shrink-0 text-amber-500" aria-hidden="true" /><span className="truncate">{deal.owner?.name ?? "Unassigned"}</span></span>
      {timing?.urgent && <span className="shrink-0 text-destructive" title="Closing date passed"><CalendarClock className="size-4" aria-hidden="true" /><span className="sr-only">Overdue</span></span>}
    </div>
  </article>
}

function EmptyResults({ onReset }: { onReset: () => void }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center p-6"><div className="flex max-w-sm flex-col items-center gap-4 text-center"><span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Search className="size-5" /></span><div><h2 className="font-semibold">No deals match this view</h2><p className="mt-1 text-sm text-muted-foreground">Try a different search or reset your filters to see all deals.</p></div><Button variant="outline" onClick={onReset}>Reset view</Button></div></div>
}

function DealTable({ deals, selected, onSelected, onOpen, stages }: { deals: PipelineDeal[]; selected: Set<string>; onSelected: (value: Set<string>) => void; onOpen: (deal: PipelineDeal) => void; stages: PipelineSnapshot["stages"] }) {
  const { defaultCurrency: workspaceCurrency } = useAuth()
  return <div className="min-h-0 flex-1 overflow-auto"><table className="min-w-full text-sm"><thead className="sticky top-0 bg-card shadow-[0_1px_0_var(--border)]"><tr><th className="w-12 p-3"><Checkbox checked={deals.length > 0 && deals.every((deal) => selected.has(deal.id))} onCheckedChange={() => onSelected(deals.every((deal) => selected.has(deal.id)) ? new Set() : new Set(deals.map((deal) => deal.id)))} aria-label="Select all deals" /></th>{["Deal", "Contact", "Company", "Stage", "Amount", "Owner", "Closing date"].map((label) => <th key={label} className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">{label}</th>)}</tr></thead><tbody>{deals.map((deal) => <tr key={deal.id} className="border-b transition-colors hover:bg-muted/40 focus-within:bg-muted/40"><td className="p-3"><Checkbox checked={selected.has(deal.id)} onCheckedChange={() => { const next = new Set(selected); if (next.has(deal.id)) next.delete(deal.id); else next.add(deal.id); onSelected(next) }} aria-label={`Select ${deal.title}`} /></td><td className="px-3 py-3"><button className="font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(deal)}>{deal.title}</button></td><td className="px-3 py-3 text-muted-foreground">{deal.contact?.name ?? "—"}</td><td className="px-3 py-3 text-muted-foreground">{deal.company ?? "—"}</td><td className="px-3 py-3">{stages.find((item) => item.id === deal.stageId)?.name ?? "—"}</td><td className="px-3 py-3 font-medium tabular-nums">{money(deal.value, workspaceCurrency)}</td><td className="px-3 py-3 text-muted-foreground">{deal.owner?.name ?? "Unassigned"}</td><td className="px-3 py-3 text-muted-foreground">{deal.due ?? "—"}</td></tr>)}</tbody></table></div>
}
