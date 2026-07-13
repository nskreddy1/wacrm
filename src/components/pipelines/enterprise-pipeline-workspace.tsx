"use client"

import { useMemo, useState } from "react"
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core"
import { toast } from "sonner"
import { ArrowDown, ArrowUp, BriefcaseBusiness, Building2, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign, Columns3, Download, Ellipsis, Filter, Flame, Gauge, GripVertical, LayoutGrid, List, Plus, Search, SlidersHorizontal, Sparkles, Table2, Star, Target, Trash2, UserRound, X, type LucideIcon } from "lucide-react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { PipelineSheet, type SheetField } from "@/components/pipelines/pipeline-sheet"
import { SubPipelineTabs, type SubPipeline } from "@/components/pipelines/sub-pipeline-tabs"
import { demoDeals, demoStages, type DemoDeal, type DemoStage } from "@/lib/demo/crm-data"
import { downloadCsv } from "@/lib/download-csv"
import { cn } from "@/lib/utils"

type ViewMode = "board" | "list" | "sheet"
type DealField = SheetField
type SavedView = { id: string; name: string; favorite?: boolean; filter: "all" | "mine" | "closing" | "hot" | "recent" }

const fields: { id: DealField; label: string }[] = [
  { id: "title", label: "Deal name" }, { id: "value", label: "Amount" }, { id: "stageId", label: "Stage" },
  { id: "due", label: "Closing date" }, { id: "company", label: "Company name" }, { id: "contact", label: "Contact name" },
  { id: "owner", label: "Deal owner" }, { id: "priority", label: "Priority" }, { id: "probability", label: "Probability" },
  { id: "createdAt", label: "Created time" }, { id: "source", label: "Lead source" }, { id: "activity", label: "Last activity" },
]
const fieldIcons: Partial<Record<DealField, LucideIcon>> = {
  contact: UserRound,
  value: CircleDollarSign,
  due: CalendarClock,
  owner: BriefcaseBusiness,
  company: Building2,
  probability: Gauge,
  source: Sparkles,
  activity: Target,
  priority: Flame,
}

const initialViews: SavedView[] = [
  { id: "all", name: "All deals", favorite: true, filter: "all" }, { id: "mine", name: "My deals", favorite: true, filter: "mine" },
  { id: "closing", name: "Closing this month", filter: "closing" }, { id: "hot", name: "High priority deals", filter: "hot" },
  { id: "recent", name: "Recently created deals", filter: "recent" },
]
const stageTone: Record<DemoStage["color"], string> = { blue: "bg-chart-1", cyan: "bg-chart-2", amber: "bg-chart-3", green: "bg-primary", red: "bg-destructive" }
const emptyDeal: DemoDeal = { id: "", title: "", contact: "", company: "", value: 0, stageId: "qualification", owner: "Sam Silva", due: "2026-07-31", activity: "No activity", priority: "Normal", probability: 20, createdAt: "2026-07-12", source: "Website", nextStep: "", description: "" }

function displayValue(deal: DemoDeal, field: DealField) {
  if (field === "value") return `$${deal.value.toLocaleString()}`
  if (field === "probability") return `${deal.probability}%`
  if (field === "stageId") return demoStages.find((stage) => stage.id === deal.stageId)?.name ?? deal.stageId
  if (field === "due" || field === "createdAt") return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${deal[field]}T12:00:00`))
  return String(deal[field])
}

export function EnterprisePipelineWorkspace({ initialDeals = demoDeals }: { initialDeals?: DemoDeal[] }) {
  const [deals, setDeals] = useState(initialDeals)
  const [subPipelines, setSubPipelines] = useState<SubPipeline[]>([
    { id: "sales-standard", name: "Sales Pipeline Standard", dealIds: initialDeals.map((deal) => deal.id) },
  ])
  const [activeSubPipelineId, setActiveSubPipelineId] = useState("sales-standard")
  const [view, setView] = useState<ViewMode>("board")
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<{ field: DealField; direction: "asc" | "desc" }>({ field: "createdAt", direction: "desc" })
  const [visibleFields, setVisibleFields] = useState<DealField[]>(["title", "value", "stageId", "due", "company", "contact", "owner"])
  const [cardFields, setCardFields] = useState<DealField[]>(["contact", "value", "due", "owner", "company", "priority"])
  const [views, setViews] = useState(initialViews)
  const [activeViewId, setActiveViewId] = useState("all")
  const [viewSearch, setViewSearch] = useState("")
  const [ownerFilter, setOwnerFilter] = useState("all")
  const [stageFilter, setStageFilter] = useState("all")
  const [editing, setEditing] = useState<DemoDeal | null>(null)
  const [draft, setDraft] = useState<DemoDeal>(emptyDeal)
  const [createViewOpen, setCreateViewOpen] = useState(false)
  const [newViewName, setNewViewName] = useState("")
  const [activeDrag, setActiveDrag] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor))
  const activeView = views.find((item) => item.id === activeViewId) ?? views[0]
  const activeSubPipeline = subPipelines.find((item) => item.id === activeSubPipelineId) ?? subPipelines[0]

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    const today = new Date("2026-07-12T12:00:00")
    const activeDealIds = new Set(activeSubPipeline.dealIds)
    const result = deals.filter((deal) => {
      if (!activeDealIds.has(deal.id)) return false
      const searchable = `${deal.title} ${deal.contact} ${deal.company} ${deal.owner} ${deal.source}`.toLowerCase()
      const viewMatch = activeView.filter === "all" || (activeView.filter === "mine" && deal.owner === "Sam Silva") || (activeView.filter === "closing" && deal.due.startsWith("2026-07")) || (activeView.filter === "hot" && deal.priority === "Hot") || (activeView.filter === "recent" && new Date(`${deal.createdAt}T12:00:00`) >= new Date(today.getTime() - 7 * 86400000))
      return (!term || searchable.includes(term)) && viewMatch && (ownerFilter === "all" || deal.owner === ownerFilter) && (stageFilter === "all" || deal.stageId === stageFilter)
    })
    return result.sort((a, b) => String(a[sort.field]).localeCompare(String(b[sort.field]), undefined, { numeric: true }) * (sort.direction === "asc" ? 1 : -1))
  }, [activeSubPipeline.dealIds, activeView.filter, deals, ownerFilter, query, sort, stageFilter])
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize)
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const pipelineValue = filtered.reduce((sum, deal) => sum + deal.value, 0)
  const openDeals = filtered.filter((deal) => !["won", "lost"].includes(deal.stageId)).length

  function toggleField(field: DealField, target: "list" | "card") {
    const state = target === "list" ? visibleFields : cardFields
    const setter = target === "list" ? setVisibleFields : setCardFields
    if (field === "title" && target === "list") return
    setter(state.includes(field) ? state.filter((item) => item !== field) : [...state, field])
  }
  function openDeal(deal?: DemoDeal, stageId?: string) { const next = deal ?? { ...emptyDeal, id: `d${Date.now()}`, stageId: stageId ?? "qualification" }; setDraft(next); setEditing(next) }
  function saveDeal() { if (!draft.title.trim()) return toast.error("Deal name is required"); setDeals((current) => current.some((item) => item.id === draft.id) ? current.map((item) => item.id === draft.id ? draft : item) : [draft, ...current]); setSubPipelines((current) => current.map((pipeline) => pipeline.id === activeSubPipelineId && !pipeline.dealIds.includes(draft.id) ? { ...pipeline, dealIds: [...pipeline.dealIds, draft.id] } : pipeline)); setEditing(null); toast.success("Deal saved") }
  function deleteSelected() { setDeals((current) => current.filter((deal) => !selected.has(deal.id))); setSelected(new Set()); toast.success("Selected deals deleted") }
  function exportCsv() { const rows = [visibleFields.map((field) => fields.find((item) => item.id === field)?.label ?? field), ...filtered.map((deal) => visibleFields.map((field) => displayValue(deal, field)))]; if (!downloadCsv("pipeline-deals.csv", rows)) return toast.error("No deals to export"); toast.success(`${filtered.length} deals exported`) }
  function dragEnd(event: DragEndEvent) { setActiveDrag(null); if (!event.over) return; const dealId = String(event.active.id); const overId = String(event.over.id); const target = demoStages.some((stage) => stage.id === overId) ? overId : deals.find((deal) => deal.id === overId)?.stageId; if (target) setDeals((current) => current.map((deal) => deal.id === dealId ? { ...deal, stageId: target, probability: demoStages.findIndex((stage) => stage.id === target) * 20 } : deal)) }
  function cycleSort(field: DealField) { setSort((current) => current.field !== field ? { field, direction: "asc" } : { field, direction: current.direction === "asc" ? "desc" : "asc" }) }

  return <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col overflow-hidden bg-background">
    <header className="flex min-h-14 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
      <Popover><PopoverTrigger render={<Button variant={(ownerFilter !== "all" || stageFilter !== "all") ? "secondary" : "ghost"} size="icon" className="rounded-full" aria-label="Filter deals" />}><Filter />{(ownerFilter !== "all" || stageFilter !== "all") && <span className="sr-only">Filters active</span>}</PopoverTrigger><PopoverContent align="start" className="w-72"><div className="flex flex-col gap-3"><div><p className="font-medium">Filter deals</p><p className="text-xs text-muted-foreground">Narrow every pipeline view.</p></div><Select value={ownerFilter} onValueChange={(value) => value && setOwnerFilter(value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All owners</SelectItem>{["Sam Silva", "Nora James", "Ravi Patel"].map((owner) => <SelectItem key={owner} value={owner}>{owner}</SelectItem>)}</SelectGroup></SelectContent></Select><Select value={stageFilter} onValueChange={(value) => value && setStageFilter(value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All stages</SelectItem>{demoStages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectGroup></SelectContent></Select><Button variant="outline" size="sm" onClick={() => { setOwnerFilter("all"); setStageFilter("all") }}>Clear filters</Button></div></PopoverContent></Popover>
      <Popover><PopoverTrigger render={<Button variant="outline" size="sm" className="min-w-32 justify-between rounded-full" />}>{activeView.name === "All deals" ? "All Deals" : activeView.name}<ChevronDown data-icon="inline-end" /></PopoverTrigger><PopoverContent align="start" className="w-80 p-0"><div className="p-3"><div className="flex items-center gap-2 border-b"><span className="border-b-2 border-primary px-2 pb-2 text-sm font-medium">All views</span><span className="px-2 pb-2 text-sm text-muted-foreground">Favorites</span></div><div className="relative mt-3"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={viewSearch} onChange={(event) => setViewSearch(event.target.value)} placeholder="Search views" className="pl-8" /></div></div><Separator /><ScrollArea className="h-64"><div className="flex flex-col gap-1 p-2"><p className="px-2 py-1 text-xs font-semibold text-muted-foreground">PUBLIC VIEWS</p>{views.filter((item) => item.name.toLowerCase().includes(viewSearch.toLowerCase())).map((item) => <button key={item.id} onClick={() => setActiveViewId(item.id)} className={cn("flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted", item.id === activeViewId && "bg-primary/10 text-primary")}><span className="flex-1">{item.name}</span>{item.favorite && <Star className="size-3.5 fill-current" />}{item.id === activeViewId && <Check className="size-4" />}</button>)}</div></ScrollArea><Separator /><div className="p-2"><Button variant="ghost" className="w-full justify-start" onClick={() => setCreateViewOpen(true)}><Plus data-icon="inline-start" /> Create view</Button></div></PopoverContent></Popover>
      <div className="relative min-w-40 flex-1 md:max-w-xs"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} placeholder="Search deals" className="h-9 rounded-full pl-8" /></div>
      <span className="hidden text-sm lg:inline">Sort By</span>
      <Select value={sort.field} onValueChange={(value) => value && setSort((current) => ({ ...current, field: value as DealField }))}><SelectTrigger size="sm" className="min-w-36 rounded-full"><span>{fields.find((field) => field.id === sort.field)?.label ?? "Created time"}</span></SelectTrigger><SelectContent align="end"><SelectGroup>{fields.map((field) => <SelectItem key={field.id} value={field.id}>{field.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
      <Button variant="outline" size="icon-sm" className="rounded-full" onClick={() => setSort((current) => ({ ...current, direction: current.direction === "asc" ? "desc" : "asc" }))} aria-label={`Sort ${sort.direction === "asc" ? "descending" : "ascending"}`}>{sort.direction === "asc" ? <ArrowUp /> : <ArrowDown />}</Button>
      <div className="flex items-center rounded-full bg-muted p-1"><FieldPicker label={view === "board" ? "Card fields" : view === "sheet" ? "Sheet columns" : "List columns"} selected={view === "board" ? cardFields : visibleFields} onToggle={(field) => toggleField(field, view === "board" ? "card" : "list")} icon={view === "board" ? "sliders" : "columns"} /><Tabs value={view} onValueChange={(value) => setView(value as ViewMode)}><TabsList className="bg-transparent"><TabsTrigger value="board" aria-label="Board view"><LayoutGrid /></TabsTrigger><TabsTrigger value="list" aria-label="List view"><List /></TabsTrigger><TabsTrigger value="sheet" aria-label="Sheet view"><Table2 /></TabsTrigger></TabsList></Tabs></div>
      <div className="flex overflow-hidden rounded-full bg-primary text-primary-foreground"><Button size="sm" className="rounded-none border-r border-primary-foreground/20" onClick={() => openDeal()}><Plus data-icon="inline-start" /> Deal</Button><DropdownMenu><DropdownMenuTrigger render={<Button size="icon-sm" className="rounded-none" aria-label="Deal creation options" />}><ChevronDown /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>{demoStages.map((stage) => <DropdownMenuItem key={stage.id} onClick={() => openDeal(undefined, stage.id)}>Add in {stage.name}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu></div>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="More pipeline actions" />}><Ellipsis /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={exportCsv}><Download /> Export CSV</DropdownMenuItem><DropdownMenuItem onClick={() => setCreateViewOpen(true)}><Star /> Save current view</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
    </header>

    <div className="flex flex-wrap items-center gap-4 border-b bg-muted/30 px-4 py-2 text-xs"><span><strong>{filtered.length}</strong> total deals</span><span><strong>{openDeals}</strong> open</span><span><strong>${pipelineValue.toLocaleString()}</strong> pipeline value</span><span><strong>{filtered.filter((deal) => deal.priority === "Hot").length}</strong> high priority</span>{(ownerFilter !== "all" || stageFilter !== "all") && <Button variant="ghost" size="sm" onClick={() => { setOwnerFilter("all"); setStageFilter("all") }}><X data-icon="inline-start" /> Clear filters</Button>}</div>
    {selected.size > 0 && <div className="flex items-center gap-2 border-b bg-muted px-3 py-2 text-sm"><strong>{selected.size} selected</strong><Button variant="destructive" size="sm" onClick={deleteSelected}><Trash2 data-icon="inline-start" /> Delete</Button><Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button></div>}

    {view === "board" ? <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={(event: DragStartEvent) => setActiveDrag(String(event.active.id))} onDragEnd={dragEnd} onDragCancel={() => setActiveDrag(null)}><div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-muted/20 p-2"><div className="grid h-full min-h-0 min-w-max auto-cols-[18rem] grid-flow-col gap-2">{demoStages.map((stage) => <StageColumn key={stage.id} stage={stage} deals={filtered.filter((deal) => deal.stageId === stage.id)} cardFields={cardFields} onOpen={openDeal} />)}</div></div><DragOverlay>{activeDrag && <DealCard deal={deals.find((deal) => deal.id === activeDrag)!} fields={cardFields} onOpen={() => {}} overlay />}</DragOverlay></DndContext> : view === "sheet" ? <PipelineSheet deals={pageRows} fields={visibleFields} onCommit={async (nextDeal) => { setDeals((current) => current.map((deal) => deal.id === nextDeal.id ? nextDeal : deal)); toast.success("Cell saved") }} /> : <DealList deals={pageRows} fields={visibleFields} selected={selected} sort={sort} onSort={cycleSort} onSelect={setSelected} onOpen={openDeal} />}

    {view === "board" ? <SubPipelineTabs pipelines={subPipelines} activePipelineId={activeSubPipelineId} onActivate={(id) => { setActiveSubPipelineId(id); setSelected(new Set()); setPage(0) }} onCreate={(name) => { const id = `pipeline-${Date.now()}`; setSubPipelines((current) => [...current, { id, name, dealIds: [] }]); setActiveSubPipelineId(id); setSelected(new Set()); toast.success("Sub-pipeline created") }} onReorder={(pipelines) => { setSubPipelines(pipelines); toast.success("Sub-pipeline order saved") }} /> : <footer className="flex flex-wrap items-center gap-4 border-t bg-card px-4 py-2 text-xs"><span>Total deals <strong>{filtered.length}</strong></span><span>Open deals <strong>{openDeals}</strong></span><span>Won <strong>{filtered.filter((deal) => deal.stageId === "won").length}</strong></span><span className="ml-auto">Rows</span><Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(0) }}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{[10,20,50].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectGroup></SelectContent></Select><span>{filtered.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}</span><Button variant="ghost" size="icon-sm" disabled={page === 0} onClick={() => setPage((value) => value - 1)} aria-label="Previous page"><ChevronLeft /></Button><Button variant="ghost" size="icon-sm" disabled={page >= totalPages - 1} onClick={() => setPage((value) => value + 1)} aria-label="Next page"><ChevronRight /></Button></footer>}

    <DealSheet open={Boolean(editing)} draft={draft} onDraft={setDraft} onOpenChange={(open) => !open && setEditing(null)} onSave={saveDeal} />
    <CreateViewDialog open={createViewOpen} name={newViewName} owner={ownerFilter} stage={stageFilter} view={view} sort={sort} displayedFields={view === "board" ? cardFields : visibleFields} onName={setNewViewName} onOwner={setOwnerFilter} onStage={setStageFilter} onView={setView} onOpenChange={setCreateViewOpen} onSave={() => { if (!newViewName.trim()) return toast.error("View name is required"); const next = { id: `view-${Date.now()}`, name: newViewName.trim(), favorite: false, filter: "all" as const }; setViews((current) => [...current, next]); setActiveViewId(next.id); setNewViewName(""); setCreateViewOpen(false); setPage(0); toast.success("View created and applied") }} />
  </div>
}

function CreateViewDialog({ open, name, owner, stage, view, sort, displayedFields, onName, onOwner, onStage, onView, onOpenChange, onSave }: { open: boolean; name: string; owner: string; stage: string; view: ViewMode; sort: { field: DealField; direction: "asc" | "desc" }; displayedFields: DealField[]; onName: (value: string) => void; onOwner: (value: string) => void; onStage: (value: string) => void; onView: (value: ViewMode) => void; onOpenChange: (value: boolean) => void; onSave: () => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Create saved view</DialogTitle><DialogDescription>Save a focused deal workspace for yourself or your sales team.</DialogDescription></DialogHeader><div className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto pr-1"><div className="flex flex-col gap-2"><Label htmlFor="view-name">View name</Label><Input id="view-name" value={name} onChange={(event) => onName(event.target.value)} placeholder="Enterprise renewals" /></div><div className="flex flex-col gap-2"><Label>Criteria</Label><div className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2"><Select value={owner} onValueChange={(value) => value && onOwner(value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">Any deal owner</SelectItem>{["Sam Silva", "Nora James", "Ravi Patel"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectGroup></SelectContent></Select><Select value={stage} onValueChange={(value) => value && onStage(value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">Any stage</SelectItem>{demoStages.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent></Select></div></div><div className="flex flex-col gap-2"><Label>Default workspace</Label><Tabs value={view} onValueChange={(value) => onView(value as ViewMode)}><TabsList><TabsTrigger value="board"><LayoutGrid /> Board</TabsTrigger><TabsTrigger value="list"><List /> List</TabsTrigger><TabsTrigger value="sheet"><Table2 /> Sheet</TabsTrigger></TabsList></Tabs></div><div className="grid gap-3 rounded-lg border p-3 text-sm sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Sort</p><p className="font-medium">{fields.find((item) => item.id === sort.field)?.label} · {sort.direction === "asc" ? "ascending" : "descending"}</p></div><div><p className="text-xs text-muted-foreground">Displayed fields</p><p className="font-medium">{displayedFields.length} selected</p></div></div><fieldset className="flex flex-col gap-2"><legend className="text-sm font-medium">Who can access this?</legend><div className="flex flex-wrap gap-4"><label className="flex items-center gap-2"><input type="radio" name="view-access" defaultChecked /> Only me</label><label className="flex items-center gap-2"><input type="radio" name="view-access" /> All users</label><label className="flex items-center gap-2"><input type="radio" name="view-access" /> Selected users</label></div></fieldset></div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={onSave}>Save view</Button></DialogFooter></DialogContent></Dialog>
}

function FieldPicker({ label, selected, onToggle, icon }: { label: string; selected: DealField[]; onToggle: (field: DealField) => void; icon: "columns" | "sliders" }) {
  const [search, setSearch] = useState("")
  return <Popover><PopoverTrigger render={<Button variant="outline" size="icon-sm" aria-label={label} />}>{icon === "columns" ? <Columns3 /> : <SlidersHorizontal />}</PopoverTrigger><PopoverContent align="end" className="w-72 p-0"><div className="p-3"><p className="font-medium">{label}</p><p className="text-xs text-muted-foreground">Choose fields displayed in this view</p><div className="relative mt-3"><Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search fields" className="pl-8" /></div></div><Separator /><ScrollArea className="h-72"><div className="flex flex-col gap-1 p-2">{fields.filter((field) => field.label.toLowerCase().includes(search.toLowerCase())).map((field) => <label key={field.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"><Checkbox checked={selected.includes(field.id)} onCheckedChange={() => onToggle(field.id)} /><span className="text-sm">{field.label}</span></label>)}</div></ScrollArea></PopoverContent></Popover>
}

function StageColumn({ stage, deals, cardFields, onOpen }: { stage: DemoStage; deals: DemoDeal[]; cardFields: DealField[]; onOpen: (deal?: DemoDeal, stageId?: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })

  return <section ref={setNodeRef} className={cn("flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md bg-muted/40 transition-colors", isOver && "bg-primary/5 ring-1 ring-primary")}>
    <header className="shrink-0 rounded-md border bg-card shadow-xs">
      <div className={cn("h-1 rounded-t-md", stageTone[stage.color])} />
      <div className="flex items-start justify-between gap-1 px-2 py-1.5">
        <div className="min-w-0"><h2 className="truncate text-sm font-semibold" title={stage.name}>{stage.name}</h2><p className="truncate text-xs text-muted-foreground">${deals.reduce((sum, deal) => sum + deal.value, 0).toLocaleString()} <span aria-hidden="true">·</span> {deals.length} {deals.length === 1 ? "Deal" : "Deals"}</p></div>
        <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`${stage.name} options`} />}><Ellipsis /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => onOpen(undefined, stage.id)}><Plus /> Add deal</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
      </div>
    </header>
    <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden border-x bg-card/30">
      {deals.length === 0 && <button className="m-1.5 shrink-0 rounded-sm border border-dashed bg-card px-2 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted" onClick={() => onOpen(undefined, stage.id)}>{stage.description}</button>}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1.5">
        {deals.map((deal) => <DraggableDeal key={deal.id} deal={deal} fields={cardFields} onOpen={onOpen} />)}
      </div>
      {deals.length === 0 && <div className="flex min-h-0 flex-1 items-center justify-center px-2 text-center text-xs text-muted-foreground">This stage is empty</div>}
      <Button variant="ghost" size="sm" className="mt-auto w-full shrink-0 justify-start rounded-none border-t bg-card" onClick={() => onOpen(undefined, stage.id)}><Plus data-icon="inline-start" /> Deal</Button>
    </div>
  </section>
}
function DraggableDeal({ deal, fields, onOpen }: { deal: DemoDeal; fields: DealField[]; onOpen: (deal: DemoDeal) => void }) { const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: deal.id }); return <div ref={setNodeRef} className={cn(isDragging && "opacity-30")}><DealCard deal={deal} fields={fields} onOpen={onOpen} dragProps={{ ...attributes, ...listeners }} /></div> }
function DealCard({ deal, fields: shownFields, onOpen, dragProps, overlay }: { deal: DemoDeal; fields: DealField[]; onOpen: (deal: DemoDeal) => void; dragProps?: Record<string, unknown>; overlay?: boolean }) {
  const metadata = shownFields.filter((field) => !["title", "priority", "stageId"].includes(field)).slice(0, 4)

  return <article className={cn("min-w-0 rounded-md border bg-card p-2 shadow-xs transition-shadow hover:shadow-sm", overlay && "w-64 shadow-lg")}>
    <div className="flex items-start gap-1"><button aria-label={`Drag ${deal.title}`} className="shrink-0 cursor-grab text-muted-foreground" {...dragProps}><GripVertical className="size-4" /></button><button className="min-w-0 flex-1 truncate text-left text-xs font-semibold hover:text-primary" onClick={() => onOpen(deal)} title={deal.title}>{deal.title}</button>{deal.priority === "Hot" && <Flame className="size-3.5 shrink-0 text-destructive" aria-label="High priority" />}</div>
    <div className="mt-1.5 grid min-w-0 gap-1">{metadata.map((field) => {
      const Icon = fieldIcons[field] ?? Target
      const label = fields.find((item) => item.id === field)?.label ?? field
      return <div key={field} className="flex min-w-0 items-center gap-1.5 text-[11px]" title={`${label}: ${displayValue(deal, field)}`}><Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="sr-only">{label}: </span><span className="truncate font-medium">{displayValue(deal, field)}</span></div>
    })}</div>
  </article>
}

function DealList({ deals, fields: shownFields, selected, sort, onSort, onSelect, onOpen }: { deals: DemoDeal[]; fields: DealField[]; selected: Set<string>; sort: { field: DealField; direction: "asc" | "desc" }; onSort: (field: DealField) => void; onSelect: (value: Set<string>) => void; onOpen: (deal: DemoDeal) => void }) {
  const all = deals.length > 0 && deals.every((deal) => selected.has(deal.id))
  return <div className="min-h-0 flex-1 overflow-auto"><table className="min-w-full border-separate border-spacing-0 text-sm"><thead className="sticky top-0 z-10 bg-card"><tr><th className="w-12 border-b border-r p-3"><Checkbox checked={all} onCheckedChange={() => onSelect(all ? new Set() : new Set(deals.map((deal) => deal.id)))} aria-label="Select all visible deals" /></th>{shownFields.map((field) => <th key={field} className="min-w-40 border-b border-r px-3 py-2 text-left font-medium"><button className="flex w-full items-center gap-2" onClick={() => onSort(field)}>{fields.find((item) => item.id === field)?.label}{sort.field === field && (sort.direction === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}</button></th>)}<th className="w-12 border-b p-2" /></tr></thead><tbody>{deals.map((deal) => <tr key={deal.id} className={cn("group hover:bg-muted/40", selected.has(deal.id) && "bg-muted/60")}><td className="border-b border-r p-3"><Checkbox checked={selected.has(deal.id)} onCheckedChange={() => { const next = new Set(selected); if (next.has(deal.id)) next.delete(deal.id); else next.add(deal.id); onSelect(next) }} aria-label={`Select ${deal.title}`} /></td>{shownFields.map((field) => <td key={field} className="border-b border-r px-3 py-2">{field === "title" ? <button className="font-semibold hover:text-primary" onClick={() => onOpen(deal)}>{deal.title}</button> : field === "stageId" ? <div className="flex items-center gap-2"><span className="h-1.5 w-10 rounded-full bg-primary/40"><span className="block h-full rounded-full bg-primary" style={{ width: `${deal.probability}%` }} /></span>{displayValue(deal, field)}</div> : field === "owner" ? <div className="flex items-center gap-2"><Avatar className="size-6"><AvatarFallback>{deal.owner.split(" ").map((part) => part[0]).join("")}</AvatarFallback></Avatar>{deal.owner}</div> : displayValue(deal, field)}</td>)}<td className="border-b p-2"><Button variant="ghost" size="icon-sm" onClick={() => onOpen(deal)} aria-label={`Edit ${deal.title}`}><Ellipsis /></Button></td></tr>)}</tbody></table>{deals.length === 0 && <div className="flex min-h-80 items-center justify-center text-sm text-muted-foreground">No deals match this view.</div>}</div>
}

function DealSheet({ open, draft, onDraft, onOpenChange, onSave }: { open: boolean; draft: DemoDeal; onDraft: (deal: DemoDeal) => void; onOpenChange: (open: boolean) => void; onSave: () => void }) {
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="sm:max-w-xl"><SheetHeader><SheetTitle>{draft.title || "Create deal"}</SheetTitle><SheetDescription>Manage the complete opportunity record, next action, and sales context.</SheetDescription></SheetHeader><ScrollArea className="h-[calc(100vh-10rem)]"><div className="flex flex-col gap-5 px-4 py-2"><div className="grid gap-4 sm:grid-cols-2"><Field label="Deal name" wide><Input value={draft.title} onChange={(event) => onDraft({ ...draft, title: event.target.value })} /></Field><Field label="Amount"><Input type="number" value={draft.value} onChange={(event) => onDraft({ ...draft, value: Number(event.target.value) })} /></Field><Field label="Stage"><Select value={draft.stageId} onValueChange={(value) => value && onDraft({ ...draft, stageId: value })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{demoStages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field label="Closing date"><Input type="date" value={draft.due} onChange={(event) => onDraft({ ...draft, due: event.target.value })} /></Field><Field label="Company"><Input value={draft.company} onChange={(event) => onDraft({ ...draft, company: event.target.value })} /></Field><Field label="Contact"><Input value={draft.contact} onChange={(event) => onDraft({ ...draft, contact: event.target.value })} /></Field><Field label="Owner"><Select value={draft.owner} onValueChange={(value) => value && onDraft({ ...draft, owner: value })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["Sam Silva", "Nora James", "Ravi Patel"].map((owner) => <SelectItem key={owner} value={owner}>{owner}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field label="Priority"><Select value={draft.priority} onValueChange={(value) => onDraft({ ...draft, priority: value as DemoDeal["priority"] })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{["Hot", "Warm", "Normal"].map((priority) => <SelectItem key={priority} value={priority}>{priority}</SelectItem>)}</SelectGroup></SelectContent></Select></Field><Field label="Probability"><Input type="number" min="0" max="100" value={draft.probability} onChange={(event) => onDraft({ ...draft, probability: Number(event.target.value) })} /></Field><Field label="Lead source"><Input value={draft.source} onChange={(event) => onDraft({ ...draft, source: event.target.value })} /></Field><Field label="Next step" wide><Input value={draft.nextStep} onChange={(event) => onDraft({ ...draft, nextStep: event.target.value })} /></Field><Field label="Description" wide><Textarea value={draft.description} onChange={(event) => onDraft({ ...draft, description: event.target.value })} rows={4} /></Field></div><Separator /><div><h3 className="font-semibold">Activity timeline</h3><div className="mt-3 flex flex-col gap-3"><div className="flex gap-3 rounded-lg border p-3"><CircleDollarSign className="size-5 text-primary" /><div><p className="text-sm font-medium">Deal value updated to ${draft.value.toLocaleString()}</p><p className="text-xs text-muted-foreground">Today by {draft.owner}</p></div></div><div className="flex gap-3 rounded-lg border p-3"><UserRound className="size-5 text-primary" /><div><p className="text-sm font-medium">{draft.activity}</p><p className="text-xs text-muted-foreground">Latest customer activity</p></div></div></div></div></div></ScrollArea><SheetFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={onSave}>Save deal</Button></SheetFooter></SheetContent></Sheet>
}
function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <div className={cn("flex flex-col gap-2", wide && "sm:col-span-2")}><Label>{label}</Label>{children}</div> }
