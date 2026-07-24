// ============================================================
// POST /api/account/domains/[id]/verify
//
// Verifies domain ownership via DNS TXT record. The admin adds
//   wacrm-verify=<token>
// as a TXT record on their domain; we resolve the records here
// (server-side — clients can't be trusted to do DNS) and, on
// match, flip `verified` through the SECURITY DEFINER RPC.
// RLS intentionally blocks any other path to verified=TRUE.
// ============================================================

import { resolveTxt } from 'node:dns/promises';

import { NextResponse } from 'next/server';

import {
  requirePermission,
  toErrorResponse,
} from '@/features/auth/lib/account';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePermission('settings:manage');
    const { id } = await params;

    const { data: domain, error } = await ctx.supabase
      .from('account_domains')
      .select('id, domain, verified, verification_token')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .single();
    if (error || !domain) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 });
    }
    if (domain.verified) {
      return NextResponse.json({ verified: true });
    }

    const expected = `wacrm-verify=${domain.verification_token}`;
    let matched = false;
    try {
      // TXT chunks may be split; join each record's chunks first.
      const records = await resolveTxt(domain.domain);
      matched = records.some((chunks) => chunks.join('') === expected);
    } catch {
      // NXDOMAIN / no TXT records — treated as not verified.
      matched = false;
    }

    if (!matched) {
      return NextResponse.json(
        {
          verified: false,
          error: 'TXT record not found',
          expectedRecord: expected,
        },
        { status: 422 }
      );
    }

    const { error: rpcError } = await ctx.supabase.rpc(
      'mark_account_domain_verified',
      { p_domain_id: domain.id }
    );
    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    return NextResponse.json({ verified: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
