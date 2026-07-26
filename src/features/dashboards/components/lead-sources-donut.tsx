'use client';

import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import type { LeadSourcePoint } from '@/lib/data/dashboard/types';
import { ChartLegend, ChartTooltipContent } from '@/components/ui/chart';

/** Human labels for raw source keys (kept in sync with lead-sources.tsx). */
const SOURCE_LABELS: Record<string, string> = {
  manual: 'Added manually',
  import: 'CSV import',
  api: 'API',
  api_outbound: 'Outbound (API)',
  whatsapp_inbound: 'WhatsApp inbound',
  sms_inbound: 'SMS inbound',
  web_form: 'Web form',
  referral: 'Referral',
  campaign: 'Campaign',
  other: 'Other',
  unknown: 'Unknown',
};

function labelFor(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, ' ');
}

/** Chart palette, cycled. All values are theme tokens. */
const SLICE_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

/** Slices beyond this are folded into a single "Other" wedge. */
const MAX_SLICES = 5;

/**
 * Donut breakdown of new-lead attribution (last 30 days) with the
 * total rendered in the middle. Long tails collapse into "Other" so
 * the ring stays readable.
 */
export function LeadSourcesDonut({ data }: { data: LeadSourcePoint[] }) {
  const { slices, total } = useMemo(() => {
    const sum = data.reduce((acc, d) => acc + d.count, 0);
    if (data.length <= MAX_SLICES) {
      return {
        slices: data.map((d) => ({ name: labelFor(d.source), value: d.count })),
        total: sum,
      };
    }
    const head = data.slice(0, MAX_SLICES - 1).map((d) => ({
      name: labelFor(d.source),
      value: d.count,
    }));
    const tail = data
      .slice(MAX_SLICES - 1)
      .reduce((acc, d) => acc + d.count, 0);
    return {
      slices: tail > 0 ? [...head, { name: 'Other', value: tail }] : head,
      total: sum,
    };
  }, [data]);

  if (total === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-xs">
        No new leads in the last 30 days.
      </p>
    );
  }

  const legend = slices.map((s, i) => ({
    label: s.name,
    color: SLICE_COLORS[i % SLICE_COLORS.length],
  }));

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="relative h-48 w-full">
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
                  fill={SLICE_COLORS[i % SLICE_COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              isAnimationActive={false}
              content={
                <ChartTooltipContent
                  valueFormatter={(v) =>
                    `${v.toLocaleString('en')} (${Math.round((v / total) * 100)}%)`
                  }
                />
              }
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Center total — pointer-events-none so the ring stays hoverable. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-foreground text-2xl font-semibold tabular-nums">
            {total.toLocaleString('en')}
          </span>
          <span className="text-muted-foreground text-xs">new leads</span>
        </div>
      </div>
      <ChartLegend items={legend} className="justify-center" />
    </div>
  );
}
