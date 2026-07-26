'use client';

/**
 * Generic chart widget — the Twenty-style composable chart.
 *
 * Given a ChartConfiguration (source + measure + operation + groupBy),
 * fetches its own data from /api/v1/dashboard/chart-data and renders
 * the right visualization. Adapted from Twenty's graph widgets
 * (reference/twenty-dashboard) onto our recharts + token conventions.
 */

import { useMemo } from 'react';
import useSWR from 'swr';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { ChartLegend, ChartTooltipContent } from '@/components/ui/chart';
import type {
  ChartConfiguration,
  ChartDataRow,
} from '../../lib/chart-config';

const SERIES_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

const MAX_PIE_SLICES = 6;

async function postFetcher([url, body]: [string, string]) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  const json = (await res.json().catch(() => null)) as {
    data?: ChartDataRow[];
    error?: string;
  } | null;
  if (!res.ok) {
    throw new Error(json?.error ?? `Request failed (${res.status})`);
  }
  return json?.data ?? [];
}

function formatBucket(bucket: string | null): string {
  if (bucket === null || bucket === '') return '—';
  // Date buckets come back ISO-ish ("2026-07-01"); render compactly.
  const asDate = /^\d{4}-\d{2}-\d{2}/.test(bucket) ? new Date(bucket) : null;
  if (asDate && !Number.isNaN(asDate.getTime())) {
    return asDate.toLocaleDateString('en', { month: 'short', day: 'numeric' });
  }
  return bucket.replace(/_/g, ' ');
}

function formatValue(value: number): string {
  if (Math.abs(value) >= 1000) {
    return Intl.NumberFormat('en', { notation: 'compact' }).format(value);
  }
  return Number.isInteger(value)
    ? value.toLocaleString('en')
    : value.toFixed(2);
}

/** Pivot long rows (bucket, series, value) into wide recharts rows. */
function pivotRows(rows: ChartDataRow[]): {
  data: Record<string, string | number>[];
  seriesKeys: string[];
} {
  const hasSeries = rows.some((r) => r.series !== null);
  if (!hasSeries) {
    return {
      data: rows.map((r) => ({
        bucket: formatBucket(r.bucket),
        value: r.value,
      })),
      seriesKeys: ['value'],
    };
  }
  const seriesKeys = [...new Set(rows.map((r) => r.series ?? '—'))];
  const byBucket = new Map<string, Record<string, string | number>>();
  for (const r of rows) {
    const key = formatBucket(r.bucket);
    const entry = byBucket.get(key) ?? { bucket: key };
    entry[r.series ?? '—'] = r.value;
    byBucket.set(key, entry);
  }
  return { data: [...byBucket.values()], seriesKeys };
}

export function GenericChartWidget({
  config,
}: {
  config: ChartConfiguration;
}) {
  const { data, error, isLoading } = useSWR(
    ['/api/v1/dashboard/chart-data', JSON.stringify({ chart: config })],
    postFetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <div className="flex h-full min-h-32 items-center justify-center">
        <div className="bg-muted h-24 w-full animate-pulse rounded-md" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-destructive py-6 text-center text-xs">
        {error instanceof Error ? error.message : 'Failed to load chart.'}
      </p>
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-xs">
        No data for this configuration yet.
      </p>
    );
  }

  switch (config.configurationType) {
    case 'AGGREGATE_CHART':
      return <AggregateNumber rows={rows} config={config} />;
    case 'PIE_CHART':
      return <GenericPie rows={rows} />;
    case 'BAR_CHART':
      return (
        <GenericBar
          rows={rows}
          horizontal={config.layout === 'horizontal'}
          stacked={config.isStacked === true}
          showLegend={config.displayLegend !== false}
        />
      );
    case 'LINE_CHART':
      return (
        <GenericLine rows={rows} showLegend={config.displayLegend !== false} />
      );
  }
}

function AggregateNumber({
  rows,
  config,
}: {
  rows: ChartDataRow[];
  config: Extract<ChartConfiguration, { configurationType: 'AGGREGATE_CHART' }>;
}) {
  const value = rows[0]?.value ?? 0;
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-1">
      <span className="text-foreground text-4xl font-semibold tabular-nums">
        {config.prefix ?? ''}
        {formatValue(value)}
        {config.suffix ?? ''}
      </span>
      {config.description ? (
        <span className="text-muted-foreground text-xs">
          {config.description}
        </span>
      ) : null}
    </div>
  );
}

function GenericPie({ rows }: { rows: ChartDataRow[] }) {
  const { slices, total } = useMemo(() => {
    const sorted = [...rows].sort((a, b) => b.value - a.value);
    const sum = sorted.reduce((acc, r) => acc + r.value, 0);
    const head = sorted.slice(0, MAX_PIE_SLICES - 1).map((r) => ({
      name: formatBucket(r.bucket),
      value: r.value,
    }));
    const tail = sorted
      .slice(MAX_PIE_SLICES - 1)
      .reduce((acc, r) => acc + r.value, 0);
    return {
      slices: tail > 0 ? [...head, { name: 'Other', value: tail }] : head,
      total: sum,
    };
  }, [rows]);

  const legend = slices.map((s, i) => ({
    label: s.name,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
  }));

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={2}
              strokeWidth={0}
              isAnimationActive={false}
            >
              {slices.map((slice, i) => (
                <Cell
                  key={slice.name}
                  fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              isAnimationActive={false}
              content={
                <ChartTooltipContent
                  valueFormatter={(v) =>
                    total > 0
                      ? `${formatValue(v)} (${Math.round((v / total) * 100)}%)`
                      : formatValue(v)
                  }
                />
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-foreground text-xl font-semibold tabular-nums">
            {formatValue(total)}
          </span>
        </div>
      </div>
      <ChartLegend items={legend} className="justify-center" />
    </div>
  );
}

function GenericBar({
  rows,
  horizontal,
  stacked,
  showLegend,
}: {
  rows: ChartDataRow[];
  horizontal: boolean;
  stacked: boolean;
  showLegend: boolean;
}) {
  const { data, seriesKeys } = useMemo(() => pivotRows(rows), [rows]);
  const multiSeries = seriesKeys.length > 1 || seriesKeys[0] !== 'value';

  const legend = multiSeries
    ? seriesKeys.map((k, i) => ({
        label: k,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
      }))
    : [];

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="h-48 w-full grow">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout={horizontal ? 'vertical' : 'horizontal'}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              horizontal={!horizontal}
              vertical={horizontal}
            />
            {horizontal ? (
              <>
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickFormatter={formatValue}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="bucket"
                  width={90}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
              </>
            ) : (
              <>
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  tickFormatter={formatValue}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
              </>
            )}
            <Tooltip
              isAnimationActive={false}
              cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
              content={
                <ChartTooltipContent
                  valueFormatter={(v) => formatValue(v)}
                />
              }
            />
            {seriesKeys.map((key, i) => (
              <Bar
                key={key}
                dataKey={key}
                stackId={stacked ? 'stack' : undefined}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
                radius={stacked ? 0 : [3, 3, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {showLegend && legend.length > 0 ? (
        <ChartLegend items={legend} className="justify-center" />
      ) : null}
    </div>
  );
}

function GenericLine({
  rows,
  showLegend,
}: {
  rows: ChartDataRow[];
  showLegend: boolean;
}) {
  const { data, seriesKeys } = useMemo(() => pivotRows(rows), [rows]);
  const multiSeries = seriesKeys.length > 1 || seriesKeys[0] !== 'value';

  const legend = multiSeries
    ? seriesKeys.map((k, i) => ({
        label: k,
        color: SERIES_COLORS[i % SERIES_COLORS.length],
      }))
    : [];

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="h-48 w-full grow">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="bucket"
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
              tickFormatter={formatValue}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip
              isAnimationActive={false}
              content={
                <ChartTooltipContent valueFormatter={(v) => formatValue(v)} />
              }
            />
            {seriesKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {showLegend && legend.length > 0 ? (
        <ChartLegend items={legend} className="justify-center" />
      ) : null}
    </div>
  );
}
