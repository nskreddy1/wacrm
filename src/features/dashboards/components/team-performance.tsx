'use client';

import { AnimatedBar } from '@/components/ui/animated-bar';
import { ChartLegend } from '@/components/ui/chart';

type TeamPerformanceProps = {
  team: Array<{
    userId: string;
    name: string;
    open: number;
    resolved7d: number;
  }>;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** Per-agent workload: open conversations vs resolved (7d) as paired bars. */
export function TeamPerformance({ team }: TeamPerformanceProps) {
  const max = Math.max(...team.map((m) => Math.max(m.open, m.resolved7d)), 1);
  return (
    <div className="flex h-full flex-col gap-4">
      <ChartLegend
        items={[
          { label: 'Open now', color: 'var(--primary)' },
          { label: 'Resolved (7d)', color: 'var(--positive)' },
        ]}
      />
      <div className="flex flex-1 flex-col gap-3.5">
        {team.map((member) => (
          <div key={member.userId} className="flex items-center gap-3">
            <div
              className="bg-primary-soft text-primary flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
              aria-hidden="true"
            >
              {initials(member.name)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-[13px] font-medium">
                  {member.name}
                </p>
                <p
                  className="text-muted-foreground shrink-0 text-[11px]"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {member.open} open · {member.resolved7d} resolved
                </p>
              </div>
              <div className="mt-1.5 flex flex-col gap-1">
                <AnimatedBar
                  percent={Math.max((member.open / max) * 100, 2)}
                  color="var(--primary)"
                />
                <AnimatedBar
                  percent={Math.max((member.resolved7d / max) * 100, 2)}
                  color="var(--positive)"
                  delay={0.08}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
