import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  toErrorResponse,
} from '@/features/auth/lib/account';
import {
  chartConfigurationSchema,
  defaultGranularity,
  timeRangeToDates,
  type ChartDataRow,
} from '@/features/dashboards/lib/chart-config';

export const dynamic = 'force-dynamic';

/**
 * POST /api/v1/dashboard/chart-data
 *
 * Executes a generic chart configuration (Twenty-style: source +
 * measure + operation + groupBy) against the chart_aggregate RPC.
 *
 * Security layering:
 *  1. Zod validates the config shape here.
 *  2. chart_aggregate re-validates every key against the chart catalog
 *     allowlist tables — raw column/table names are never interpolated.
 *  3. The RPC is SECURITY INVOKER, so the caller's RLS policies scope
 *     all rows to their account.
 */
export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();

    const body = await request.json().catch(() => null);
    const parsed = chartConfigurationSchema.safeParse(body?.chart ?? body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid chart configuration', issues: parsed.error.issues },
        { status: 400 }
      );
    }

    const config = parsed.data;
    const { from, to } = timeRangeToDates(config.timeRange);

    const isAggregate = config.configurationType === 'AGGREGATE_CHART';
    const groupBy = isAggregate ? null : config.groupBy;
    const seriesBy =
      config.configurationType === 'BAR_CHART' ||
      config.configurationType === 'LINE_CHART'
        ? (config.seriesBy ?? null)
        : null;
    const granularity =
      config.configurationType === 'BAR_CHART' ||
      config.configurationType === 'LINE_CHART'
        ? (config.dateGranularity ?? defaultGranularity(config.timeRange))
        : 'month';
    const orderBy = isAggregate
      ? 'bucket'
      : (config.orderBy ??
        (config.configurationType === 'PIE_CHART' ? 'value_desc' : 'bucket'));
    const limit = isAggregate ? 50 : (config.limit ?? 50);

    const { data, error } = await ctx.supabase.rpc('chart_aggregate', {
      p_source: config.source,
      p_measure: config.measure,
      p_operation: config.operation,
      p_dimension: groupBy,
      p_granularity: granularity,
      p_series: seriesBy,
      p_series_granularity: granularity,
      p_date_column: null,
      p_from: from,
      p_to: to,
      p_order_by: orderBy,
      p_limit: limit,
    });

    if (error) {
      // Catalog rejections come back as raised exceptions with clear
      // messages ("unknown chart source", "operation not allowed", ...)
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    let rows = (data ?? []) as ChartDataRow[];

    if (config.configurationType === 'LINE_CHART' && config.isCumulative) {
      const running = new Map<string, number>();
      rows = rows.map((row) => {
        const key = row.series ?? '';
        const next = (running.get(key) ?? 0) + row.value;
        running.set(key, next);
        return { ...row, value: next };
      });
    }

    return NextResponse.json({ data: rows });
  } catch (error) {
    return toErrorResponse(error);
  }
}
