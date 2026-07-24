"use client"

// ============================================================
// One user-defined dashboard: responsive 12-col grid of widgets
// rendered from the shared overview payload.
//
// Edit mode: dnd-kit drag reorder (grip handle), size cycling
// (sm → md → lg → full), remove. Every mutation autosaves via a
// debounced PATCH — no explicit save button to forget.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { GripVertical, Plus, Scaling, X } from "lucide-react"
import { toast } from "sonner"

import type { DashboardOverview } from "@/lib/data/dashboard/types"
import {
  WIDGET_SIZES,
  widgetTitle,
  type DashboardWidget,
  type WidgetSize,
} from "@/features/dashboards/lib/widgets"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { AddWidgetDialog } from "./add-widget-dialog"
import { WidgetRenderer } from "./widget-renderer"

/** 12-col spans per size. Mobile always stacks full-width. */
const SIZE_SPANS: Record<WidgetSize, string> = {
  sm: "col-span-12 sm:col-span-6 xl:col-span-3",
  md: "col-span-12 xl:col-span-6",
  lg: "col-span-12 xl:col-span-9",
  full: "col-span-12",
}

function SortableWidget({
  widget,
  editing,
  overview,
  refresh,
  onResize,
  onRemove,
}: {
  widget: DashboardWidget
  editing: boolean
  overview: DashboardOverview
  refresh: () => void
  onResize: (id: string) => void
  onRemove: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: !editing,
  })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "relative min-w-0",
        SIZE_SPANS[widget.size],
        isDragging && "z-10 opacity-80",
      )}
    >
      {editing && (
        <div className="absolute -top-2.5 right-2 z-10 flex items-center gap-1 rounded-full border border-border bg-card px-1 py-0.5 shadow-sm">
          <button
            type="button"
            className="flex size-6 cursor-grab items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
            aria-label={`Move ${widgetTitle(widget)}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onResize(widget.id)}
            className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={`Resize ${widgetTitle(widget)} (current: ${widget.size})`}
            title={`Size: ${widget.size} — click to cycle`}
          >
            <Scaling className="size-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onRemove(widget.id)}
            className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            aria-label={`Remove ${widgetTitle(widget)}`}
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className={cn("h-full", editing && "pointer-events-none select-none")}>
        <WidgetRenderer widget={widget} overview={overview} refresh={refresh} />
      </div>
    </div>
  )
}

export function CustomDashboard({
  dashboardId,
  initialWidgets,
  editing,
  overview,
  refresh,
  onWidgetsSaved,
}: {
  dashboardId: string
  initialWidgets: DashboardWidget[]
  editing: boolean
  overview: DashboardOverview
  refresh: () => void
  /** Bubble the saved widgets up so the SWR cache stays in sync. */
  onWidgetsSaved: (widgets: DashboardWidget[]) => void
}) {
  const [widgets, setWidgets] = useState<DashboardWidget[]>(initialWidgets)
  const [addOpen, setAddOpen] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-sync local state when switching dashboards.
  const [syncedFor, setSyncedFor] = useState(dashboardId)
  if (syncedFor !== dashboardId) {
    setSyncedFor(dashboardId)
    setWidgets(initialWidgets)
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const persist = useCallback(
    (next: DashboardWidget[]) => {
      setWidgets(next)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        void (async () => {
          try {
            const res = await fetch(`/api/dashboards/${dashboardId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ widgets: next }),
            })
            if (!res.ok) throw new Error()
            onWidgetsSaved(next)
          } catch {
            toast.error("Failed to save dashboard changes")
          }
        })()
      }, 700)
    },
    [dashboardId, onWidgetsSaved],
  )

  // Flush pending saves on unmount so quick tab switches don't lose edits.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = widgets.findIndex((w) => w.id === active.id)
    const to = widgets.findIndex((w) => w.id === over.id)
    if (from < 0 || to < 0) return
    persist(arrayMove(widgets, from, to))
  }

  function cycleSize(id: string) {
    persist(
      widgets.map((w) => {
        if (w.id !== id) return w
        const next = WIDGET_SIZES[(WIDGET_SIZES.indexOf(w.size) + 1) % WIDGET_SIZES.length]
        return { ...w, size: next }
      }),
    )
  }

  function removeWidget(id: string) {
    persist(widgets.filter((w) => w.id !== id))
  }

  if (widgets.length === 0) {
    return (
      <>
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm font-medium">This dashboard is empty.</p>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground text-pretty">
            Add KPI cards, charts, target meters and panels to build a view
            that matches how you work.
          </p>
          <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" aria-hidden="true" /> Add component
          </Button>
        </div>
        <AddWidgetDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          overview={overview}
          onAdd={(w) => persist([...widgets, w])}
        />
      </>
    )
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={widgets.map((w) => w.id)} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-12 gap-4">
            {widgets.map((w) => (
              <SortableWidget
                key={w.id}
                widget={w}
                editing={editing}
                overview={overview}
                refresh={refresh}
                onResize={cycleSize}
                onRemove={removeWidget}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {editing && (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border py-6 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Plus className="size-4" aria-hidden="true" /> Add component
        </button>
      )}

      <AddWidgetDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        overview={overview}
        onAdd={(w) => persist([...widgets, w])}
      />
    </>
  )
}
