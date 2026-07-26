import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  toErrorResponse,
} from '@/features/auth/lib/account';
import type {
  ChartDimensionMeta,
  ChartMeasureMeta,
  ChartSourceMeta,
} from '@/features/dashboards/lib/chart-config';

export const dynamic = 'force-dynamic';

type SourceRow = {
  source_key: string;
  label: string;
};

type DimensionRow = {
  source_key: string;
  dimension_key: string;
  label: string;
  kind: ChartDimensionMeta['kind'];
  position: number;
};

type MeasureRow = {
  source_key: string;
  measure_key: string;
  label: string;
  kind: ChartMeasureMeta['kind'];
  position: number;
};

/**
 * GET /api/v1/dashboard/chart-sources
 *
 * Returns the chart catalog (sources + their dimensions and measures)
 * for the widget config form. Module names are customizable per
 * account in Settings (module_field_settings), so source labels are
 * overridden with the account's custom names when present.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const [sourcesRes, dimensionsRes, measuresRes, labelsRes] =
      await Promise.all([
        ctx.supabase
          .from('chart_sources')
          .select('source_key, label')
          .order('position'),
        ctx.supabase
          .from('chart_dimensions')
          .select('source_key, dimension_key, label, kind, position')
          .order('position'),
        ctx.supabase
          .from('chart_measures')
          .select('source_key, measure_key, label, kind, position')
          .order('position'),
        // Custom module names from Settings — layout jsonb may carry a
        // `moduleLabel` the account set for this module.
        ctx.supabase
          .from('module_field_settings')
          .select('module, layout')
          .eq('account_id', ctx.accountId),
      ]);

    if (sourcesRes.error) throw sourcesRes.error;
    if (dimensionsRes.error) throw dimensionsRes.error;
    if (measuresRes.error) throw measuresRes.error;
    // Label overrides are best-effort; ignore read errors.

    const customLabels = new Map<string, string>();
    for (const row of labelsRes.data ?? []) {
      const layout = row.layout as { moduleLabel?: unknown } | null;
      if (layout && typeof layout.moduleLabel === 'string') {
        customLabels.set(row.module, layout.moduleLabel);
      }
    }

    const dimensions = (dimensionsRes.data ?? []) as DimensionRow[];
    const measures = (measuresRes.data ?? []) as MeasureRow[];

    const sources: ChartSourceMeta[] = ((sourcesRes.data ?? []) as SourceRow[]).map(
      (s) => ({
        key: s.source_key,
        label: customLabels.get(s.source_key) ?? s.label,
        dimensions: dimensions
          .filter((d) => d.source_key === s.source_key)
          .map((d) => ({ key: d.dimension_key, label: d.label, kind: d.kind })),
        measures: measures
          .filter((m) => m.source_key === s.source_key)
          .map((m) => ({ key: m.measure_key, label: m.label, kind: m.kind })),
      })
    );

    return NextResponse.json({ data: sources });
  } catch (error) {
    return toErrorResponse(error);
  }
}
