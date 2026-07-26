'use client';

// ============================================================
// Unified widget side panel (Twenty-style).
//
// The SAME panel serves both flows:
// - Add:  step 1 shows a "Widget type" list (like Twenty's
//         Chart / View / iFrame / Rich Text menu), step 2 is
//         the config form with a live preview draft.
// - Edit: opens straight on the config form, seeded from the
//         widget, and applies every change live.
//
// Motion follows the design-engineering rules: entrances use
// ease-out under 300ms, pressables scale to 0.97 on :active,
// and the type list staggers in at 40ms per row.
// ============================================================

import { useCallback, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Gauge,
  LayoutList,
  Plus,
  Shapes,
  TrendingUp,
  X,
} from 'lucide-react';

import type { DashboardOverview } from '@/lib/data/dashboard/types';
import type { ChartConfiguration } from '@/features/dashboards/lib/chart-config';
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
} from '@/features/dashboards/lib/widgets';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GraphConfigForm } from './graph-config-form';

const TYPE_OPTIONS: Array<{
  type: WidgetType;
  label: string;
  description: string;
  icon: typeof TrendingUp;
}> = [
  {
    type: 'graph',
    label: 'Chart',
    description: 'Compose from any source, measure and grouping',
    icon: Shapes,
  },
  {
    type: 'kpi',
    label: 'KPI',
    description: 'One headline number with trend',
    icon: TrendingUp,
  },
  {
    type: 'chart',
    label: 'Prebuilt chart',
    description: 'Curated views of your workspace data',
    icon: BarChart3,
  },
  {
    type: 'target',
    label: 'Target meter',
    description: 'Progress toward a goal you set',
    icon: Gauge,
  },
  {
    type: 'panel',
    label: 'Panel',
    description: 'Lists like tasks and recent activity',
    icon: LayoutList,
  },
];

/** Label-left form row, matching the rest of the app's forms. */
function FormRow({
  label,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

interface PanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overview: DashboardOverview;
  /** Present → edit mode (live updates); absent → add mode. */
  widget?: DashboardWidget | null;
  /** Add mode: called once when the user confirms. */
  onAdd?: (widget: DashboardWidget) => void;
  /** Edit mode: called on every change (live). */
  onUpdate?: (widget: DashboardWidget) => void;
}

/**
 * Docked side-by-side panel (Twenty-style): lives INLINE next to the
 * dashboard grid, never over it, so every change is visible live.
 * The parent owns the flex layout; this renders the panel column.
 */
export function WidgetConfigPanel({
  open,
  onOpenChange,
  overview,
  widget,
  onAdd,
  onUpdate,
}: PanelProps) {
  const editing = Boolean(widget);
  if (!open) return null;
  return (
    <aside
      aria-label={editing ? 'Edit widget' : 'New widget'}
      className={cn(
        'border-border bg-background flex w-full shrink-0 flex-col overflow-y-auto border-l',
        'sm:sticky sm:top-4 sm:max-h-[calc(100vh-6rem)] sm:w-90',
        // Entrance: ease-out, fast — the panel is opened constantly
        // while editing, so it must feel immediate.
        'animate-in fade-in slide-in-from-right-4 duration-200 ease-out'
      )}
    >
      <PanelBody
        key={widget?.id ?? 'new'}
        editing={editing}
        widget={widget ?? null}
        overview={overview}
        onAdd={onAdd}
        onUpdate={onUpdate}
        close={() => onOpenChange(false)}
      />
    </aside>
  );
}

function PanelBody({
  editing,
  widget,
  onAdd,
  onUpdate,
  close,
}: {
  editing: boolean;
  widget: DashboardWidget | null;
  overview: DashboardOverview;
  onAdd?: (widget: DashboardWidget) => void;
  onUpdate?: (widget: DashboardWidget) => void;
  close: () => void;
}) {
  // Add mode starts on the type step; edit mode skips it.
  const [step, setStep] = useState<'type' | 'config'>(
    editing ? 'config' : 'type'
  );
  const [type, setType] = useState<WidgetType>(widget?.type ?? 'graph');
  const [title, setTitle] = useState(widget?.title ?? '');
  const [kpiMetric, setKpiMetric] = useState<KpiMetric>(
    widget?.type === 'kpi' && widget.config.metric
      ? (widget.config.metric as KpiMetric)
      : 'openConversations'
  );
  const [chartKind, setChartKind] = useState<ChartKind>(
    widget?.type === 'chart' && widget.config.kind
      ? widget.config.kind
      : 'volume'
  );
  const [targetMetric, setTargetMetric] = useState<TargetMetric>(
    widget?.type === 'target' && widget.config.metric
      ? (widget.config.metric as TargetMetric)
      : 'newContacts30d'
  );
  const [goal, setGoal] = useState(String(widget?.config.goal ?? 100));
  const [panel, setPanel] = useState<PanelKind>(
    widget?.type === 'panel' && widget.config.panel
      ? widget.config.panel
      : 'tasks'
  );
  const [chartConfig, setChartConfig] = useState<ChartConfiguration | null>(
    widget?.config.chart ?? null
  );

  const buildConfig = useCallback(
    (
      t: WidgetType,
      v: {
        kpiMetric: KpiMetric;
        chartKind: ChartKind;
        targetMetric: TargetMetric;
        goal: string;
        panel: PanelKind;
        chartConfig: ChartConfiguration | null;
      }
    ): DashboardWidget['config'] => {
      const goalNum = Number(v.goal);
      switch (t) {
        case 'kpi':
          return { metric: v.kpiMetric };
        case 'chart':
          return { kind: v.chartKind };
        case 'graph':
          return { chart: v.chartConfig ?? undefined };
        case 'target':
          return {
            metric: v.targetMetric,
            goal: Number.isFinite(goalNum) && goalNum > 0 ? goalNum : 100,
          };
        case 'panel':
          return { panel: v.panel };
      }
    },
    []
  );

  /** Edit mode: push the merged widget up immediately (live). */
  const pushLive = useCallback(
    (patch: {
      title?: string;
      kpiMetric?: KpiMetric;
      chartKind?: ChartKind;
      targetMetric?: TargetMetric;
      goal?: string;
      panel?: PanelKind;
      chartConfig?: ChartConfiguration | null;
    }) => {
      if (!editing || !widget || !onUpdate) return;
      const values = {
        kpiMetric: patch.kpiMetric ?? kpiMetric,
        chartKind: patch.chartKind ?? chartKind,
        targetMetric: patch.targetMetric ?? targetMetric,
        goal: patch.goal ?? goal,
        panel: patch.panel ?? panel,
        chartConfig:
          patch.chartConfig !== undefined ? patch.chartConfig : chartConfig,
      };
      const nextTitle = patch.title !== undefined ? patch.title : title;
      onUpdate({
        ...widget,
        title: nextTitle.trim() ? nextTitle.trim().slice(0, 80) : undefined,
        config: buildConfig(widget.type, values),
      });
    },
    [
      editing,
      widget,
      onUpdate,
      kpiMetric,
      chartKind,
      targetMetric,
      goal,
      panel,
      title,
      chartConfig,
      buildConfig,
    ]
  );

  const handleChartConfigChange = useCallback(
    (config: ChartConfiguration | null) => {
      setChartConfig(config);
      if (config) pushLive({ chartConfig: config });
    },
    [pushLive]
  );

  const canSubmit = type !== 'graph' || chartConfig !== null;

  const draftTitle = useMemo(() => {
    const draft: DashboardWidget = {
      id: '__draft__',
      type,
      size: DEFAULT_SIZE[type],
      config: buildConfig(type, {
        kpiMetric,
        chartKind,
        targetMetric,
        goal,
        panel,
        chartConfig,
      }),
    };
    return widgetTitle(draft);
  }, [
    type,
    kpiMetric,
    chartKind,
    targetMetric,
    goal,
    panel,
    chartConfig,
    buildConfig,
  ]);

  function handleAdd() {
    if (!onAdd || !canSubmit) return;
    onAdd({
      id: crypto.randomUUID(),
      type,
      size: DEFAULT_SIZE[type],
      ...(title.trim() ? { title: title.trim().slice(0, 80) } : {}),
      config: buildConfig(type, {
        kpiMetric,
        chartKind,
        targetMetric,
        goal,
        panel,
        chartConfig,
      }),
    });
    close();
  }

  // ---------- Step 1 (add only): widget type list ----------
  if (step === 'type') {
    return (
      <>
        <div className="border-border flex items-center gap-2 border-b px-4 py-3">
          <span className="bg-primary/10 text-primary flex size-6 items-center justify-center rounded-md">
            <Plus className="size-4" aria-hidden="true" />
          </span>
          <h2 className="text-sm font-semibold">New widget</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close panel"
            className="text-muted-foreground hover:bg-muted hover:text-foreground ml-auto flex size-7 items-center justify-center rounded-md transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <p className="text-muted-foreground px-4 pt-3 pb-1 text-xs font-medium">
          Widget type
        </p>
        <div className="flex flex-col gap-1 px-3 pb-6">
          {TYPE_OPTIONS.map((opt, i) => (
            <button
              key={opt.type}
              type="button"
              onClick={() => {
                setType(opt.type);
                setStep('config');
              }}
              style={{ animationDelay: `${i * 40}ms` }}
              className={cn(
                'animate-in fade-in slide-in-from-right-2 fill-mode-both',
                'flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left',
                'hover:bg-muted transition-[background-color,transform] duration-150 ease-out',
                'active:scale-[0.98]'
              )}
            >
              <span className="border-border bg-card text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-md border">
                <opt.icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{opt.label}</span>
                <span className="text-muted-foreground block truncate text-xs">
                  {opt.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      </>
    );
  }

  // ---------- Step 2: config form (shared by add + edit) ----------
  const typeMeta = TYPE_OPTIONS.find((o) => o.type === type);

  return (
    <>
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        {!editing && (
          <button
            type="button"
            onClick={() => setStep('type')}
            aria-label="Back to widget types"
            className="text-muted-foreground hover:bg-muted hover:text-foreground -ml-1 flex size-7 shrink-0 items-center justify-center rounded-md transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </button>
        )}
        {typeMeta && (
          <span className="text-muted-foreground flex size-6 shrink-0 items-center justify-center">
            <typeMeta.icon className="size-4" aria-hidden="true" />
          </span>
        )}
        <h2 className="min-w-0 truncate text-sm font-semibold">
          {title.trim() || draftTitle}
        </h2>
        <span className="text-muted-foreground shrink-0 text-sm">
          {typeMeta?.label}
        </span>
        <button
          type="button"
          onClick={close}
          aria-label="Close panel"
          className="text-muted-foreground hover:bg-muted hover:text-foreground ml-auto flex size-7 shrink-0 items-center justify-center rounded-md transition-[background-color,transform] duration-150 ease-out active:scale-[0.97]"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      <p className="text-muted-foreground sr-only">
        {editing
          ? 'Changes apply to the dashboard immediately.'
          : 'Configure the widget, then add it to the dashboard.'}
      </p>

      <div className="flex flex-col gap-4 px-4 pt-4 pb-6">
        <FormRow label="Title" htmlFor="wcp-title">
          <Input
            id="wcp-title"
            value={title}
            placeholder={draftTitle}
            maxLength={80}
            onChange={(e) => {
              setTitle(e.target.value);
              pushLive({ title: e.target.value });
            }}
          />
        </FormRow>

        {type === 'kpi' && (
          <FormRow
            label="Measure"
            htmlFor="wcp-kpi-metric"
            hint={KPI_METRICS[kpiMetric].description}
          >
            <Select
              value={kpiMetric}
              onValueChange={(v) => {
                setKpiMetric(v as KpiMetric);
                pushLive({ kpiMetric: v as KpiMetric });
              }}
            >
              <SelectTrigger id="wcp-kpi-metric" className="w-full">
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

        {type === 'chart' && (
          <FormRow
            label="Chart"
            htmlFor="wcp-chart-kind"
            hint={CHART_KINDS[chartKind].description}
          >
            <Select
              value={chartKind}
              onValueChange={(v) => {
                setChartKind(v as ChartKind);
                pushLive({ chartKind: v as ChartKind });
              }}
            >
              <SelectTrigger id="wcp-chart-kind" className="w-full">
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

        {type === 'target' && (
          <>
            <FormRow label="Measure" htmlFor="wcp-target-metric">
              <Select
                value={targetMetric}
                onValueChange={(v) => {
                  setTargetMetric(v as TargetMetric);
                  pushLive({ targetMetric: v as TargetMetric });
                }}
              >
                <SelectTrigger id="wcp-target-metric" className="w-full">
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
            <FormRow
              label="Target goal"
              htmlFor="wcp-target-goal"
              hint="The meter fills as you approach this goal."
            >
              <Input
                id="wcp-target-goal"
                type="number"
                min={1}
                value={goal}
                onChange={(e) => {
                  setGoal(e.target.value);
                  pushLive({ goal: e.target.value });
                }}
                placeholder="100"
              />
            </FormRow>
          </>
        )}

        {type === 'panel' && (
          <FormRow
            label="Panel"
            htmlFor="wcp-panel-kind"
            hint={PANEL_KINDS[panel].description}
          >
            <Select
              value={panel}
              onValueChange={(v) => {
                setPanel(v as PanelKind);
                pushLive({ panel: v as PanelKind });
              }}
            >
              <SelectTrigger id="wcp-panel-kind" className="w-full">
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

        {type === 'graph' && (
          <GraphConfigForm
            initial={chartConfig ?? undefined}
            onChange={handleChartConfigChange}
          />
        )}
      </div>

      {!editing && (
        // pr-20 keeps the actions clear of the floating chat launcher
        // that sits fixed in the bottom-right corner of the app shell.
        <div className="border-border bg-background/95 sticky bottom-0 mt-auto flex items-center justify-end gap-2 border-t px-4 py-3 pr-20 backdrop-blur">
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={handleAdd}>
            Add widget
          </Button>
        </div>
      )}
    </>
  );
}
