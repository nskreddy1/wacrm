'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { SalesTrendPoint } from '@/lib/data/dashboard/types';
import { ChartLegend, ChartTooltipContent } from '@/components/ui/chart';

const monthFormatter = new Intl.DateTimeFormat('en', { month: 'short' });

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return monthFormatter.format(new Date(y, m - 1, 1));
}

/**
 * Won vs lost deal counts per month as grouped bars — the win/loss
 * companion to SalesTrendLine (which shows value, not counts).
 */
export function SalesOutcomeBar({ data }: { data: SalesTrendPoint[] }) {
  const hasAny = data.some((d) => d.wonCount > 0 || d.lostCount > 0);
  if (!hasAny) {
    return (
      <p className="text-muted-foreground py-6 text-center text-xs">
        No closed deals in the last 6 months.
      </p>
    );
  }

  const chartData = data.map((d) => ({ ...d, label: monthLabel(d.month) }));

  return (
    <div className="flex h-full flex-col gap-3">
      <ChartLegend
        items={[
          { label: 'Won', color: 'var(--positive)' },
          { label: 'Lost', color: 'var(--chart-4)' },
        ]}
      />
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 0, bottom: 0, left: -18 }}
            barCategoryGap="26%"
            barGap={4}
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
              width={40}
              allowDecimals={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <Tooltip
              cursor={{
                fill: 'color-mix(in oklch, var(--foreground) 5%, transparent)',
              }}
              isAnimationActive={false}
              content={
                <ChartTooltipContent
                  labels={{ wonCount: 'Won', lostCount: 'Lost' }}
                />
              }
            />
            <Bar
              dataKey="wonCount"
              fill="var(--positive)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="lostCount"
              fill="var(--chart-4)"
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
