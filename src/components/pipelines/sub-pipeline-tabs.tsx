"use client"

import { useState } from "react"
import { GripVertical, MoreHorizontal, Plus } from "lucide-react"
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
}

export function SubPipelineTabs({ pipelines, activePipelineId, onActivate, onCreate }: SubPipelineTabsProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState("")

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
      <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="h-full shrink-0 rounded-none border-l" aria-label="Sub-pipeline options" />}><MoreHorizontal /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuItem onClick={() => setCreateOpen(true)}><Plus /> New sub-pipeline</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
    </footer>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Create sub-pipeline</DialogTitle><DialogDescription>Add another board to this pipeline workspace. It starts empty and uses the same stages.</DialogDescription></DialogHeader>
        <div className="flex flex-col gap-2"><Label htmlFor="sub-pipeline-name">Board name</Label><Input id="sub-pipeline-name" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === "Enter") createPipeline() }} placeholder="Enterprise renewals" autoFocus /></div>
        <DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={createPipeline} disabled={!name.trim()}>Create board</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
