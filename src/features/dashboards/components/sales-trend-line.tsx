'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { SalesTrendPoint } from '@/lib/data/dashboard/types';
import { ChartLegend, ChartTooltipContent } from '@/components/ui/chart';

const monthFormatter = new Intl.DateTimeFormat('en', { month: 'short' });

function monthLabel(month: string): string {
  // month is `yyyy-mm`; build a real date to get a localized short name.
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return monthFormatter.format(new Date(y, m - 1, 1));
}

/**
 * 6-month won-revenue trend as a line chart. Compact currency ticks
 * keep the axis narrow inside a dashboard widget.
 */
export function SalesTrendLine({
  data,
  currency,
}: {
  data: SalesTrendPoint[];
  currency: string;
}) {
  if (data.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-xs">
        No closed deals in the last 6 months.
      </p>
    );
  }

  const chartData = data.map((d) => ({ ...d, label: monthLabel(d.month) }));

  const money = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  });
  const compact = new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  });

  return (
    <div className="flex h-full flex-col gap-3">
      <ChartLegend
        items={[{ label: 'Won value', color: 'var(--chart-1)' }]}
      />
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={chartData}
            margin={{ top: 4, right: 6, bottom: 0, left: -6 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--border)"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={56}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              tickFormatter={(v: number) => compact.format(v)}
            />
            <Tooltip
              cursor={{ stroke: 'var(--border)' }}
              isAnimationActive={false}
              content={
                <ChartTooltipContent
                  labels={{ wonValue: 'Won value' }}
                  valueFormatter={(v) => money.format(v)}
                />
              }
            />
            <Line
              type="monotone"
              dataKey="wonValue"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--chart-1)', strokeWidth: 0 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
