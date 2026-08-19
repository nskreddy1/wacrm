// ============================================================
// POST /api/invitations/[token]/redeem
//
// Authenticated. Caller ADDS a membership in the inviter's
// workspace and switches into it, keeping every workspace they
// already belong to (ADR-004 D3 — joining is additive since
// Task 3; it used to move the caller and delete their old
// account). Heavy lifting lives in the SECURITY DEFINER
// `redeem_invitation` RPC.
//
// Refusal contract (verified against the live function)
//   - 42501 'Unauthorized'                  → 401 unauthorized
//   - 42501 '…different email address'      → 403 email_mismatch
//   - 42501 'Confirm your email address…'   → 403 email_unverified
//   - 42501 '…cannot grant ownership'       → 403 forbidden
//   - 22023 not found / used / expired      → 400 invalid
//   - anything else                         → 500 server_error
//
// There is no 409. Redeeming twice is now idempotent, so the
// "your account already has data" refusal — and the dead-end UI
// that told users to sign up with a different email — is gone.
//
// Rate limit (per IP) is the same shape as peek but tighter —
// a successful redeem changes data, and the RPC's data-loss
// guard makes brute-force retries pointless past a few attempts.
// ============================================================

import { NextResponse } from 'next/server';
import type { PostgrestError } from '@supabase/supabase-js';

import { hashInviteToken } from '@/features/auth/lib/invitations';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { canAddResource } from '@/lib/quotas';
import { quotaExceededResponse } from '@/lib/quotas/response';

function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

/**
 * Machine-readable refusal reason. The join page switches on this
 * instead of string-matching the database's prose, so reworded
 * messages can't silently change which UI state the user lands in.
 */
export type RedeemFailureReason =
  | 'unauthorized'
  | 'email_mismatch'
  | 'email_unverified'
  | 'forbidden'
  | 'invalid'
  | 'server_error';

function fail(
  status: number,
  reason: RedeemFailureReason,
  error: string
): NextResponse {
  return NextResponse.json({ error, reason }, { status });
}

/**
 * Map the RPC's SQLSTATE + message onto an HTTP status and a reason.
 *
 * `redeem_invitation` raises exactly two errcodes (verified against the
 * live function), and 42501 covers FOUR distinct situations that need
 * different UI. They are separated here on message because the RPC has
 * no room for a finer code, but the resulting `reason` is what the UI
 * consumes — the prose stays server-side.
 *
 * The distinction matters: an email mismatch is NOT 401. A 401 tells the
 * client "log in", so the invitee logs in again as the same wrong user
 * and loops. It is 403 + email_mismatch — authenticated, but not the
 * addressee.
 *
 * Note 23505 is deliberately absent. Task 3 made re-redemption
 * idempotent, so the old 409 "you already have data, sign up with a
 * different email" dead end can no longer occur; a 23505 arriving here
 * now means an unexpected constraint violation, which is a 500.
 */
function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === '42501') {
    const m = err.message;
    if (m.includes('different email address')) {
      return fail(403, 'email_mismatch', m);
    }
    if (m.includes('Confirm your email address')) {
      return fail(403, 'email_unverified', m);
    }
    if (m.includes('cannot grant ownership')) {
      return fail(403, 'forbidden', m);
    }
    return fail(401, 'unauthorized', m);
  }
  if (err.code === '22023') {
    // not found / already redeemed / expired / legacy link-only invite.
    return fail(400, 'invalid', err.message);
  }
  // Unexpected: log server-side, return a generic message. The raw
  // message can name tables and constraints, which is free schema
  // reconnaissance for an unauthenticated-ish caller.
  console.error('[redeem] unexpected RPC error:', err);
  return fail(500, 'server_error', 'Failed to redeem invitation');
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = getClientIp(request);
  const limit = await checkRateLimit(`redeem:${ip}`, RATE_LIMITS.invitationRedeem);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token || typeof token !== 'string') {
    return NextResponse.json(
      { error: 'Missing invitation token' },
      { status: 400 }
    );
  }

  const supabase = await createClient();

  // The RPC checks `auth.uid()` itself, but failing fast here
  // gives a cleaner 401 without a Supabase round trip on the
  // common "user clicked the link before logging in" path.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Plan quota: seat cap, re-checked at redeem time (the invite may
  // have been created when a seat was free). The lookup needs the
  // service role — the caller isn't a member of the target account
  // yet, so RLS hides the invitation row from their session client.
  const { data: invite } = await supabaseAdmin()
    .from('account_invitations')
    .select('account_id')
    .eq('token_hash', hashInviteToken(token))
    .is('accepted_at', null)
    .maybeSingle();
  if (invite?.account_id) {
    const quota = await canAddResource(
      invite.account_id as string,
      'max_members'
    );
    if (!quota.allowed) {
      return quotaExceededResponse(quota, 'Member seat');
    }
  }

  const { data: accountId, error } = await supabase.rpc('redeem_invitation', {
    p_token_hash: hashInviteToken(token),
  });

  if (error) return rpcErrorToResponse(error);

  return NextResponse.json({ ok: true, accountId });
}
