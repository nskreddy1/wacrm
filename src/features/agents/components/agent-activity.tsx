'use client';

/**
 * Agent Activity — the merged "Run History + Usage" tab.
 *
 * The single agent's runs across both capabilities: a 14-day
 * token/run chart on top with the recent runs table below, plus a
 * capability filter (All / AI suggestions / Auto-reply) that maps to
 * the ?mode= param. Replaces the old separate Run History and Usage
 * tabs, which showed near-identical data.
 */

import { useState } from 'react';
import useSWR from 'swr';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { swrJson } from '../lib/agent-meta';

type ModeFilter = 'all' | 'draft' | 'auto_reply';

const MODE_FILTERS: { key: ModeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'AI suggestions' },
  { key: 'auto_reply', label: 'Auto-reply' },
];

interface RunRow {
  id: string;
  conversation_id: string | null;
  mode: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  created_at: string;
}

interface UsageDay {
  date: string;
  tokens: number;
  calls: number;
}

interface UsageResponse {
  daily: UsageDay[];
  totals?: { calls: number; total_tokens: number };
}

function shortId(id: string): string {
  return `RUN-${id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return today
    ? `${time} Today`
    : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export function AgentActivity() {
  const [filter, setFilter] = useState<ModeFilter>('all');
  const modeParam = filter === 'all' ? '' : `&mode=${filter}`;

  const { data: usage, isLoading: usageLoading } = useSWR<UsageResponse>(
    `/api/ai/usage?days=14${modeParam}`,
    swrJson
  );
  const { data: runsData, isLoading: runsLoading } = useSWR<{
    runs: RunRow[];
  }>(`/api/ai/runs?limit=25${modeParam}`, swrJson);

  const runs = runsData?.runs ?? [];
  const days = usage?.daily ?? [];
  const hasActivity = days.some((d) => d.calls > 0);
  const totalRuns = usage?.totals?.calls ?? runs.length;
  const totalTokens =
    usage?.totals?.total_tokens ?? days.reduce((sum, d) => sum + d.tokens, 0);

  if (usageLoading || runsLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-56 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Capability filter */}
      <div
        role="group"
        aria-label="Filter activity by capability"
        className="flex gap-1.5"
      >
        {MODE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              filter === f.key
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Summary + chart */}
      <section className="border-border bg-card rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Activity — last 14 days
          </h3>
          <div className="text-muted-foreground flex items-center gap-4 text-xs">
            <span>
              <span className="text-foreground font-semibold">
                {totalRuns}
              </span>{' '}
              runs
            </span>
            <span>
              <span className="text-foreground font-semibold">
                {totalTokens.toLocaleString()}
              </span>{' '}
              tokens
            </span>
          </div>
        </div>
        {!hasActivity ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            No activity yet. Once this agent runs, its daily volume shows
            here.
          </p>
        ) : (
          <div className="mt-3 h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={days}
                margin={{ top: 4, right: 4, bottom: 0, left: -16 }}
              >
                <defs>
                  <linearGradient id="agentTokens" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="hsl(var(--primary))"
                      stopOpacity={0.25}
                    />
                    <stop
                      offset="100%"
                      stopColor="hsl(var(--primary))"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="hsl(var(--border))"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value, name) => [
                    Number(value ?? 0).toLocaleString(),
                    name === 'tokens' ? 'Tokens' : 'Runs',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="tokens"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#agentTokens)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Recent runs table */}
      <section className="border-border bg-card rounded-lg border p-4">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Recent runs
        </h3>
        {runs.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            Runs appear here when the agent drafts a suggestion or replies to
            a customer.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-border border-b text-left text-xs uppercase">
                  <th className="py-2 pr-4 font-medium">Run</th>
                  <th className="py-2 pr-4 font-medium">Triggered</th>
                  <th className="py-2 pr-4 font-medium">Model</th>
                  <th className="py-2 pr-4 text-right font-medium">
                    Input tkns
                  </th>
                  <th className="py-2 pr-4 text-right font-medium">
                    Output tkns
                  </th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    className="border-border/60 border-b last:border-0"
                  >
                    <td className="text-foreground py-2.5 pr-4 font-mono text-xs">
                      {shortId(run.id)}
                    </td>
                    <td className="text-muted-foreground py-2.5 pr-4 text-xs">
                      {timeLabel(run.created_at)}
                    </td>
                    <td className="text-muted-foreground py-2.5 pr-4 text-xs">
                      {run.model}
                    </td>
                    <td className="text-foreground py-2.5 pr-4 text-right text-xs tabular-nums">
                      {run.prompt_tokens.toLocaleString()}
                    </td>
                    <td className="text-foreground py-2.5 pr-4 text-right text-xs tabular-nums">
                      {run.completion_tokens.toLocaleString()}
                    </td>
                    <td className="py-2.5">
                      <Badge
                        variant="outline"
                        className="border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-600 dark:text-emerald-400"
                      >
                        Success
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
