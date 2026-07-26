'use client';

// ============================================================
// One user-defined dashboard, Twenty-style:
//
// - 12-col free grid (react-grid-layout): drag anywhere via the
//   grip handle, resize from the corner — grid placeholder shows
//   the target cells while moving, exactly like Twenty.
// - Click a widget in edit mode to open the right-hand config
//   panel and edit it LIVE (chart type, source, axes, style).
// - Mobile (<640px container) stacks widgets full-width, same as
//   Twenty's phone layout. Editing stays desktop-only.
// - Every mutation autosaves via a debounced PATCH.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GridLayout, { useContainerWidth, type Layout } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { GripVertical, Pencil, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

import type { DashboardOverview } from '@/lib/data/dashboard/types';
import type { ChartConfiguration } from '@/features/dashboards/lib/chart-config';
import {
  SIZE_TO_GRID,
  widgetTitle,
  type DashboardWidget,
} from '@/features/dashboards/lib/widgets';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { AddWidgetDialog } from './add-widget-dialog';
import { GraphConfigForm } from './graph-config-form';
import { WidgetRenderer } from './widget-renderer';

const GRID_COLS = 12;
const ROW_HEIGHT = 72;
const GRID_MARGIN: readonly [number, number] = [16, 16];

/**
 * Derive the RGL layout from widgets. Widgets saved before the grid
 * migration have no `grid` — they get a footprint from their legacy
 * `size` and the vertical compactor packs them in order.
 */
function toLayout(widgets: DashboardWidget[]): Layout {
  let cursorX = 0;
  let cursorY = 0;
  let rowH = 0;
  return widgets.map((w) => {
    if (w.grid) {
      return {
        i: w.id,
        x: w.grid.x,
        y: w.grid.y,
        w: w.grid.w,
        h: w.grid.h,
        minW: 2,
        minH: 2,
      };
    }
    const { w: width, h: height } = SIZE_TO_GRID[w.size];
    if (cursorX + width > GRID_COLS) {
      cursorX = 0;
      cursorY += rowH;
      rowH = 0;
    }
    const item = {
      i: w.id,
      x: cursorX,
      y: cursorY,
      w: width,
      h: height,
      minW: 2,
      minH: 2,
    };
    cursorX += width;
    rowH = Math.max(rowH, height);
    return item;
  });
}

export function CustomDashboard({
  dashboardId,
  initialWidgets,
  editing,
  overview,
  refresh,
  onWidgetsSaved,
}: {
  dashboardId: string;
  initialWidgets: DashboardWidget[];
  editing: boolean;
  overview: DashboardOverview;
  refresh: () => void;
  /** Bubble the saved widgets up so the SWR cache stays in sync. */
  onWidgetsSaved: (widgets: DashboardWidget[]) => void;
}) {
  const [widgets, setWidgets] = useState<DashboardWidget[]>(initialWidgets);
  const [addOpen, setAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width, mounted, containerRef } = useContainerWidth();

  // Re-sync local state when switching dashboards.
  const [syncedFor, setSyncedFor] = useState(dashboardId);
  if (syncedFor !== dashboardId) {
    setSyncedFor(dashboardId);
    setWidgets(initialWidgets);
    setSelectedId(null);
  }

  const isMobile = mounted && width < 640;
  const selected = widgets.find((w) => w.id === selectedId) ?? null;

  const persist = useCallback(
    (next: DashboardWidget[]) => {
      setWidgets(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void (async () => {
          try {
            const res = await fetch(`/api/dashboards/${dashboardId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ widgets: next }),
            });
            if (!res.ok) throw new Error();
            onWidgetsSaved(next);
          } catch {
            toast.error('Failed to save dashboard changes');
          }
        })();
      }, 700);
    },
    [dashboardId, onWidgetsSaved]
  );

  // Flush pending saves on unmount so quick tab switches don't lose edits.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const layout = useMemo(() => toLayout(widgets), [widgets]);

  const handleLayoutChange = useCallback(
    (next: Layout) => {
      if (!editing) return;
      const byId = new Map(next.map((l) => [l.i, l]));
      let changed = false;
      const merged = widgets.map((w) => {
        const l = byId.get(w.id);
        if (!l) return w;
        const g = w.grid;
        if (g && g.x === l.x && g.y === l.y && g.w === l.w && g.h === l.h) {
          return w;
        }
        changed = true;
        return { ...w, grid: { x: l.x, y: l.y, w: l.w, h: l.h } };
      });
      if (changed) persist(merged);
    },
    [editing, widgets, persist]
  );

  function removeWidget(id: string) {
    if (selectedId === id) setSelectedId(null);
    persist(widgets.filter((w) => w.id !== id));
  }

  function updateSelected(patch: Partial<DashboardWidget>) {
    if (!selected) return;
    persist(
      widgets.map((w) => (w.id === selected.id ? { ...w, ...patch } : w))
    );
  }

  function updateSelectedChart(config: ChartConfiguration | null) {
    if (!selected || !config) return;
    persist(
      widgets.map((w) =>
        w.id === selected.id
          ? { ...w, config: { ...w.config, chart: config } }
          : w
      )
    );
  }

  if (widgets.length === 0) {
    return (
      <>
        <div className="border-border flex min-h-[50vh] flex-col items-center justify-center gap-3 rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm font-medium">This dashboard is empty.</p>
          <p className="text-muted-foreground max-w-sm text-xs leading-relaxed text-pretty">
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
    );
  }

  return (
    <>
      <div ref={containerRef} className="min-w-0">
        {isMobile ? (
          // Twenty's phone layout: widgets stack full-width in grid order.
          <div className="flex flex-col gap-4">
            {[...widgets]
              .sort((a, b) => {
                const ga = a.grid ?? { y: 0, x: 0 };
                const gb = b.grid ?? { y: 0, x: 0 };
                return ga.y - gb.y || ga.x - gb.x;
              })
              .map((w) => {
                const h = w.grid?.h ?? SIZE_TO_GRID[w.size].h;
                return (
                  <div
                    key={w.id}
                    style={{ minHeight: h * ROW_HEIGHT * 0.75 }}
                    className="min-w-0"
                  >
                    <WidgetRenderer
                      widget={w}
                      overview={overview}
                      refresh={refresh}
                    />
                  </div>
                );
              })}
          </div>
        ) : (
          mounted && (
            <GridLayout
              width={width}
              layout={layout}
              gridConfig={{
                cols: GRID_COLS,
                rowHeight: ROW_HEIGHT,
                margin: GRID_MARGIN,
                containerPadding: [0, 0],
              }}
              dragConfig={{
                enabled: editing,
                handle: '.widget-drag-handle',
                threshold: 3,
              }}
              resizeConfig={{ enabled: editing, handles: ['se'] }}
              onLayoutChange={handleLayoutChange}
            >
              {widgets.map((w) => (
                <div
                  key={w.id}
                  className={cn(
                    'group/widget relative min-w-0',
                    editing && 'cursor-pointer',
                    editing &&
                      selectedId === w.id &&
                      'ring-primary rounded-xl ring-2 ring-offset-2 ring-offset-background'
                  )}
                  onClick={
                    editing ? () => setSelectedId(w.id) : undefined
                  }
                >
                  {editing && (
                    <div className="border-border bg-card absolute -top-2.5 right-2 z-10 flex items-center gap-1 rounded-full border px-1 py-0.5 shadow-sm">
                      <span
                        className="widget-drag-handle text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 cursor-grab items-center justify-center rounded-full transition-colors active:cursor-grabbing"
                        aria-label={`Move ${widgetTitle(w)}`}
                        role="button"
                        tabIndex={0}
                      >
                        <GripVertical className="size-3.5" aria-hidden="true" />
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(w.id);
                        }}
                        className="text-muted-foreground hover:bg-muted hover:text-foreground flex size-6 items-center justify-center rounded-full transition-colors"
                        aria-label={`Edit ${widgetTitle(w)}`}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeWidget(w.id);
                        }}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive flex size-6 items-center justify-center rounded-full transition-colors"
                        aria-label={`Remove ${widgetTitle(w)}`}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  <div
                    className={cn(
                      'h-full min-w-0',
                      editing && 'pointer-events-none select-none'
                    )}
                  >
                    <WidgetRenderer
                      widget={w}
                      overview={overview}
                      refresh={refresh}
                    />
                  </div>
                </div>
              ))}
            </GridLayout>
          )
        )}
      </div>

      {editing && !isMobile && (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="border-border text-muted-foreground hover:border-primary/40 hover:text-foreground mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-6 text-sm font-medium transition-colors"
        >
          <Plus className="size-4" aria-hidden="true" /> Add component
        </button>
      )}

      {/* Twenty-style live config panel: edits apply to the widget
          immediately, autosave handles persistence. */}
      <Sheet
        open={editing && selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-md"
        >
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{widgetTitle(selected)}</SheetTitle>
                <SheetDescription>
                  Changes apply to the dashboard immediately.
                </SheetDescription>
              </SheetHeader>
              <div className="grid gap-3.5 px-4 pb-6">
                <div className="grid items-center gap-1.5 sm:grid-cols-[150px_1fr] sm:gap-3">
                  <Label
                    htmlFor="widget-title"
                    className="text-muted-foreground sm:justify-self-end sm:text-right"
                  >
                    Title
                  </Label>
                  <Input
                    id="widget-title"
                    value={selected.title ?? ''}
                    placeholder={widgetTitle(selected)}
                    maxLength={80}
                    onChange={(e) =>
                      updateSelected({
                        title: e.target.value.trim()
                          ? e.target.value
                          : undefined,
                      })
                    }
                  />
                </div>
                {selected.type === 'graph' && (
                  <GraphConfigForm
                    key={selected.id}
                    initial={selected.config.chart}
                    onChange={updateSelectedChart}
                  />
                )}
                {selected.type !== 'graph' && (
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    This is a prebuilt component — drag to move it, or resize
                    from the bottom-right corner. Custom charts offer full
                    data configuration.
                  </p>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <AddWidgetDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        overview={overview}
        onAdd={(w) => persist([...widgets, w])}
      />
    </>
  );
}
