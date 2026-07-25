import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  toErrorResponse,
} from '@/features/auth/lib/account';

export const dynamic = 'force-dynamic';

/**
 * Recent login activity for the signed-in user — successes and
 * failures with IP and location. Reads through the user's own client:
 * the RLS policy on auth_login_attempts restricts rows to
 * auth.uid() = user_id, so no cross-user leakage is possible.
 */
export async function GET() {
  try {
    const context = await getCurrentAccount();

    const { data, error } = await context.supabase
      .from('auth_login_attempts')
      .select('id, success, ip_address, city, region, country, created_at')
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;

    return NextResponse.json({
      data: (data ?? []).map((row) => ({
        id: row.id,
        success: row.success,
        ip_address: row.ip_address,
        location: [row.city, row.region, row.country]
          .filter(Boolean)
          .join(', '),
        created_at: row.created_at,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
