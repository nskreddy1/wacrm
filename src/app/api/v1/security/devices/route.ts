import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  getCurrentAccount,
  toErrorResponse,
} from '@/features/auth/lib/account';
import { channelAdmin } from '@/features/channels/lib/admin-client';

export const dynamic = 'force-dynamic';

/**
 * Device / session tracking (EspoCRM "Auth Log" pattern).
 *
 * GET    — list this user's known devices (RLS-safe read via admin,
 *          scoped by user_id) with the current session flagged.
 * POST   — "touch": upsert the caller's current session as a device
 *          row (user agent + IP + last_seen). Called once per app load.
 * DELETE — revoke one session: kills the refresh token server-side
 *          via a locked-down SECURITY DEFINER function and marks the
 *          device row revoked. The access token dies at JWT expiry.
 */

async function currentSessionId(
  supabase: Awaited<ReturnType<typeof getCurrentAccount>>['supabase']
): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  const sid = data?.claims.session_id;
  return typeof sid === 'string' ? sid : null;
}

function clientMeta(request: NextRequest) {
  const userAgent = request.headers.get('user-agent')?.slice(0, 512) ?? null;
  const forwarded = request.headers.get('x-forwarded-for');
  // First hop of x-forwarded-for is the client.
  const ip = forwarded?.split(',')[0]?.trim().slice(0, 64) ?? null;
  // Vercel edge geo headers (city is URI-encoded).
  const rawCity = request.headers.get('x-vercel-ip-city');
  let city: string | null = null;
  if (rawCity) {
    try {
      city = decodeURIComponent(rawCity).slice(0, 128);
    } catch {
      city = rawCity.slice(0, 128);
    }
  }
  const region =
    request.headers.get('x-vercel-ip-country-region')?.slice(0, 128) ?? null;
  const country =
    request.headers.get('x-vercel-ip-country')?.slice(0, 8) ?? null;
  return { userAgent, ip, city, region, country };
}

export async function GET() {
  try {
    const context = await getCurrentAccount();
    const sessionId = await currentSessionId(context.supabase);

    const { data, error } = await channelAdmin()
      .from('auth_devices')
      .select(
        'id, session_id, user_agent, ip_address, city, region, country, created_at, last_seen_at, revoked_at'
      )
      .eq('user_id', context.userId)
      .is('revoked_at', null)
      .order('last_seen_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    return NextResponse.json({
      data: (data ?? []).map((row) => ({
        id: row.id,
        user_agent: row.user_agent,
        ip_address: row.ip_address,
        location: [row.city, row.region, row.country]
          .filter(Boolean)
          .join(', '),
        created_at: row.created_at,
        last_seen_at: row.last_seen_at,
        is_current: row.session_id === sessionId,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await getCurrentAccount();
    const sessionId = await currentSessionId(context.supabase);
    if (!sessionId) {
      return NextResponse.json({ error: 'No active session' }, { status: 401 });
    }
    const { userAgent, ip, city, region, country } = clientMeta(request);

    const { error } = await channelAdmin()
      .from('auth_devices')
      .upsert(
        {
          user_id: context.userId,
          session_id: sessionId,
          user_agent: userAgent,
          ip_address: ip,
          city,
          region,
          country,
          last_seen_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: 'session_id' }
      );
    if (error) throw error;

    return NextResponse.json({ data: { recorded: true } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * PATCH — "sign out everywhere": the server-side token blacklist.
 * Deletes every auth.sessions row for the caller (except the current
 * session when keepCurrent), which revokes all refresh tokens at the
 * source — no other device can mint a new access token. Outstanding
 * access tokens die at JWT expiry. All device rows are marked revoked
 * in the same pass.
 */
export async function PATCH(request: NextRequest) {
  try {
    const context = await getCurrentAccount();
    const body = (await request.json().catch(() => ({}))) as {
      keepCurrent?: boolean;
    };
    const keepCurrent = body.keepCurrent !== false;
    const sessionId = await currentSessionId(context.supabase);

    const admin = channelAdmin();
    const { data: revokedCount, error: rpcError } = await admin.rpc(
      'admin_revoke_all_auth_sessions',
      {
        p_user_id: context.userId,
        p_keep_session_id: keepCurrent ? sessionId : null,
      }
    );
    if (rpcError) throw rpcError;

    // Mark device rows revoked (all, or all-but-current).
    let markQuery = admin
      .from('auth_devices')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', context.userId)
      .is('revoked_at', null);
    if (keepCurrent && sessionId) {
      markQuery = markQuery.neq('session_id', sessionId);
    }
    const { error: markError } = await markQuery;
    if (markError) throw markError;

    return NextResponse.json({
      data: { revoked: revokedCount ?? 0, keptCurrent: keepCurrent },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

const deleteSchema = z.object({ deviceId: z.string().uuid() });

export async function DELETE(request: NextRequest) {
  try {
    const context = await getCurrentAccount();
    const parsed = deleteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid device id' }, { status: 400 });
    }

    const admin = channelAdmin();
    // Ownership check: the device row must belong to the caller.
    const { data: device, error: readError } = await admin
      .from('auth_devices')
      .select('id, session_id, user_id')
      .eq('id', parsed.data.deviceId)
      .eq('user_id', context.userId)
      .maybeSingle();
    if (readError) throw readError;
    if (!device) {
      return NextResponse.json({ error: 'Device not found' }, { status: 404 });
    }

    // Kill the refresh token (auth.sessions row) — scoped by user id
    // inside the function as defense in depth.
    const { error: rpcError } = await admin.rpc('admin_revoke_auth_session', {
      p_session_id: device.session_id,
      p_user_id: context.userId,
    });
    if (rpcError) throw rpcError;

    const { error: markError } = await admin
      .from('auth_devices')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', device.id);
    if (markError) throw markError;

    return NextResponse.json({ data: { revoked: true } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
