"use client"

import { useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { ArrowDown, ArrowUp, CalendarClock, CircleDollarSign, Download, Ellipsis, Filter, GripVertical, LayoutGrid, List, Plus, Search, SlidersHorizontal, Table2, Target, Trash2, TrendingUp, Users, X } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SubPipelineTabs } from "./sub-pipeline-tabs"
import { PipelineDealEditor } from "./pipeline-deal-editor"
import { PipelineSheet } from "./pipeline-data-sheet"
import { cacheKeys } from "@/lib/cache/keys"
import { createSubPipelineAction, deleteDealsAction, moveDealAction, reorderSubPipelinesAction, saveDealAction } from "@/lib/pipelines/actions"
import type { PipelineDeal, PipelineMode, PipelineSnapshot, PipelineStage } from "@/lib/pipelines/domain"
import { formatCurrency } from "@/lib/currency"
import { useAuth } from "@/hooks/use-auth"
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
  const { data: snapshot = initialSnapshot, mutate } = useSWR<PipelineSnapshot>(cacheKeys.pipelineSnapshot(initialSnapshot.accountId, initialSnapshot.pipeline.id), null, { fallbackData: initialSnapshot, revalidateOnFocus: false })
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
      <Select items={Object.fromEntries(snapshot.pipelines.map((pipeline) => [pipeline.id, pipeline.name]))} value={snapshot.pipeline.id} onValueChange={(id) => id && router.push(pipelinePath(snapshot.accountId, id, initialMode))}><SelectTrigger className="min-w-44 sm:w-52"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{snapshot.pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}</SelectGroup></SelectContent></Select>
      <div className="relative min-w-48 flex-1 md:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9 pr-9" placeholder="Search deals" aria-label="Search deals" />{query && <Button variant="ghost" size="icon-sm" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setQuery("")} aria-label="Clear search"><X /></Button>}</div>
      <Popover><PopoverTrigger render={<Button variant={activeFilterCount ? "secondary" : "outline"} aria-label={`Filters${activeFilterCount ? `, ${activeFilterCount} active` : ""}`} />}><Filter data-icon="inline-start" />Filters{activeFilterCount > 0 && <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{activeFilterCount}</span>}</PopoverTrigger><PopoverContent align="start" className="w-80"><div className="flex flex-col gap-4"><div><p className="font-medium">Filter deals</p><p className="text-sm text-muted-foreground">Narrow this board by owner or stage.</p></div><Select items={{ all: "All owners", ...Object.fromEntries(snapshot.members.map((member) => [member.id, member.name])) }} value={owner} onValueChange={(value) => value && setOwner(value)}><SelectTrigger className="w-full"><SelectValue placeholder="Owner" /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All owners</SelectItem>{snapshot.members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectGroup></SelectContent></Select><Select items={{ all: "All stages", ...Object.fromEntries(snapshot.stages.map((item) => [item.id, item.name])) }} value={stage} onValueChange={(value) => value && setStage(value)}><SelectTrigger className="w-full"><SelectValue placeholder="Stage" /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All stages</SelectItem>{snapshot.stages.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent></Select>{presets.length > 0 && <div className="flex flex-wrap gap-2">{presets.map((preset) => <Button key={preset.name} variant="secondary" size="sm" onClick={() => { setOwner(preset.owner); setStage(preset.stage) }}>{preset.name}</Button>)}</div>}<div className="flex gap-2"><Input value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="Preset name" aria-label="Filter preset name" /><Button variant="outline" onClick={savePreset} disabled={!presetName.trim() || activeFilterCount === 0}>Save</Button></div><Button variant="ghost" onClick={clearFilters} disabled={activeFilterCount === 0}>Clear filters</Button></div></PopoverContent></Popover>
      <Tabs value={initialMode} onValueChange={(value) => changeMode(value as PipelineMode)}><TabsList><TabsTrigger value="board" aria-label="Board view"><LayoutGrid /></TabsTrigger><TabsTrigger value="list" aria-label="List view"><List /></TabsTrigger><TabsTrigger value="sheet" aria-label="Sheet view"><Table2 /></TabsTrigger></TabsList></Tabs>
      <Button onClick={() => createInStage(snapshot.stages[0]?.id ?? "")}><Plus data-icon="inline-start" />Create deal</Button>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More pipeline actions" />}><Ellipsis /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={exportDeals}><Download />Export CSV</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem onClick={() => setAscending((value) => !value)}>{ascending ? <ArrowUp /> : <ArrowDown />}Sort {ascending ? "ascending" : "descending"}</DropdownMenuItem>{(["createdAt", "value", "due"] as SortKey[]).map((key) => <DropdownMenuItem key={key} onClick={() => setSort(key)}><SlidersHorizontal />{key === "createdAt" ? "Created time" : key === "value" ? "Amount" : "Closing date"}{sort === key ? " · Active" : ""}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
    </header>

    <div className="grid shrink-0 grid-cols-2 border-b bg-card sm:grid-cols-4" aria-label="Pipeline insights">
      <Insight icon={CircleDollarSign} label="Pipeline value" value={money(insights.value, currency)} />
      <Insight icon={Users} label="Open deals" value={String(insights.open)} />
      <Insight icon={TrendingUp} label="Weighted forecast" value={money(insights.forecast, currency)} />
      <Insight icon={CalendarClock} label="Overdue" value={String(insights.overdue)} urgent={insights.overdue > 0} />
    </div>

    {selected.size > 0 && <div className="flex items-center gap-2 border-b bg-muted px-4 py-2 text-sm"><strong>{selected.size} selected</strong><Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}><Trash2 data-icon="inline-start" />Delete</Button><Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button></div>}

    {deals.length === 0 && (query || activeFilterCount > 0) ? <EmptyResults onReset={() => { setQuery(""); clearFilters() }} /> : initialMode === "board" ? <DndContext sensors={sensors} onDragEnd={(event: DragEndEvent) => { if (event.over) void moveDeal(String(event.active.id), String(event.over.id)) }}><div className="grid min-h-0 flex-1 auto-cols-[minmax(17rem,1fr)] grid-flow-col gap-3 overflow-x-auto bg-muted/20 p-3">{snapshot.stages.map((item) => <StageColumn key={item.id} stage={item} deals={deals.filter((deal) => deal.stageId === item.id)} onOpen={setEditing} onCreate={createInStage} currency={currency} />)}</div></DndContext> : initialMode === "sheet" ? <PipelineSheet deals={deals} stages={snapshot.stages} members={snapshot.members} onSave={saveDeal} /> : <DealTable deals={deals} selected={selected} onSelected={setSelected} onOpen={setEditing} stages={snapshot.stages} />}

    {initialMode === "board" && <SubPipelineTabs pipelines={snapshot.subPipelines} activePipelineId={activeSubPipelineId} onActivate={(id) => { setActiveSubPipelineId(id); router.replace(pipelinePath(snapshot.accountId, snapshot.pipeline.id, initialMode, { subPipeline: id, savedView: initialSavedViewId })) }} onCreate={(name) => startTransition(() => void createSubPipeline(name))} onReorder={(items) => startTransition(() => void reorderSubPipelines(items))} />}
    {editing !== null && <PipelineDealEditor key={editing === "new" ? `new-${defaultStageId}` : editing.id} open deal={editing === "new" ? null : editing} defaultStageId={defaultStageId} snapshot={snapshot} pending={pending} onOpenChange={(open) => { if (!open) setEditing(null) }} onSave={saveDeal} />}
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Delete selected deals?</DialogTitle><DialogDescription>This will permanently delete {selected.size} selected deal{selected.size === 1 ? "" : "s"}. This action cannot be undone.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="destructive" onClick={() => void deleteSelected()}>Delete deals</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

function Insight({ icon: Icon, label, value, urgent }: { icon: typeof Target; label: string; value: string; urgent?: boolean }) {
  return <div className="flex min-w-0 items-center gap-3 border-r border-b px-4 py-3 sm:border-b-0"><span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground", urgent && "bg-destructive/10 text-destructive")}><Icon className="size-4" aria-hidden="true" /></span><div className="min-w-0"><p className="truncate text-xs text-muted-foreground">{label}</p><p className={cn("truncate text-sm font-semibold", urgent && "text-destructive")}>{value}</p></div></div>
}

function StageColumn({ stage, deals, onOpen, onCreate, currency }: { stage: PipelineStage; deals: PipelineDeal[]; onOpen: (deal: PipelineDeal) => void; onCreate: (stageId: string) => void; currency: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  return <section ref={setNodeRef} className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs transition-[box-shadow,border-color] duration-200", isOver && "border-primary ring-2 ring-primary/20")}>
    <header className="flex items-start justify-between gap-3 border-b p-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden="true" /><h2 className="truncate text-sm font-semibold">{stage.name}</h2><span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{deals.length}</span></div><p className="mt-1 text-xs text-muted-foreground">{money(deals.reduce((sum, deal) => sum + deal.value, 0), currency)}</p></div><Button variant="ghost" size="icon-sm" onClick={() => onCreate(stage.id)} aria-label={`Add deal to ${stage.name}`}><Plus /></Button></header>
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">{deals.map((deal) => <DealCard key={deal.id} deal={deal} onOpen={onOpen} />)}{deals.length === 0 && <div className={cn("m-auto flex w-full flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center", isOver && "border-primary bg-primary/5")}><span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground"><Target className="size-4" /></span><div><p className="text-sm font-medium">No deals yet</p><p className="mt-1 text-xs text-muted-foreground">Add a deal or drop one here.</p></div><Button variant="outline" size="sm" onClick={() => onCreate(stage.id)}><Plus data-icon="inline-start" />Add deal</Button></div>}</div>
  </section>
}

function DealCard({ deal, onOpen }: { deal: PipelineDeal; onOpen: (deal: PipelineDeal) => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: deal.id })
  const { defaultCurrency: workspaceCurrency } = useAuth()
  const timing = dueState(deal.due)
  return <article ref={setNodeRef} onDoubleClick={() => onOpen(deal)} className={cn("pipeline-deal-card group rounded-lg border bg-background p-3 shadow-xs", isDragging && "opacity-40")} aria-label={`Deal ${deal.title}. Double-click to edit.`}><div className="flex items-start gap-2"><button {...attributes} {...listeners} aria-label={`Drag ${deal.title}`} className="mt-0.5 cursor-grab text-muted-foreground opacity-60 transition-opacity hover:opacity-100 active:cursor-grabbing"><GripVertical className="size-4" /></button><button className="min-w-0 flex-1 text-left text-sm font-semibold leading-5 hover:text-primary" onClick={() => onOpen(deal)}>{deal.title}</button>{deal.priority !== "normal" && <span className={cn("rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground", deal.priority === "hot" && "bg-destructive/10 text-destructive")}>{deal.priority}</span>}</div><p className="mt-3 text-base font-semibold tabular-nums">{money(deal.value, workspaceCurrency)}</p>{(deal.contact?.name || deal.company) && <p className="mt-1 truncate text-xs text-muted-foreground">{deal.contact?.name ?? deal.company}{deal.contact?.name && deal.company ? ` · ${deal.company}` : ""}</p>}<div className="mt-3 flex items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><Avatar className="size-6"><AvatarFallback>{deal.owner?.name.slice(0, 2).toUpperCase() ?? "--"}</AvatarFallback></Avatar><span className="truncate text-xs text-muted-foreground">{deal.owner?.name ?? "Unassigned"}</span></div>{timing && <span className={cn("flex shrink-0 items-center gap-1 text-xs text-muted-foreground", timing.urgent && "font-medium text-destructive")}><CalendarClock className="size-3.5" />{timing.label}</span>}</div></article>
}

function EmptyResults({ onReset }: { onReset: () => void }) {
  return <div className="flex min-h-0 flex-1 items-center justify-center p-6"><div className="flex max-w-sm flex-col items-center gap-4 text-center"><span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"><Search className="size-5" /></span><div><h2 className="font-semibold">No deals match this view</h2><p className="mt-1 text-sm text-muted-foreground">Try a different search or reset your filters to see all deals.</p></div><Button variant="outline" onClick={onReset}>Reset view</Button></div></div>
}

function DealTable({ deals, selected, onSelected, onOpen, stages }: { deals: PipelineDeal[]; selected: Set<string>; onSelected: (value: Set<string>) => void; onOpen: (deal: PipelineDeal) => void; stages: PipelineSnapshot["stages"] }) {
  const { defaultCurrency: workspaceCurrency } = useAuth()
  return <div className="min-h-0 flex-1 overflow-auto"><table className="min-w-full text-sm"><thead className="sticky top-0 bg-card shadow-[0_1px_0_var(--border)]"><tr><th className="w-12 p-3"><Checkbox checked={deals.length > 0 && deals.every((deal) => selected.has(deal.id))} onCheckedChange={() => onSelected(deals.every((deal) => selected.has(deal.id)) ? new Set() : new Set(deals.map((deal) => deal.id)))} aria-label="Select all deals" /></th>{["Deal", "Contact", "Company", "Stage", "Amount", "Owner", "Closing date"].map((label) => <th key={label} className="px-3 py-3 text-left text-xs font-medium text-muted-foreground">{label}</th>)}</tr></thead><tbody>{deals.map((deal) => <tr key={deal.id} className="border-b transition-colors hover:bg-muted/40 focus-within:bg-muted/40"><td className="p-3"><Checkbox checked={selected.has(deal.id)} onCheckedChange={() => { const next = new Set(selected); if (next.has(deal.id)) next.delete(deal.id); else next.add(deal.id); onSelected(next) }} aria-label={`Select ${deal.title}`} /></td><td className="px-3 py-3"><button className="font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(deal)}>{deal.title}</button></td><td className="px-3 py-3 text-muted-foreground">{deal.contact?.name ?? "—"}</td><td className="px-3 py-3 text-muted-foreground">{deal.company ?? "—"}</td><td className="px-3 py-3">{stages.find((item) => item.id === deal.stageId)?.name ?? "—"}</td><td className="px-3 py-3 font-medium tabular-nums">{money(deal.value, workspaceCurrency)}</td><td className="px-3 py-3 text-muted-foreground">{deal.owner?.name ?? "Unassigned"}</td><td className="px-3 py-3 text-muted-foreground">{deal.due ?? "—"}</td></tr>)}</tbody></table></div>
}
