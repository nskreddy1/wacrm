'use client';

import { useState } from 'react';
import {
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type SubPipeline = {
  id: string;
  name: string;
  dealIds: string[];
};

type SubPipelineTabsProps = {
  pipelines: SubPipeline[];
  activePipelineId: string;
  onActivate: (id: string) => void;
  onCreate: (name: string) => void;
  onReorder: (pipelines: SubPipeline[]) => void;
};

function moveItem(items: SubPipeline[], sourceId: string, targetId: string) {
  const sourceIndex = items.findIndex((pipeline) => pipeline.id === sourceId);
  const targetIndex = items.findIndex((pipeline) => pipeline.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex)
    return items;
  const next = [...items];
  const [moved] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, moved);
  return next;
}

export function SubPipelineTabs({
  pipelines,
  activePipelineId,
  onActivate,
  onCreate,
  onReorder,
}: SubPipelineTabsProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [rearrangeOpen, setRearrangeOpen] = useState(false);
  const [draftOrder, setDraftOrder] = useState<SubPipeline[]>(pipelines);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [name, setName] = useState('');

  function movePipeline(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    setDraftOrder((current) => moveItem(current, draggedId, targetId));
  }

  function moveByOffset(id: string, offset: number) {
    setDraftOrder((current) => {
      const sourceIndex = current.findIndex((pipeline) => pipeline.id === id);
      const target = current[sourceIndex + offset];
      return target ? moveItem(current, id, target.id) : current;
    });
  }

  function renamePipeline(id: string, nextName: string) {
    setDraftOrder((current) =>
      current.map((pipeline) =>
        pipeline.id === id ? { ...pipeline, name: nextName } : pipeline
      )
    );
  }

  const trimmedName = name.trim();
  const duplicateName = pipelines.some(
    (pipeline) => pipeline.name.toLowerCase() === trimmedName.toLowerCase()
  );

  function createPipeline() {
    if (!trimmedName || duplicateName) return;
    onCreate(trimmedName);
    setName('');
    setCreateOpen(false);
  }

  return (
    <>
      <footer
        className="bg-card flex h-10 shrink-0 items-stretch border-t"
        aria-label="Sub-pipelines"
      >
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {pipelines.map((pipeline) => (
            <button
              key={pipeline.id}
              type="button"
              onClick={() => onActivate(pipeline.id)}
              className={cn(
                'text-muted-foreground hover:bg-muted hover:text-foreground relative flex max-w-64 min-w-40 items-center gap-2 border-r px-4 text-left text-xs font-medium transition-colors',
                pipeline.id === activePipelineId &&
                  'bg-background text-foreground'
              )}
              aria-current={
                pipeline.id === activePipelineId ? 'page' : undefined
              }
            >
              {pipeline.id === activePipelineId && (
                <span className="bg-primary absolute inset-x-0 top-0 h-0.5" />
              )}
              <GripVertical className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{pipeline.name}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex shrink-0 items-center border-r px-4 transition-colors"
            aria-label="Create sub-pipeline"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </div>
        <Popover
          open={rearrangeOpen}
          onOpenChange={(open) => {
            if (open) setDraftOrder(pipelines);
            setRearrangeOpen(open);
          }}
        >
          <PopoverTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-full shrink-0 rounded-none border-l"
                aria-label="Rearrange sub-pipelines"
              />
            }
          >
            <ArrowUpDown />
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            sideOffset={0}
            className="w-84 gap-0 overflow-hidden rounded-sm p-0"
          >
            <PopoverHeader className="flex-row items-center justify-between border-b px-4 py-3">
              <PopoverTitle className="text-base font-semibold">
                Rearrange Sub-Pipelines
              </PopoverTitle>
              <Button
                variant="secondary"
                size="icon-sm"
                className="rounded-full"
                onClick={() => setRearrangeOpen(false)}
                aria-label="Close rearrange sub-pipelines"
              >
                <X />
              </Button>
            </PopoverHeader>
            <PopoverDescription className="sr-only">
              Rename or drag boards into the order shown in the footer.
            </PopoverDescription>
            <div className="flex flex-col gap-2 p-4">
              {draftOrder.map((pipeline, index) => (
                <div
                  key={pipeline.id}
                  draggable
                  onDragStart={() => setDraggedId(pipeline.id)}
                  onDragEnd={() => setDraggedId(null)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => movePipeline(pipeline.id)}
                  className={cn(
                    'flex items-center gap-2',
                    draggedId === pipeline.id && 'opacity-50'
                  )}
                >
                  <button
                    type="button"
                    className="text-muted-foreground cursor-grab active:cursor-grabbing"
                    aria-label={`Drag ${pipeline.name}`}
                  >
                    <GripVertical aria-hidden="true" />
                  </button>
                  <Input
                    value={pipeline.name}
                    onChange={(event) =>
                      renamePipeline(pipeline.id, event.target.value)
                    }
                    aria-label={`Sub-pipeline ${index + 1} name`}
                  />
                  <div className="sr-only">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === 0}
                      onClick={() => moveByOffset(pipeline.id, -1)}
                      aria-label={`Move ${pipeline.name} up`}
                    >
                      <ChevronUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={index === draftOrder.length - 1}
                      onClick={() => moveByOffset(pipeline.id, 1)}
                      aria-label={`Move ${pipeline.name} down`}
                    >
                      <ChevronDown />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-muted/30 flex justify-start border-t px-4 py-3">
              <Button
                className="rounded-full"
                onClick={() => {
                  onReorder(
                    draftOrder.map((pipeline) => ({
                      ...pipeline,
                      name: pipeline.name.trim() || 'Untitled pipeline',
                    }))
                  );
                  setRearrangeOpen(false);
                }}
              >
                Save
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </footer>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create sub-pipeline</DialogTitle>
            <DialogDescription>
              Add another board to this pipeline workspace. It starts empty and
              uses the same stages.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="sub-pipeline-name">Board name</Label>
            <Input
              id="sub-pipeline-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229)
                  return;
                if (event.key === 'Enter') createPipeline();
              }}
              placeholder="Enterprise renewals"
              aria-invalid={duplicateName}
              aria-describedby={
                duplicateName ? 'sub-pipeline-error' : undefined
              }
              autoFocus
            />
            {duplicateName && (
              <p id="sub-pipeline-error" className="text-destructive text-sm">
                A board with this name already exists.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={createPipeline}
              disabled={!trimmedName || duplicateName}
            >
              Create board
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
