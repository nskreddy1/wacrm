'use client';

// ============================================================
// Twenty-style generic chart configuration form.
//
// Modeled on Twenty CRM's widget settings panel:
//   chart-type icon row  (bar / horizontal bar / line / pie / aggregate)
//   Data    — Source, Time range
//   X axis  — Data on display (dimension), Date granularity
//   Y axis  — Measure, Operation, Cumulative / Stacked
//   Style   — Legend
//
// Source metadata comes from /api/v1/dashboard/chart-sources, so the
// options automatically honor per-account custom module names.
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  BarChart3,
  BarChartHorizontal,
  ChartLine,
  ChartPie,
  Sigma,
} from 'lucide-react';

import {
  defaultGranularity,
  type AggregateOperation,
  type ChartConfiguration,
  type ChartSourceMeta,
  type DateGranularity,
  type GraphWidgetConfigurationType,
  type TimeRange,
} from '@/features/dashboards/lib/chart-config';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load chart sources');
  const json = (await res.json()) as { data: ChartSourceMeta[] };
  return json.data;
};

const CHART_TYPE_OPTIONS: Array<{
  type: GraphWidgetConfigurationType;
  horizontal?: boolean;
  label: string;
  icon: typeof BarChart3;
}> = [
  { type: 'BAR_CHART', label: 'Bar', icon: BarChart3 },
  {
    type: 'BAR_CHART',
    horizontal: true,
    label: 'Horizontal bar',
    icon: BarChartHorizontal,
  },
  { type: 'LINE_CHART', label: 'Line', icon: ChartLine },
  { type: 'PIE_CHART', label: 'Pie', icon: ChartPie },
  { type: 'AGGREGATE_CHART', label: 'Number', icon: Sigma },
];

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
  all: 'All time',
};

const GRANULARITY_LABELS: Record<DateGranularity, string> = {
  day: 'Day',
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
};

const OPERATION_LABELS: Record<AggregateOperation, string> = {
  COUNT: 'Count',
  SUM: 'Sum',
  AVG: 'Average',
  MIN: 'Min',
  MAX: 'Max',
  COUNT_UNIQUE_VALUES: 'Count unique',
  COUNT_EMPTY: 'Count empty',
  COUNT_NOT_EMPTY: 'Count not empty',
};

/** Section heading, like Twenty's "Data" / "X axis" / "Y axis" groups. */
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground pt-1 text-xs font-medium tracking-wide uppercase">
      {children}
    </p>
  );
}

function ConfigRow({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid items-center gap-1.5 sm:grid-cols-[150px_1fr] sm:gap-3">
      <Label
        htmlFor={htmlFor}
        className="text-muted-foreground sm:justify-self-end sm:text-right"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

export function GraphConfigForm({
  onChange,
}: {
  onChange: (config: ChartConfiguration | null) => void;
}) {
  const { data: sources, error } = useSWR(
    '/api/v1/dashboard/chart-sources',
    fetcher,
    { revalidateOnFocus: false }
  );

  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [typeIndex, setTypeIndex] = useState(0); // index into CHART_TYPE_OPTIONS
  const [measureKey, setMeasureKey] = useState<string | null>(null);
  const [operation, setOperation] = useState<AggregateOperation>('COUNT');
  const [groupByKey, setGroupByKey] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [granularity, setGranularity] = useState<DateGranularity | null>(null);
  const [stacked, setStacked] = useState(false);
  const [cumulative, setCumulative] = useState(false);
  const [legend, setLegend] = useState(true);

  const source = useMemo(
    () => sources?.find((s) => s.key === sourceKey) ?? sources?.[0] ?? null,
    [sources, sourceKey]
  );

  const chartType = CHART_TYPE_OPTIONS[typeIndex];

  // Resolve current selections against the active source, falling back
  // to the first available option whenever the source changes.
  const measure =
    source?.measures.find((m) => m.key === measureKey) ??
    source?.measures[0] ??
    null;
  const groupBy =
    source?.dimensions.find((d) => d.key === groupByKey) ??
    source?.dimensions[0] ??
    null;

  const isCountMeasure = measure?.key === 'count';
  const needsGroupBy = chartType.type !== 'AGGREGATE_CHART';
  const isDateDimension = groupBy?.kind === 'date';

  // Assemble the configuration and push it up whenever it changes.
  const config = useMemo<ChartConfiguration | null>(() => {
    if (!source || !measure) return null;

    const base = {
      source: source.key,
      measure: measure.key,
      operation: isCountMeasure ? ('COUNT' as const) : operation,
      timeRange,
      displayLegend: legend,
    };

    switch (chartType.type) {
      case 'AGGREGATE_CHART':
        return { ...base, configurationType: 'AGGREGATE_CHART' };
      case 'PIE_CHART':
        if (!groupBy) return null;
        return {
          ...base,
          configurationType: 'PIE_CHART',
          groupBy: groupBy.key,
          orderBy: 'value_desc',
        };
      case 'BAR_CHART':
        if (!groupBy) return null;
        return {
          ...base,
          configurationType: 'BAR_CHART',
          groupBy: groupBy.key,
          ...(isDateDimension
            ? {
                dateGranularity: granularity ?? defaultGranularity(timeRange),
                orderBy: 'bucket' as const,
              }
            : { orderBy: 'value_desc' as const }),
          layout: chartType.horizontal ? 'horizontal' : 'vertical',
          isStacked: stacked,
        };
      case 'LINE_CHART':
        if (!groupBy) return null;
        return {
          ...base,
          configurationType: 'LINE_CHART',
          groupBy: groupBy.key,
          ...(isDateDimension
            ? {
                dateGranularity: granularity ?? defaultGranularity(timeRange),
                orderBy: 'bucket' as const,
              }
            : { orderBy: 'bucket' as const }),
          isCumulative: cumulative,
        };
    }
  }, [
    source,
    measure,
    groupBy,
    chartType,
    operation,
    isCountMeasure,
    isDateDimension,
    timeRange,
    granularity,
    stacked,
    cumulative,
    legend,
  ]);

  useEffect(() => {
    onChange(config);
  }, [config, onChange]);

  if (error) {
    return (
      <p className="text-destructive text-xs">
        Could not load chart sources. Try again shortly.
      </p>
    );
  }

  if (!sources) {
    return (
      <div className="grid gap-2" aria-busy="true" aria-label="Loading chart sources">
        <div className="bg-muted h-8 animate-pulse rounded-md" />
        <div className="bg-muted h-8 animate-pulse rounded-md" />
        <div className="bg-muted h-8 animate-pulse rounded-md" />
      </div>
    );
  }

  return (
    <div className="grid gap-3.5">
      {/* Chart type icon row */}
      <div
        className="flex flex-wrap gap-1.5"
        role="radiogroup"
        aria-label="Chart type"
      >
        {CHART_TYPE_OPTIONS.map((opt, i) => (
          <button
            key={opt.label}
            type="button"
            role="radio"
            aria-checked={typeIndex === i}
            title={opt.label}
            onClick={() => setTypeIndex(i)}
            className={cn(
              'flex items-center justify-center rounded-lg border px-3 py-2 transition-colors',
              typeIndex === i
                ? 'border-primary bg-primary-soft text-primary'
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            )}
          >
            <opt.icon className="size-4" aria-hidden="true" />
            <span className="sr-only">{opt.label}</span>
          </button>
        ))}
      </div>

      <SectionHeading>Data</SectionHeading>
      <ConfigRow label="Source" htmlFor="graph-source">
        <Select
          value={source?.key ?? ''}
          onValueChange={(v) => {
            setSourceKey(v);
            setMeasureKey(null);
            setGroupByKey(null);
          }}
        >
          <SelectTrigger id="graph-source" className="w-full">
            <SelectValue placeholder="Pick a source" />
          </SelectTrigger>
          <SelectContent>
            {sources.map((s) => (
              <SelectItem key={s.key} value={s.key}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ConfigRow>
      <ConfigRow label="Time range" htmlFor="graph-time-range">
        <Select
          value={timeRange}
          onValueChange={(v) => setTimeRange(v as TimeRange)}
        >
          <SelectTrigger id="graph-time-range" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map((r) => (
              <SelectItem key={r} value={r}>
                {TIME_RANGE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ConfigRow>

      {needsGroupBy && source && (
        <>
          <SectionHeading>X axis</SectionHeading>
          <ConfigRow label="Data on display" htmlFor="graph-group-by">
            <Select
              value={groupBy?.key ?? ''}
              onValueChange={(v) => setGroupByKey(v)}
            >
              <SelectTrigger id="graph-group-by" className="w-full">
                <SelectValue placeholder="Pick a field" />
              </SelectTrigger>
              <SelectContent>
                {source.dimensions.map((d) => (
                  <SelectItem key={d.key} value={d.key}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ConfigRow>
          {isDateDimension && (
            <ConfigRow label="Date granularity" htmlFor="graph-granularity">
              <Select
                value={granularity ?? defaultGranularity(timeRange)}
                onValueChange={(v) => setGranularity(v as DateGranularity)}
              >
                <SelectTrigger id="graph-granularity" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(GRANULARITY_LABELS) as DateGranularity[]).map(
                    (g) => (
                      <SelectItem key={g} value={g}>
                        {GRANULARITY_LABELS[g]}
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
            </ConfigRow>
          )}
        </>
      )}

      {source && (
        <>
          <SectionHeading>Y axis</SectionHeading>
          <ConfigRow label="Measure" htmlFor="graph-measure">
            <Select
              value={measure?.key ?? ''}
              onValueChange={(v) => setMeasureKey(v)}
            >
              <SelectTrigger id="graph-measure" className="w-full">
                <SelectValue placeholder="Pick a measure" />
              </SelectTrigger>
              <SelectContent>
                {source.measures.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ConfigRow>
          {!isCountMeasure && (
            <ConfigRow label="Operation" htmlFor="graph-operation">
              <Select
                value={operation}
                onValueChange={(v) => setOperation(v as AggregateOperation)}
              >
                <SelectTrigger id="graph-operation" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['SUM', 'AVG', 'MIN', 'MAX'] as const).map((op) => (
                    <SelectItem key={op} value={op}>
                      {OPERATION_LABELS[op]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </ConfigRow>
          )}
          {chartType.type === 'BAR_CHART' && (
            <ConfigRow label="Stacked" htmlFor="graph-stacked">
              <Switch
                id="graph-stacked"
                checked={stacked}
                onCheckedChange={setStacked}
              />
            </ConfigRow>
          )}
          {chartType.type === 'LINE_CHART' && (
            <ConfigRow label="Cumulative" htmlFor="graph-cumulative">
              <Switch
                id="graph-cumulative"
                checked={cumulative}
                onCheckedChange={setCumulative}
              />
            </ConfigRow>
          )}
        </>
      )}

      {chartType.type !== 'AGGREGATE_CHART' && (
        <>
          <SectionHeading>Style</SectionHeading>
          <ConfigRow label="Legend" htmlFor="graph-legend">
            <Switch
              id="graph-legend"
              checked={legend}
              onCheckedChange={setLegend}
            />
          </ConfigRow>
        </>
      )}
    </div>
  );
}
