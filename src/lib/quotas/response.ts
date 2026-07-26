import { NextResponse } from 'next/server';
import type { QuotaDecision } from '@/lib/quotas';

/**
 * Standard HTTP shape for "your plan doesn't allow more of X".
 *
 * 402 (Payment Required) — deliberately distinct from 429: 429 means
 * "slow down, retry soon" (rate limit) while 402 means "upgrade your
 * plan" (business quota). Clients branch on `code: 'quota_exceeded'`.
 */
export function quotaExceededResponse(
  decision: QuotaDecision,
  label: string
): NextResponse {
  return NextResponse.json(
    {
      error:
        decision.limit !== null
          ? `${label} limit reached (${decision.used}/${decision.limit} used this ${
              label.startsWith('Monthly') ? 'month' : 'plan'
            }). Upgrade your plan to continue.`
          : `${label} limit reached. Upgrade your plan to continue.`,
      code: 'quota_exceeded',
      limit: decision.limit,
      used: decision.used,
      remaining: decision.remaining,
    },
    { status: 402 }
  );
}
