"use client"

import { useState } from "react"
import { ArrowDownUp, ChevronDown, ChevronUp, GripVertical, MoreHorizontal, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export type SubPipeline = {
  id: string
  name: string
  dealIds: string[]
}

type SubPipelineTabsProps = {
  pipelines: SubPipeline[]
  activePipelineId: string
  onActivate: (id: string) => void
  onCreate: (name: string) => void
  onReorder: (pipelines: SubPipeline[]) => void
}

function moveItem(items: SubPipeline[], sourceId: string, targetId: string) {
  const sourceIndex = items.findIndex((pipeline) => pipeline.id === sourceId)
  const targetIndex = items.findIndex((pipeline) => pipeline.id === targetId)
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return items
  const next = [...items]
  const [moved] = next.splice(sourceIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

export function SubPipelineTabs({ pipelines, activePipelineId, onActivate, onCreate, onReorder }: SubPipelineTabsProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [rearrangeOpen, setRearrangeOpen] = useState(false)
  const [draftOrder, setDraftOrder] = useState<SubPipeline[]>(pipelines)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [name, setName] = useState("")

  function openRearrange() {
    setDraftOrder(pipelines)
    setRearrangeOpen(true)
  }

  function movePipeline(targetId: string) {
    if (!draggedId || draggedId === targetId) return
    setDraftOrder((current) => moveItem(current, draggedId, targetId))
  }

  function moveByOffset(id: string, offset: number) {
    setDraftOrder((current) => {
      const sourceIndex = current.findIndex((pipeline) => pipeline.id === id)
      const target = current[sourceIndex + offset]
      return target ? moveItem(current, id, target.id) : current
    })
  }

  function renamePipeline(id: string, nextName: string) {
    setDraftOrder((current) => current.map((pipeline) => pipeline.id === id ? { ...pipeline, name: nextName } : pipeline))
  }

  function createPipeline() {
    const trimmedName = name.trim()
    if (!trimmedName) return
    onCreate(trimmedName)
    setName("")
    setCreateOpen(false)
  }

  return <>
    <footer className="flex h-10 shrink-0 items-stretch border-t bg-card" aria-label="Sub-pipelines">
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {pipelines.map((pipeline) => <button key={pipeline.id} type="button" onClick={() => onActivate(pipeline.id)} className={cn("relative flex min-w-40 max-w-64 items-center gap-2 border-r px-4 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", pipeline.id === activePipelineId && "bg-background text-foreground")} aria-current={pipeline.id === activePipelineId ? "page" : undefined}>
          {pipeline.id === activePipelineId && <span className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
          <GripVertical className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{pipeline.name}</span>
        </button>)}
        <Button variant="ghost" size="icon" className="h-full shrink-0 rounded-none border-r" onClick={() => setCreateOpen(true)} aria-label="Create sub-pipeline"><Plus /></Button>
      </div>
      <Button variant="ghost" size="icon" className="h-full shrink-0 rounded-none border-l" onClick={openRearrange} aria-label="Rearrange sub-pipelines"><ArrowDownUp /></Button>
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="h-full shrink-0 rounded-none border-l" aria-label="Sub-pipeline options" />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => setCreateOpen(true)}><Plus /> New sub-pipeline</DropdownMenuItem><DropdownMenuItem onClick={openRearrange}><GripVertical /> Rearrange sub-pipelines</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
    </footer>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Create sub-pipeline</DialogTitle><DialogDescription>Add another board to this pipeline workspace. It starts empty and uses the same stages.</DialogDescription></DialogHeader>
        <div className="flex flex-col gap-2"><Label htmlFor="sub-pipeline-name">Board name</Label><Input id="sub-pipeline-name" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === "Enter") createPipeline() }} placeholder="Enterprise renewals" autoFocus /></div>
        <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={createPipeline} disabled={!name.trim()}>Create board</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={rearrangeOpen} onOpenChange={setRearrangeOpen}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-sm">
        <DialogHeader className="border-b px-4 py-3"><DialogTitle>Rearrange Sub-Pipelines</DialogTitle><DialogDescription className="sr-only">Rename or drag boards into the order shown in the footer.</DialogDescription></DialogHeader>
        <div className="flex flex-col gap-2 p-4">{draftOrder.map((pipeline, index) => <div key={pipeline.id} draggable onDragStart={() => setDraggedId(pipeline.id)} onDragEnd={() => setDraggedId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => movePipeline(pipeline.id)} className={cn("flex items-center gap-2", draggedId === pipeline.id && "opacity-50")}><button type="button" className="cursor-grab text-muted-foreground active:cursor-grabbing" aria-label={`Drag ${pipeline.name}`}><GripVertical aria-hidden="true" /></button><Input value={pipeline.name} onChange={(event) => renamePipeline(pipeline.id, event.target.value)} aria-label={`Sub-pipeline ${index + 1} name`} /><div className="flex"><Button variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => moveByOffset(pipeline.id, -1)} aria-label={`Move ${pipeline.name} up`}><ChevronUp /></Button><Button variant="ghost" size="icon-sm" disabled={index === draftOrder.length - 1} onClick={() => moveByOffset(pipeline.id, 1)} aria-label={`Move ${pipeline.name} down`}><ChevronDown /></Button></div></div>)}</div>
        <DialogFooter className="justify-start border-t bg-muted/30 px-4 py-3 sm:justify-start"><Button onClick={() => { onReorder(draftOrder.map((pipeline) => ({ ...pipeline, name: pipeline.name.trim() || "Untitled pipeline" }))); setRearrangeOpen(false) }}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
