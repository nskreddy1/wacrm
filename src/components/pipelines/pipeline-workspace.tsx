"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { ArrowDown, ArrowUp, ChevronDown, Download, Ellipsis, Filter, GripVertical, LayoutGrid, List, Plus, Search, Table2, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SubPipelineTabs } from "./sub-pipeline-tabs"
import { PipelineDealEditor } from "./pipeline-deal-editor"
import { PipelineSheet } from "./pipeline-data-sheet"
import { cacheKeys } from "@/lib/cache/keys"
import { createSubPipelineAction, deleteDealsAction, moveDealAction, reorderSubPipelinesAction, saveDealAction } from "@/lib/pipelines/actions"
import type { PipelineDeal, PipelineMode, PipelineSnapshot } from "@/lib/pipelines/domain"
import { downloadCsv } from "@/lib/download-csv"
import { pipelinePath } from "@/lib/routes/dashboard-routes"
import { cn } from "@/lib/utils"

export function PipelineWorkspace({ initialSnapshot, initialMode, initialSubPipelineId, initialSavedViewId }: { initialSnapshot: PipelineSnapshot; initialMode: PipelineMode; initialSubPipelineId?: string; initialSavedViewId?: string }) {
  const router = useRouter()
  const { data: snapshot = initialSnapshot, mutate } = useSWR<PipelineSnapshot>(cacheKeys.pipelineSnapshot(initialSnapshot.accountId, initialSnapshot.pipeline.id), null, { fallbackData: initialSnapshot, revalidateOnFocus: false })
  const [query, setQuery] = useState("")
  const [owner, setOwner] = useState("all")
  const [stage, setStage] = useState("all")
  const [sort, setSort] = useState<"createdAt" | "value" | "due">("createdAt")
  const [ascending, setAscending] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [activeSubPipelineId, setActiveSubPipelineId] = useState(initialSubPipelineId ?? snapshot.subPipelines[0]?.id ?? snapshot.pipeline.id)
  const [editing, setEditing] = useState<PipelineDeal | "new" | null>(null)
  const [defaultStageId, setDefaultStageId] = useState(snapshot.stages[0]?.id ?? "")
  const [pending, startTransition] = useTransition()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  const activeSubPipeline = snapshot.subPipelines.find((item) => item.id === activeSubPipelineId) ?? snapshot.subPipelines[0]

  const deals = useMemo(() => {
    const allowed = new Set(activeSubPipeline?.dealIds ?? snapshot.deals.map((deal) => deal.id))
    const term = query.trim().toLowerCase()
    return snapshot.deals.filter((deal) => allowed.has(deal.id) && (stage === "all" || deal.stageId === stage) && (owner === "all" || deal.assignedTo === owner) && (!term || `${deal.title} ${deal.contact?.name ?? ""} ${deal.company ?? ""}`.toLowerCase().includes(term))).sort((a, b) => {
      const left = a[sort] ?? ""; const right = b[sort] ?? ""
      return String(left).localeCompare(String(right), undefined, { numeric: true }) * (ascending ? 1 : -1)
    })
  }, [activeSubPipeline, ascending, owner, query, snapshot.deals, sort, stage])

  function changeMode(mode: PipelineMode) {
    router.replace(pipelinePath(snapshot.accountId, snapshot.pipeline.id, mode, { subPipeline: activeSubPipelineId, savedView: initialSavedViewId }))
  }

  function optimisticDeal(next: PipelineDeal) {
    return mutate({ ...snapshot, deals: snapshot.deals.map((deal) => deal.id === next.id ? next : deal) }, { revalidate: false })
  }

  async function moveDeal(dealId: string, stageId: string) {
    const previous = snapshot
    const current = snapshot.deals.find((deal) => deal.id === dealId)
    if (!current || current.stageId === stageId) return
    await optimisticDeal({ ...current, stageId })
    const result = await moveDealAction(dealId, snapshot.pipeline.id, stageId)
    if (!result.ok) { await mutate(previous, { revalidate: false }); toast.error(result.error); return }
    await optimisticDeal(result.data)
  }

  function dragEnd(event: DragEndEvent) {
    if (event.over) void moveDeal(String(event.active.id), String(event.over.id))
  }

  async function deleteSelected() {
    const previous = snapshot
    await mutate({ ...snapshot, deals: snapshot.deals.filter((deal) => !selected.has(deal.id)) }, { revalidate: false })
    const result = await deleteDealsAction(snapshot.pipeline.id, [...selected])
    if (!result.ok) { await mutate(previous, { revalidate: false }); toast.error(result.error); return }
    setSelected(new Set()); toast.success("Deals deleted")
  }

  async function saveDeal(input: Parameters<typeof saveDealAction>[0]) {
    const result = await saveDealAction(input)
    if (!result.ok) return result
    await mutate({ ...snapshot, deals: snapshot.deals.some((deal) => deal.id === result.data.id) ? snapshot.deals.map((deal) => deal.id === result.data.id ? result.data : deal) : [result.data, ...snapshot.deals] }, { revalidate: false })
    setEditing(null); toast.success("Deal saved"); return result
  }

  async function createSubPipeline(name: string) {
    const result = await createSubPipelineAction({ pipelineId: snapshot.pipeline.id, name, position: snapshot.subPipelines.length })
    if (!result.ok) return toast.error(result.error)
    await mutate({ ...snapshot, subPipelines: [...snapshot.subPipelines, result.data] }, { revalidate: false }); setActiveSubPipelineId(result.data.id)
  }

  async function reorderSubPipelines(items: { id: string; name: string; dealIds: string[] }[]) {
    const previous = snapshot
    const next = items.map((item, position) => ({ ...snapshot.subPipelines.find((pipeline) => pipeline.id === item.id)!, ...item, position }))
    await mutate({ ...snapshot, subPipelines: next }, { revalidate: false })
    const result = await reorderSubPipelinesAction(snapshot.pipeline.id, next)
    if (!result.ok) { await mutate(previous, { revalidate: false }); toast.error(result.error) } else toast.success("Sub-pipeline order saved")
  }

  function exportDeals() {
    const ok = downloadCsv("pipeline-deals.csv", [["Deal", "Contact", "Company", "Value", "Stage", "Owner", "Closing date"], ...deals.map((deal) => [deal.title, deal.contact?.name ?? "", deal.company ?? "", deal.value, snapshot.stages.find((item) => item.id === deal.stageId)?.name ?? "", deal.owner?.name ?? "", deal.due ?? ""])])
    if (ok) toast.success(`${deals.length} deals exported`)
    else toast.error("No deals to export")
  }

  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
    <header className="flex min-h-14 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
      <Popover><PopoverTrigger render={<Button variant={owner !== "all" || stage !== "all" ? "secondary" : "ghost"} size="icon" className="rounded-full" aria-label="Filter deals" />}><Filter /></PopoverTrigger><PopoverContent align="start" className="w-72"><div className="flex flex-col gap-3"><p className="font-medium">Filter deals</p><Select value={owner} onValueChange={(value) => value && setOwner(value)}><SelectTrigger className="w-full"><SelectValue placeholder="Owner" /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All owners</SelectItem>{snapshot.members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectGroup></SelectContent></Select><Select value={stage} onValueChange={(value) => value && setStage(value)}><SelectTrigger className="w-full"><SelectValue placeholder="Stage" /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">All stages</SelectItem>{snapshot.stages.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectGroup></SelectContent></Select><Button variant="outline" onClick={() => { setOwner("all"); setStage("all") }}>Clear filters</Button></div></PopoverContent></Popover>
      <Select value={snapshot.pipeline.id} onValueChange={(id) => id && router.push(pipelinePath(snapshot.accountId, id, initialMode))}><SelectTrigger className="min-w-44 rounded-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{snapshot.pipelines.map((pipeline) => <SelectItem key={pipeline.id} value={pipeline.id}>{pipeline.name}</SelectItem>)}</SelectGroup></SelectContent></Select>
      <div className="relative min-w-48 flex-1 md:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="rounded-full pl-9" placeholder="Search deals" /></div>
      <span className="hidden text-sm lg:inline">Sort by</span><Select value={sort} onValueChange={(value) => value && setSort(value as typeof sort)}><SelectTrigger className="w-36 rounded-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="createdAt">Created time</SelectItem><SelectItem value="value">Amount</SelectItem><SelectItem value="due">Closing date</SelectItem></SelectGroup></SelectContent></Select><Button variant="outline" size="icon" className="rounded-full" onClick={() => setAscending((value) => !value)} aria-label="Toggle sort direction">{ascending ? <ArrowUp /> : <ArrowDown />}</Button>
      <Tabs value={initialMode} onValueChange={(value) => changeMode(value as PipelineMode)}><TabsList><TabsTrigger value="board" aria-label="Board view"><LayoutGrid /></TabsTrigger><TabsTrigger value="list" aria-label="List view"><List /></TabsTrigger><TabsTrigger value="sheet" aria-label="Sheet view"><Table2 /></TabsTrigger></TabsList></Tabs>
      <div className="flex overflow-hidden rounded-full bg-primary"><Button className="rounded-none" onClick={() => { setDefaultStageId(snapshot.stages[0]?.id ?? ""); setEditing("new") }}><Plus data-icon="inline-start" />Deal</Button><DropdownMenu><DropdownMenuTrigger render={<Button size="icon" className="rounded-none" aria-label="Deal creation options" />}><ChevronDown /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup>{snapshot.stages.map((item) => <DropdownMenuItem key={item.id} onClick={() => { setDefaultStageId(item.id); setEditing("new") }}>Add in {item.name}</DropdownMenuItem>)}</DropdownMenuGroup></DropdownMenuContent></DropdownMenu></div>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="rounded-full" aria-label="More pipeline actions" />}><Ellipsis /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={exportDeals}><Download />Export CSV</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
    </header>
    <div className="flex items-center gap-4 border-b bg-muted/30 px-4 py-2 text-xs"><span><strong>{deals.length}</strong> deals</span><span><strong>{deals.filter((deal) => deal.status === "open").length}</strong> open</span><span><strong>{new Intl.NumberFormat(undefined, { style: "currency", currency: deals[0]?.currency ?? "USD", maximumFractionDigits: 0 }).format(deals.reduce((sum, deal) => sum + deal.value, 0))}</strong> value</span>{(owner !== "all" || stage !== "all") && <Button variant="ghost" size="sm" onClick={() => { setOwner("all"); setStage("all") }}><X data-icon="inline-start" />Clear</Button>}</div>
    {selected.size > 0 && <div className="flex items-center gap-2 border-b bg-muted px-3 py-2 text-sm"><strong>{selected.size} selected</strong><Button variant="destructive" size="sm" onClick={() => void deleteSelected()}><Trash2 data-icon="inline-start" />Delete</Button></div>}
    {initialMode === "board" ? <DndContext sensors={sensors} onDragEnd={dragEnd}><div className="grid min-h-0 flex-1 auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-2 overflow-x-auto bg-muted/20 p-2">{snapshot.stages.map((item) => <StageColumn key={item.id} stageId={item.id} name={item.name} deals={deals.filter((deal) => deal.stageId === item.id)} onOpen={setEditing} currency={deals[0]?.currency ?? "USD"} />)}</div></DndContext> : initialMode === "sheet" ? <PipelineSheet deals={deals} stages={snapshot.stages} members={snapshot.members} onSave={saveDeal} /> : <DealTable deals={deals} selected={selected} onSelected={setSelected} onOpen={setEditing} stages={snapshot.stages} />}
    {initialMode === "board" && <SubPipelineTabs pipelines={snapshot.subPipelines} activePipelineId={activeSubPipelineId} onActivate={(id) => { setActiveSubPipelineId(id); router.replace(pipelinePath(snapshot.accountId, snapshot.pipeline.id, initialMode, { subPipeline: id, savedView: initialSavedViewId })) }} onCreate={(name) => startTransition(() => void createSubPipeline(name))} onReorder={(items) => startTransition(() => void reorderSubPipelines(items))} />}
    {editing !== null && <PipelineDealEditor key={editing === "new" ? `new-${defaultStageId}` : editing.id} open deal={editing === "new" ? null : editing} defaultStageId={defaultStageId} snapshot={snapshot} pending={pending} onOpenChange={(open) => { if (!open) setEditing(null) }} onSave={saveDeal} />}
  </div>
}

function StageColumn({ stageId, name, deals, onOpen, currency }: { stageId: string; name: string; deals: PipelineDeal[]; onOpen: (deal: PipelineDeal) => void; currency: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId })
  return <section ref={setNodeRef} className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card", isOver && "ring-2 ring-primary")}><header className="flex items-center justify-between border-b p-3"><div><h2 className="font-semibold">{name}</h2><p className="text-xs text-muted-foreground">{new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(deals.reduce((sum, deal) => sum + deal.value, 0))} · {deals.length}</p></div></header><div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">{deals.map((deal) => <DealCard key={deal.id} deal={deal} onOpen={onOpen} />)}{deals.length === 0 && <p className="m-auto text-sm text-muted-foreground">Drop a deal here</p>}</div></section>
}

function DealCard({ deal, onOpen }: { deal: PipelineDeal; onOpen: (deal: PipelineDeal) => void }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: deal.id })
  return <article ref={setNodeRef} className={cn("rounded-md border bg-background p-3 shadow-xs", isDragging && "opacity-40")}><div className="flex items-start gap-2"><button {...attributes} {...listeners} aria-label={`Drag ${deal.title}`} className="cursor-grab text-muted-foreground"><GripVertical /></button><button className="min-w-0 flex-1 truncate text-left text-sm font-semibold hover:text-primary" onClick={() => onOpen(deal)}>{deal.title}</button></div><p className="mt-2 text-sm font-medium">{new Intl.NumberFormat(undefined, { style: "currency", currency: deal.currency }).format(deal.value)}</p><div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Avatar className="size-6"><AvatarFallback>{deal.owner?.name.slice(0, 2).toUpperCase() ?? "--"}</AvatarFallback></Avatar><span className="truncate">{deal.owner?.name ?? "Unassigned"}</span></div></article>
}

function DealTable({ deals, selected, onSelected, onOpen, stages }: { deals: PipelineDeal[]; selected: Set<string>; onSelected: (value: Set<string>) => void; onOpen: (deal: PipelineDeal) => void; stages: PipelineSnapshot["stages"] }) {
  return <div className="min-h-0 flex-1 overflow-auto"><table className="min-w-full text-sm"><thead className="sticky top-0 bg-card"><tr><th className="w-12 border-b p-3"><Checkbox checked={deals.length > 0 && deals.every((deal) => selected.has(deal.id))} onCheckedChange={() => onSelected(deals.every((deal) => selected.has(deal.id)) ? new Set() : new Set(deals.map((deal) => deal.id)))} aria-label="Select all deals" /></th>{["Deal", "Contact", "Company", "Stage", "Amount", "Owner", "Closing date"].map((label) => <th key={label} className="border-b px-3 py-2 text-left">{label}</th>)}</tr></thead><tbody>{deals.map((deal) => <tr key={deal.id} className="hover:bg-muted/40"><td className="border-b p-3"><Checkbox checked={selected.has(deal.id)} onCheckedChange={() => { const next = new Set(selected); if (next.has(deal.id)) next.delete(deal.id); else next.add(deal.id); onSelected(next) }} aria-label={`Select ${deal.title}`} /></td><td className="border-b px-3 py-2"><button className="font-semibold hover:text-primary" onClick={() => onOpen(deal)}>{deal.title}</button></td><td className="border-b px-3 py-2">{deal.contact?.name ?? "—"}</td><td className="border-b px-3 py-2">{deal.company ?? "—"}</td><td className="border-b px-3 py-2">{stages.find((item) => item.id === deal.stageId)?.name ?? "—"}</td><td className="border-b px-3 py-2">{new Intl.NumberFormat(undefined, { style: "currency", currency: deal.currency }).format(deal.value)}</td><td className="border-b px-3 py-2">{deal.owner?.name ?? "Unassigned"}</td><td className="border-b px-3 py-2">{deal.due ?? "—"}</td></tr>)}</tbody></table></div>
}
