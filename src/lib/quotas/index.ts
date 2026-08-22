import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Quota engine (Phase 0.2).
 *
 * Answers one question for service-role code paths: "may this account
 * do X right now?" — where X is either adding a point-in-time resource
 * (contact, flow, member, channel) or consuming a monthly-metered
 * action (message, broadcast recipient, AI reply).
 *
 * Point-in-time limits are counted LIVE from source tables (no counter
 * drift). Monthly metrics read/write `usage_counters` via the atomic
 * `increment_usage` Postgres function.
 *
 * FAILURE MODE: quota checks FAIL OPEN. If the quota lookup itself
 * errors (network, schema), we allow the action and log — quota
 * enforcement is a business bound, not a security control, and a
 * broken limiter must never take down messaging for paying tenants.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PointInTimeLimit =
  | 'max_contacts'
  | 'max_active_flows'
  | 'max_members'
  | 'max_channels';

export type MonthlyMetric =
  | 'messages_sent'
  | 'broadcast_recipients'
  | 'ai_replies';

/** Maps a monthly metric to its limit column on `plans`. */
const METRIC_LIMIT_COLUMN: Record<MonthlyMetric, string> = {
  messages_sent: 'monthly_messages',
  broadcast_recipients: 'monthly_broadcast_recipients',
  ai_replies: 'monthly_ai_replies',
};

/** Maps a point-in-time limit to the live count query. */
const LIVE_COUNTS: Record<
  PointInTimeLimit,
  { table: string; filter?: Record<string, unknown> }
> = {
  max_contacts: { table: 'contacts' },
  max_active_flows: { table: 'flows', filter: { status: 'active' } },
  max_members: { table: 'profiles', filter: { status: 'active' } },
  max_channels: { table: 'channel_connections' },
};

export interface QuotaDecision {
  allowed: boolean;
  /** NULL limit = unlimited plan. */
  limit: number | null;
  used: number;
  remaining: number | null;
  reason?: 'quota_exceeded' | 'check_failed';
}

// ---------------------------------------------------------------------------
// Client (same lazy service-role convention as flows/admin-client.ts)
// ---------------------------------------------------------------------------

/**
 * Test override only. When null, quota checks use the process-wide
 * service-role client from `@/lib/supabase/admin`, so the env-alias
 * resolution lives in exactly one place (`@/lib/env`).
 */
let _client: SupabaseClient | null = null;

function admin(): SupabaseClient {
  return _client ?? supabaseAdmin();
}

/** Test seam. */
export function __setQuotaClientForTests(client: SupabaseClient | null) {
  _client = client;
}

// ---------------------------------------------------------------------------
// Limit resolution: override row (if any) beats plan value
//
// Override semantics (migration 20260726140000):
//   unlimited_all = true -> every limit is unlimited (VIP/internal account)
//   column = -1          -> that ONE feature is unlimited
//   column = NULL        -> no override, fall back to the plan value
//   column = N >= 0      -> hard per-account cap of N
// ---------------------------------------------------------------------------

/** Sentinel stored in override columns meaning "unlimited for this feature". */
export const UNLIMITED_SENTINEL = -1;

async function resolveLimit(
  accountId: string,
  column: string
): Promise<number | null> {
  const db = admin();

  const [{ data: override }, { data: account }] = await Promise.all([
    db
      .from('account_limit_overrides')
      .select(`${column}, unlimited_all`)
      .eq('account_id', accountId)
      .maybeSingle(),
    db.from('accounts').select('plan_id').eq('id', accountId).single(),
  ]);

  const overrideRow = override as
    | ({ unlimited_all?: boolean } & Record<string, number | boolean | null>)
    | null;
  if (overrideRow?.unlimited_all) return null;

  const overrideValue = overrideRow?.[column] as number | null | undefined;
  if (overrideValue !== undefined && overrideValue !== null) {
    return overrideValue === UNLIMITED_SENTINEL ? null : overrideValue;
  }

  const planId = (account as { plan_id?: string } | null)?.plan_id ?? 'free';
  const { data: plan, error } = await db
    .from('plans')
    .select(column)
    .eq('id', planId)
    .single();
  if (error) throw error;

  // Dynamic column selects defeat supabase-js's string-literal type
  // parser (it infers GenericStringError) — bridge through unknown.
  return (plan as unknown as Record<string, number | null>)[column];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * May `accountId` add `amount` more of a point-in-time resource?
 * Counts live from the source table; NULL limit = unlimited.
 */
export async function canAddResource(
  accountId: string,
  limitKey: PointInTimeLimit,
  amount = 1
): Promise<QuotaDecision> {
  try {
    const limit = await resolveLimit(accountId, limitKey);
    const { table, filter } = LIVE_COUNTS[limitKey];

    let query = admin()
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('account_id', accountId);
    for (const [k, v] of Object.entries(filter ?? {})) {
      query = query.eq(k, v as string);
    }
    const { count, error } = await query;
    if (error) throw error;

    const used = count ?? 0;
    if (limit === null) {
      return { allowed: true, limit: null, used, remaining: null };
    }
    const allowed = used + amount <= limit;
    return {
      allowed,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      ...(allowed ? {} : { reason: 'quota_exceeded' as const }),
    };
  } catch (error) {
    console.warn(`[quotas] ${limitKey} check failed, failing open`, error);
    return {
      allowed: true,
      limit: null,
      used: 0,
      remaining: null,
      reason: 'check_failed',
    };
  }
}

/**
 * May `accountId` consume `amount` units of a monthly metric this month?
 * Read-only — does NOT increment. Call `consumeMonthlyQuota` to commit.
 */
export async function checkMonthlyQuota(
  accountId: string,
  metric: MonthlyMetric,
  amount = 1
): Promise<QuotaDecision> {
  try {
    const limit = await resolveLimit(accountId, METRIC_LIMIT_COLUMN[metric]);

    const periodStart = new Date();
    const period = `${periodStart.getUTCFullYear()}-${String(periodStart.getUTCMonth() + 1).padStart(2, '0')}-01`;

    const { data, error } = await admin()
      .from('usage_counters')
      .select('used')
      .eq('account_id', accountId)
      .eq('metric', metric)
      .eq('period_start', period)
      .maybeSingle();
    if (error) throw error;

    const used = data?.used ?? 0;
    if (limit === null) {
      return { allowed: true, limit: null, used, remaining: null };
    }
    const allowed = used + amount <= limit;
    return {
      allowed,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      ...(allowed ? {} : { reason: 'quota_exceeded' as const }),
    };
  } catch (error) {
    console.warn(`[quotas] ${metric} check failed, failing open`, error);
    return {
      allowed: true,
      limit: null,
      used: 0,
      remaining: null,
      reason: 'check_failed',
    };
  }
}

/**
 * Atomically record consumption of a monthly metric (via the
 * `increment_usage` Postgres function — safe under concurrency).
 * Returns the new `used` value, or null if the write failed (logged,
 * never thrown: metering loss must not fail the user's action).
 */
export async function consumeMonthlyQuota(
  accountId: string,
  metric: MonthlyMetric,
  amount = 1
): Promise<number | null> {
  try {
    const { data, error } = await admin().rpc('increment_usage', {
      p_account_id: accountId,
      p_metric: metric,
      p_amount: amount,
    });
    if (error) throw error;
    return data as number;
  } catch (error) {
    console.warn(`[quotas] failed to record ${metric} usage`, error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Usage summary (Settings -> Plan & usage, and the admin console)
// ---------------------------------------------------------------------------

/** One row of the account's plan allowance vs. current consumption. */
export interface UsageSummaryRow {
  /** Limit column on `plans` / `account_limit_overrides`. */
  key: string;
  label: string;
  kind: 'point_in_time' | 'monthly';
  /** null = unlimited. */
  limit: number | null;
  used: number;
  /** Where the effective limit came from. */
  source: 'plan' | 'override' | 'unlimited_all';
}

export interface AccountUsageSummary {
  planId: string;
  planName: string;
  /** True when any per-account override applies — surface as "Custom". */
  isCustom: boolean;
  unlimitedAll: boolean;
  /** First day of the current UTC billing month (YYYY-MM-DD). */
  periodStart: string;
  rows: UsageSummaryRow[];
}

const SUMMARY_ROWS: Array<
  | { key: PointInTimeLimit; label: string; kind: 'point_in_time' }
  | { key: string; label: string; kind: 'monthly'; metric: MonthlyMetric }
> = [
  { key: 'max_contacts', label: 'Contacts', kind: 'point_in_time' },
  { key: 'max_active_flows', label: 'Active flows', kind: 'point_in_time' },
  { key: 'max_members', label: 'Member seats', kind: 'point_in_time' },
  { key: 'max_channels', label: 'Connected channels', kind: 'point_in_time' },
  {
    key: 'monthly_messages',
    label: 'Messages',
    kind: 'monthly',
    metric: 'messages_sent',
  },
  {
    key: 'monthly_broadcast_recipients',
    label: 'Broadcast recipients',
    kind: 'monthly',
    metric: 'broadcast_recipients',
  },
  {
    key: 'monthly_ai_replies',
    label: 'AI replies',
    kind: 'monthly',
    metric: 'ai_replies',
  },
];

/** First day of the current UTC month, as a Postgres date string. */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Every limit + current usage for one account in a fixed number of
 * round trips: plan, override and monthly counters are each fetched
 * ONCE (not per-limit, which `resolveLimit` would do), then the four
 * live counts run in parallel.
 *
 * Unlike the enforcement helpers this throws on failure — it backs a
 * read-only screen, where a wrong number is worse than an error state.
 */
export async function getAccountUsageSummary(
  accountId: string
): Promise<AccountUsageSummary> {
  const db = admin();
  const period = currentPeriod();

  const { data: account, error: accountError } = await db
    .from('accounts')
    .select('plan_id')
    .eq('id', accountId)
    .single();
  if (accountError) throw accountError;
  const planId = (account as { plan_id?: string } | null)?.plan_id ?? 'free';

  const [
    { data: plan, error: planError },
    { data: override, error: overrideError },
    { data: counters, error: countersError },
  ] = await Promise.all([
    db.from('plans').select('*').eq('id', planId).single(),
    db
      .from('account_limit_overrides')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle(),
    db
      .from('usage_counters')
      .select('metric, used')
      .eq('account_id', accountId)
      .eq('period_start', period),
  ]);
  if (planError) throw planError;
  if (overrideError) throw overrideError;
  if (countersError) throw countersError;

  const planRow = (plan ?? {}) as Record<string, unknown>;
  const overrideRow = (override ?? null) as Record<string, unknown> | null;
  const unlimitedAll = overrideRow?.unlimited_all === true;

  const usedByMetric = new Map<string, number>(
    ((counters ?? []) as Array<{ metric: string; used: number }>).map((c) => [
      c.metric,
      c.used,
    ])
  );

  // Live counts for the point-in-time limits, all in flight together.
  const liveKeys = SUMMARY_ROWS.filter(
    (r) => r.kind === 'point_in_time'
  ) as Array<{ key: PointInTimeLimit }>;
  const liveCounts = await Promise.all(
    liveKeys.map(async ({ key }) => {
      const { table, filter } = LIVE_COUNTS[key];
      let query = db
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('account_id', accountId);
      for (const [k, v] of Object.entries(filter ?? {})) {
        query = query.eq(k, v as string);
      }
      const { count, error } = await query;
      if (error) throw error;
      return [key, count ?? 0] as const;
    })
  );
  const usedByResource = new Map<string, number>(liveCounts);

  const rows: UsageSummaryRow[] = SUMMARY_ROWS.map((row) => {
    const overrideValue = overrideRow?.[row.key] as number | null | undefined;
    const hasOverride = overrideValue !== undefined && overrideValue !== null;

    let limit: number | null;
    let source: UsageSummaryRow['source'];
    if (unlimitedAll) {
      limit = null;
      source = 'unlimited_all';
    } else if (hasOverride) {
      limit = overrideValue === UNLIMITED_SENTINEL ? null : overrideValue;
      source = 'override';
    } else {
      limit = (planRow[row.key] as number | null) ?? null;
      source = 'plan';
    }

    const used =
      row.kind === 'monthly'
        ? (usedByMetric.get(row.metric) ?? 0)
        : (usedByResource.get(row.key) ?? 0);

    return { key: row.key, label: row.label, kind: row.kind, limit, used, source };
  });

  return {
    planId,
    planName: (planRow.display_name as string) ?? planId,
    isCustom: unlimitedAll || rows.some((r) => r.source === 'override'),
    unlimitedAll,
    periodStart: period,
    rows,
  };
}

/**
 * Convenience: check-then-consume in one call for the common
 * "send one thing" path. NOT transactional across concurrent callers
 * (a burst can slightly overshoot the cap); acceptable for business
 * quotas, revisit if hard caps are ever needed.
 */
export async function tryConsume(
  accountId: string,
  metric: MonthlyMetric,
  amount = 1
): Promise<QuotaDecision> {
  const decision = await checkMonthlyQuota(accountId, metric, amount);
  if (decision.allowed && decision.reason !== 'check_failed') {
    await consumeMonthlyQuota(accountId, metric, amount);
  }
  return decision;
}
