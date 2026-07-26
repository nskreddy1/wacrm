import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  toErrorResponse,
} from '@/features/auth/lib/account';
import { getAccountUsageSummary } from '@/lib/quotas';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/workspace/usage
 *
 * The caller's OWN plan allowance vs. current consumption, for
 * Settings -> Plan & usage.
 *
 * Security: the account id comes from the authenticated session
 * (`getCurrentAccount`), never from the query string — a tenant can
 * only ever read its own usage. Any member may read it (viewer and
 * up); it exposes no other tenant's data and no credentials.
 */
export async function GET() {
  try {
    const context = await getCurrentAccount();
    const summary = await getAccountUsageSummary(context.accountId);
    return NextResponse.json({ data: summary });
  } catch (error) {
    return toErrorResponse(error);
  }
}
