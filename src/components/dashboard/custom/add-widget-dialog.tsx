"use client"

// ============================================================
// "+ Component" — Bigin/Zoho-style Add Component sheet:
// live widget preview on the left (driven by the form state),
// label-left config rows on the right, footer action bar with
// Cancel / Add & another / Add component.
// ============================================================

import { useMemo, useState } from "react"
import { BarChart3, Gauge, LayoutList, TrendingUp } from "lucide-react"

import type { DashboardOverview } from "@/lib/data/dashboard/types"
import {
  CHART_KINDS,
  DEFAULT_SIZE,
  KPI_METRICS,
  PANEL_KINDS,
  TARGET_METRICS,
  widgetTitle,
  type ChartKind,
  type DashboardWidget,
  type KpiMetric,
  type PanelKind,
  type TargetMetric,
  type WidgetType,
} from "@/lib/dashboards/widgets"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { WidgetRenderer } from "./widget-renderer"

const TYPE_OPTIONS: Array<{
  type: WidgetType
  label: string
  icon: typeof TrendingUp
}> = [
  { type: "kpi", label: "KPI", icon: TrendingUp },
  { type: "chart", label: "Chart", icon: BarChart3 },
  { type: "target", label: "Target Meter", icon: Gauge },
  { type: "panel", label: "Panel", icon: LayoutList },
]

/** One labeled form row, Bigin-style: label left, control right. */
function FormRow({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
  hint?: string
}) {
  return (
    <div className="grid items-start gap-1.5 sm:grid-cols-[150px_1fr] sm:items-center sm:gap-3">
      <Label htmlFor={htmlFor} className="text-muted-foreground sm:justify-self-end sm:text-right">
        {label}
      </Label>
      <div className="grid gap-1">
        {children}
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  )
}

export function AddWidgetDialog({
  open,
  onOpenChange,
  onAdd,
  overview,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (widget: DashboardWidget) => void
  overview: DashboardOverview
}) {
  const [type, setType] = useState<WidgetType>("kpi")
  const [kpiMetric, setKpiMetric] = useState<KpiMetric>("openConversations")
  const [chartKind, setChartKind] = useState<ChartKind>("volume")
  const [targetMetric, setTargetMetric] = useState<TargetMetric>("newContacts30d")
  const [goal, setGoal] = useState("100")
  const [panel, setPanel] = useState<PanelKind>("tasks")
  const [title, setTitle] = useState("")

  // Draft widget mirrors the form; powers both preview and submit.
  const draft = useMemo<DashboardWidget>(() => {
    const goalNum = Number(goal)
    return {
      id: "__preview__",
      type,
      size: DEFAULT_SIZE[type],
      ...(title.trim() ? { title: title.trim().slice(0, 80) } : {}),
      config:
        type === "kpi"
          ? { metric: kpiMetric }
          : type === "chart"
            ? { kind: chartKind }
            : type === "target"
              ? { metric: targetMetric, goal: Number.isFinite(goalNum) && goalNum > 0 ? goalNum : 100 }
              : { panel },
    }
  }, [type, kpiMetric, chartKind, targetMetric, goal, panel, title])

  function reset() {
    setTitle("")
  }

  function handleAdd(keepOpen: boolean) {
    onAdd({ ...draft, id: crypto.randomUUID() })
    reset()
    if (!keepOpen) onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="flex max-h-[min(640px,calc(100dvh-3rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Add component</DialogTitle>
          <DialogDescription>Preview updates live as you configure.</DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 overflow-y-auto md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          {/* Live preview pane */}
          <div className="flex flex-col gap-3 border-b border-border bg-muted/30 p-5 md:border-r md:border-b-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Preview</p>
            <div className="pointer-events-none min-h-[220px] flex-1 [&>*]:h-full" aria-hidden="true">
              <WidgetRenderer widget={draft} overview={overview} refresh={() => {}} />
            </div>
            <p className="text-center text-xs text-muted-foreground text-pretty">
              {widgetTitle(draft)} · shown with your live workspace data
            </p>
          </div>

          {/* Config form */}
          <div className="flex flex-col gap-4 p-6">
            <FormRow label="Component name" htmlFor="widget-title">
              <Input
                id="widget-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={widgetTitle({ ...draft, title: undefined })}
                maxLength={80}
              />
            </FormRow>

            <FormRow label="Component type">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Component type">
                {TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.type}
                    type="button"
                    role="radio"
                    aria-checked={type === opt.type}
                    onClick={() => setType(opt.type)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      type === opt.type
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-muted",
                    )}
                  >
                    <opt.icon className="size-3.5" aria-hidden="true" />
                    {opt.label}
                  </button>
                ))}
              </div>
            </FormRow>

            {type === "kpi" && (
              <FormRow label="Measure" htmlFor="widget-kpi-metric" hint={KPI_METRICS[kpiMetric].description}>
                <Select value={kpiMetric} onValueChange={(v) => setKpiMetric(v as KpiMetric)}>
                  <SelectTrigger id="widget-kpi-metric" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(KPI_METRICS) as KpiMetric[]).map((m) => (
                      <SelectItem key={m} value={m}>
                        {KPI_METRICS[m].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
            )}

            {type === "chart" && (
              <FormRow label="Chart" htmlFor="widget-chart-kind" hint={CHART_KINDS[chartKind].description}>
                <Select value={chartKind} onValueChange={(v) => setChartKind(v as ChartKind)}>
                  <SelectTrigger id="widget-chart-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(CHART_KINDS) as ChartKind[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {CHART_KINDS[k].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
            )}

            {type === "target" && (
              <>
                <FormRow label="Measure" htmlFor="widget-target-metric">
                  <Select value={targetMetric} onValueChange={(v) => setTargetMetric(v as TargetMetric)}>
                    <SelectTrigger id="widget-target-metric" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TARGET_METRICS) as TargetMetric[]).map((m) => (
                        <SelectItem key={m} value={m}>
                          {TARGET_METRICS[m].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormRow>
                <FormRow label="Target goal" htmlFor="widget-target-goal" hint="The meter fills as you approach this goal.">
                  <Input
                    id="widget-target-goal"
                    type="number"
                    min={1}
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="100"
                  />
                </FormRow>
              </>
            )}

            {type === "panel" && (
              <FormRow label="Panel" htmlFor="widget-panel-kind" hint={PANEL_KINDS[panel].description}>
                <Select value={panel} onValueChange={(v) => setPanel(v as PanelKind)}>
                  <SelectTrigger id="widget-panel-kind" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PANEL_KINDS) as PanelKind[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {PANEL_KINDS[p].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
            )}
          </div>
        </div>

        {/* Footer action bar */}
        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/30 px-6 py-3.5">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => handleAdd(true)}>
            Add &amp; another
          </Button>
          <Button onClick={() => handleAdd(false)}>Add component</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
