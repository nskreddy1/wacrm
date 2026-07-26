/**
 * Generic chart configuration — adapted from Twenty CRM.
 *
 * Source: reference/twenty-dashboard/types/page-layout/*.ts
 *   - AggregateOperations           (types/AggregateOperations.ts)
 *   - *ChartConfiguration union     (page-layout-widget-configuration.type.ts)
 *   - GridPosition                  (grid-position.type.ts)
 *   - PageLayoutTabLayoutMode       (PageLayoutTabLayoutMode.ts)
 *
 * Twenty keys configs off `fieldMetadataId` (their runtime metadata layer).
 * We key off the SQL-side chart catalog instead (chart_sources,
 * chart_dimensions, chart_measures) which the `chart_aggregate` RPC
 * validates against — so every value here is an allowlisted key, never a
 * raw column name.
 */

import { z } from 'zod';

// ------------------------------------------------------------------
// Aggregate operations (copied from Twenty, trimmed to what the
// chart_aggregate RPC implements)
// ------------------------------------------------------------------
export const AGGREGATE_OPERATIONS = [
  'COUNT',
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'COUNT_UNIQUE_VALUES',
  'COUNT_EMPTY',
  'COUNT_NOT_EMPTY',
] as const;

export type AggregateOperation = (typeof AGGREGATE_OPERATIONS)[number];

export const DATE_GRANULARITIES = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
] as const;

export type DateGranularity = (typeof DATE_GRANULARITIES)[number];

export const CHART_ORDER_BY = [
  'bucket',
  'bucket_desc',
  'value',
  'value_desc',
] as const;

export type ChartOrderBy = (typeof CHART_ORDER_BY)[number];

// ------------------------------------------------------------------
// Time range presets (our addition — Twenty uses raw filter groups)
// ------------------------------------------------------------------
export const TIME_RANGES = [
  '7d',
  '30d',
  '90d',
  '6m',
  '12m',
  'all',
] as const;

export type TimeRange = (typeof TIME_RANGES)[number];

// ------------------------------------------------------------------
// Chart configurations (Twenty's discriminated union, adapted)
// ------------------------------------------------------------------
type BaseChartConfiguration = {
  /** chart_sources.source_key */
  source: string;
  /** chart_measures.measure_key ('records' = COUNT(*)) */
  measure: string;
  operation: AggregateOperation;
  timeRange?: TimeRange;
  description?: string;
  color?: string;
  displayLegend?: boolean;
};

export type AggregateChartConfiguration = BaseChartConfiguration & {
  configurationType: 'AGGREGATE_CHART';
  prefix?: string;
  suffix?: string;
};

export type PieChartConfiguration = BaseChartConfiguration & {
  configurationType: 'PIE_CHART';
  /** chart_dimensions.dimension_key */
  groupBy: string;
  orderBy?: ChartOrderBy;
  limit?: number;
};

export type BarChartConfiguration = BaseChartConfiguration & {
  configurationType: 'BAR_CHART';
  groupBy: string;
  dateGranularity?: DateGranularity;
  /** optional second dimension -> grouped/stacked series */
  seriesBy?: string;
  orderBy?: ChartOrderBy;
  limit?: number;
  layout?: 'vertical' | 'horizontal';
  isStacked?: boolean;
};

export type LineChartConfiguration = BaseChartConfiguration & {
  configurationType: 'LINE_CHART';
  groupBy: string;
  dateGranularity?: DateGranularity;
  seriesBy?: string;
  orderBy?: ChartOrderBy;
  limit?: number;
  isCumulative?: boolean;
};

export type ChartConfiguration =
  | AggregateChartConfiguration
  | PieChartConfiguration
  | BarChartConfiguration
  | LineChartConfiguration;

export const GRAPH_WIDGET_CONFIGURATION_TYPES = [
  'AGGREGATE_CHART',
  'PIE_CHART',
  'BAR_CHART',
  'LINE_CHART',
] as const;

export type GraphWidgetConfigurationType =
  (typeof GRAPH_WIDGET_CONFIGURATION_TYPES)[number];

// ------------------------------------------------------------------
// Zod schemas — validate configs at the API boundary before they
// reach the RPC (the RPC re-validates everything server-side too).
// ------------------------------------------------------------------
const baseChartSchema = z.object({
  source: z.string().min(1).max(64),
  measure: z.string().min(1).max(64),
  operation: z.enum(AGGREGATE_OPERATIONS),
  timeRange: z.enum(TIME_RANGES).optional(),
  description: z.string().max(500).optional(),
  color: z.string().max(32).optional(),
  displayLegend: z.boolean().optional(),
});

export const aggregateChartSchema = baseChartSchema.extend({
  configurationType: z.literal('AGGREGATE_CHART'),
  prefix: z.string().max(8).optional(),
  suffix: z.string().max(8).optional(),
});

export const pieChartSchema = baseChartSchema.extend({
  configurationType: z.literal('PIE_CHART'),
  groupBy: z.string().min(1).max(64),
  orderBy: z.enum(CHART_ORDER_BY).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const barChartSchema = baseChartSchema.extend({
  configurationType: z.literal('BAR_CHART'),
  groupBy: z.string().min(1).max(64),
  dateGranularity: z.enum(DATE_GRANULARITIES).optional(),
  seriesBy: z.string().min(1).max(64).optional(),
  orderBy: z.enum(CHART_ORDER_BY).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  layout: z.enum(['vertical', 'horizontal']).optional(),
  isStacked: z.boolean().optional(),
});

export const lineChartSchema = baseChartSchema.extend({
  configurationType: z.literal('LINE_CHART'),
  groupBy: z.string().min(1).max(64),
  dateGranularity: z.enum(DATE_GRANULARITIES).optional(),
  seriesBy: z.string().min(1).max(64).optional(),
  orderBy: z.enum(CHART_ORDER_BY).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  isCumulative: z.boolean().optional(),
});

export const chartConfigurationSchema = z.discriminatedUnion(
  'configurationType',
  [aggregateChartSchema, pieChartSchema, barChartSchema, lineChartSchema]
);

// ------------------------------------------------------------------
// Chart catalog shapes returned by /api/v1/dashboard/chart-sources
// ------------------------------------------------------------------
export type ChartDimensionMeta = {
  key: string;
  label: string;
  kind: 'text' | 'date' | 'bool' | 'relation';
};

export type ChartMeasureMeta = {
  key: string;
  label: string;
  kind: 'number' | 'currency';
};

export type ChartSourceMeta = {
  key: string;
  label: string;
  dimensions: ChartDimensionMeta[];
  measures: ChartMeasureMeta[];
};

// ------------------------------------------------------------------
// Chart data result (normalized shape the RPC returns)
// ------------------------------------------------------------------
export type ChartDataRow = {
  bucket: string | null;
  series: string | null;
  value: number;
};

export function timeRangeToDates(range: TimeRange | undefined): {
  from: string | null;
  to: string | null;
} {
  if (!range || range === 'all') return { from: null, to: null };
  const now = new Date();
  const from = new Date(now);
  switch (range) {
    case '7d':
      from.setDate(now.getDate() - 7);
      break;
    case '30d':
      from.setDate(now.getDate() - 30);
      break;
    case '90d':
      from.setDate(now.getDate() - 90);
      break;
    case '6m':
      from.setMonth(now.getMonth() - 6);
      break;
    case '12m':
      from.setMonth(now.getMonth() - 12);
      break;
  }
  return { from: from.toISOString(), to: null };
}

/** Sensible default granularity for a time range. */
export function defaultGranularity(range: TimeRange | undefined): DateGranularity {
  switch (range) {
    case '7d':
    case '30d':
      return 'day';
    case '90d':
      return 'week';
    default:
      return 'month';
  }
}
