'use client';

/**
 * Agent Activity — the merged "Run History + Usage" tab.
 *
 * One per-agent view: a 14-day token/run chart on top (scoped to THIS
 * agent's surface via the ?mode= filter) with the recent runs table
 * below it. Replaces the old separate Run History and Usage tabs,
 * which showed near-identical account-wide data on both agents.
 */

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
import { swrJson, AGENT_KIND_META, type AgentKind } from '../lib/agent-meta';

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

export function AgentActivity({ agent }: { agent: AgentKind }) {
  const mode = AGENT_KIND_META[agent].mode;

  const { data: usage, isLoading: usageLoading } = useSWR<UsageResponse>(
    `/api/ai/usage?days=14&mode=${mode}`,
    swrJson
  );
  const { data: runsData, isLoading: runsLoading } = useSWR<{
    runs: RunRow[];
  }>(`/api/ai/runs?limit=25&mode=${mode}`, swrJson);

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
                  formatter={(value: number, name: string) => [
                    value.toLocaleString(),
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
            {agent === 'autoreply'
              ? 'Runs appear here when the Auto-Reply Agent answers a customer.'
              : 'Runs appear here when the Copilot drafts a reply for your team.'}
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
