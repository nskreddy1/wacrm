"use client"

// ============================================================
// "+ Component" dialog — Zoho-style two-step picker:
//   1) choose a component type (KPI / Chart / Target Meter / Panel)
//   2) configure it (metric / chart kind / goal / optional title)
// ============================================================

import { useState } from "react"
import { BarChart3, Gauge, LayoutList, TrendingUp } from "lucide-react"

import {
  CHART_KINDS,
  DEFAULT_SIZE,
  KPI_METRICS,
  PANEL_KINDS,
  TARGET_METRICS,
  type ChartKind,
  type DashboardWidget,
  type KpiMetric,
  type PanelKind,
  type TargetMetric,
  type WidgetType,
} from "@/lib/dashboards/widgets"
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

const TYPE_OPTIONS: Array<{
  type: WidgetType
  label: string
  description: string
  icon: typeof TrendingUp
}> = [
  { type: "kpi", label: "KPI", description: "Single number with trend", icon: TrendingUp },
  { type: "chart", label: "Chart", description: "Time series and distributions", icon: BarChart3 },
  { type: "target", label: "Target Meter", description: "Progress toward a goal", icon: Gauge },
  { type: "panel", label: "Panel", description: "Tasks, schedule, activity, team", icon: LayoutList },
]

export function AddWidgetDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (widget: DashboardWidget) => void
}) {
  const [step, setStep] = useState<"type" | "config">("type")
  const [type, setType] = useState<WidgetType>("kpi")
  const [kpiMetric, setKpiMetric] = useState<KpiMetric>("openConversations")
  const [chartKind, setChartKind] = useState<ChartKind>("volume")
  const [targetMetric, setTargetMetric] = useState<TargetMetric>("newContacts30d")
  const [goal, setGoal] = useState("100")
  const [panel, setPanel] = useState<PanelKind>("tasks")
  const [title, setTitle] = useState("")

  function reset() {
    setStep("type")
    setTitle("")
  }

  function handleAdd() {
    const goalNum = Number(goal)
    const widget: DashboardWidget = {
      id: crypto.randomUUID(),
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
    onAdd(widget)
    onOpenChange(false)
    reset()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{step === "type" ? "Add component" : "Configure component"}</DialogTitle>
          <DialogDescription>
            {step === "type"
              ? "Choose what to add to this dashboard."
              : "Pick the data this component shows."}
          </DialogDescription>
        </DialogHeader>

        {step === "type" ? (
          <div className="flex flex-col gap-1.5">
            {TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                type="button"
                onClick={() => {
                  setType(opt.type)
                  setStep("config")
                }}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <opt.icon className="size-4.5" aria-hidden="true" />
                </span>
                <span className="grid leading-tight">
                  <span className="text-sm font-medium">{opt.label}</span>
                  <span className="text-xs text-muted-foreground">{opt.description}</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {type === "kpi" && (
              <div className="grid gap-1.5">
                <Label htmlFor="widget-kpi-metric">Metric</Label>
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
                <p className="text-xs text-muted-foreground">{KPI_METRICS[kpiMetric].description}</p>
              </div>
            )}

            {type === "chart" && (
              <div className="grid gap-1.5">
                <Label htmlFor="widget-chart-kind">Chart</Label>
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
                <p className="text-xs text-muted-foreground">{CHART_KINDS[chartKind].description}</p>
              </div>
            )}

            {type === "target" && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="widget-target-metric">Metric</Label>
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
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="widget-target-goal">Goal</Label>
                  <Input
                    id="widget-target-goal"
                    type="number"
                    min={1}
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="100"
                  />
                </div>
              </>
            )}

            {type === "panel" && (
              <div className="grid gap-1.5">
                <Label htmlFor="widget-panel-kind">Panel</Label>
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
                <p className="text-xs text-muted-foreground">{PANEL_KINDS[panel].description}</p>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="widget-title">
                Custom title
                <span className="ml-1 font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="widget-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Uses the default name if blank"
                maxLength={80}
              />
            </div>

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep("type")}>
                Back
              </Button>
              <Button onClick={handleAdd}>Add component</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
