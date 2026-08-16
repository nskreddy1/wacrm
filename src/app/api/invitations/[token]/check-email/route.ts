// ============================================================
// POST /api/invitations/[token]/check-email
//
// Public — no auth required, by design: this is called from the
// signup form by someone who does not have an account yet.
//
// Purpose
//   Lets signup refuse to create an account whose address could
//   never accept the invitation being followed. Without this the
//   mismatch surfaced only later, on /join, after Supabase had
//   already created the user and the signup trigger had already
//   bootstrapped an unrelated workspace for them.
//
// Security model
//   - POST, not GET: the candidate address travels in the body, so
//     it stays out of access logs, browser history, and `referer`
//     headers the way a `?email=` query would not.
//   - The plaintext token never crosses the DB boundary — hashed in
//     TS first, looked up by `token_hash`, matching the peek route.
//   - The RPC returns a boolean, never the invited address, so this
//     endpoint cannot be used to read who was invited.
//   - Rate limited per IP. This is the one endpoint that answers a
//     yes/no question about a specific address, so it is the one
//     most worth throttling.
// ============================================================

import { NextResponse } from 'next/server';

import { hashInviteToken } from '@/features/auth/lib/invitations';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { createClient } from '@/lib/supabase/server';

/** Best-effort client IP; mirrors the peek route. */
function getClientIp(request: Request): string {
  const xff = request.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const xri = request.headers.get('x-real-ip');
  if (xri) return xri.trim();
  return 'unknown';
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const ip = getClientIp(request);
  const limit = await checkRateLimit(
    `invite-check-email:${ip}`,
    RATE_LIMITS.invitationPeek
  );
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token || typeof token !== 'string') {
    return NextResponse.json(
      { ok: false, reason: 'not_found', matches: false },
      { status: 404 }
    );
  }

  let email = '';
  try {
    const body = (await request.json()) as { email?: unknown };
    if (typeof body.email === 'string') email = body.email;
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'bad_request', matches: false },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('invitation_email_matches', {
    p_token_hash: hashInviteToken(token),
    p_email: email,
  });

  if (error) {
    console.error('[invite-check-email] rpc error:', error);
    // Fail OPEN here, deliberately. A false "that address is wrong"
    // would block a legitimate invitee from signing up at all, whereas
    // letting signup proceed only risks the pre-existing behaviour —
    // and redeem still enforces the address server-side afterwards.
    // This check exists to prevent a confusing dead end, not to be the
    // security boundary.
    return NextResponse.json(
      { ok: false, reason: 'server_error', matches: true },
      { status: 200 }
    );
  }

  // Per-caller answer about a specific address — never cache it.
  return NextResponse.json(data, {
    headers: { 'cache-control': 'no-store, private' },
  });
}
