import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { channelAdmin } from '@/features/channels/lib/admin-client';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Server-gated sign-in with attempt tracking and lockout.
 *
 * The old flow called Supabase straight from the browser, which made
 * brute-force throttling impossible. This route is the single door:
 *
 * 1. Lockout check — 5 failures for an email within 15 minutes locks
 *    that email for 15 minutes (HTTP 429 with retry time). Keyed by
 *    email so an attacker can't dodge it by rotating IPs.
 * 2. Sign-in via the SSR client, which writes the session cookies.
 * 3. Every attempt (success or fail) is recorded with IP, user agent,
 *    and login location from the platform geo headers.
 *
 * Failure responses are deliberately uniform ("Invalid email or
 * password") so the endpoint can't be used to enumerate accounts.
 */

const MAX_FAILURES = 5;
const WINDOW_MINUTES = 15;

const bodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(1024),
});

function clientMeta(request: NextRequest) {
  const userAgent = request.headers.get('user-agent')?.slice(0, 512) ?? null;
  const ip =
    request.headers
      .get('x-forwarded-for')
      ?.split(',')[0]
      ?.trim()
      .slice(0, 64) ?? null;
  // Vercel edge geo headers — city arrives URI-encoded.
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
  const latitude = Number.parseFloat(
    request.headers.get('x-vercel-ip-latitude') ?? ''
  );
  const longitude = Number.parseFloat(
    request.headers.get('x-vercel-ip-longitude') ?? ''
  );
  return {
    userAgent,
    ip,
    city,
    region,
    country,
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid email or password.' },
      { status: 400 }
    );
  }
  const email = parsed.data.email.trim().toLowerCase();
  const meta = clientMeta(request);
  const admin = channelAdmin();

  // --- 1. Lockout check --------------------------------------------
  const windowStart = new Date(
    Date.now() - WINDOW_MINUTES * 60_000
  ).toISOString();
  const { data: recent, error: recentError } = await admin
    .from('auth_login_attempts')
    .select('success, created_at')
    .eq('email', email)
    .gte('created_at', windowStart)
    .order('created_at', { ascending: false })
    .limit(MAX_FAILURES * 2);
  if (recentError) {
    console.error('[security] lockout check failed:', recentError.message);
  }

  // Count consecutive failures since the last success in the window.
  let failures = 0;
  for (const row of recent ?? []) {
    if (row.success) break;
    failures += 1;
  }

  if (failures >= MAX_FAILURES) {
    const newest = recent?.[0]?.created_at;
    const unlockAt = newest
      ? new Date(new Date(newest).getTime() + WINDOW_MINUTES * 60_000)
      : new Date(Date.now() + WINDOW_MINUTES * 60_000);
    const minutesLeft = Math.max(
      1,
      Math.ceil((unlockAt.getTime() - Date.now()) / 60_000)
    );
    return NextResponse.json(
      {
        error: `Too many failed sign-in attempts. Account locked — try again in ${minutesLeft} min.`,
        locked: true,
        retryAfterMinutes: minutesLeft,
      },
      { status: 429, headers: { 'Retry-After': String(minutesLeft * 60) } }
    );
  }

  // --- 2. Sign in (SSR client writes the session cookies) ----------
  const supabase = await createClient();
  const { data: signIn, error: signInError } =
    await supabase.auth.signInWithPassword({
      email,
      password: parsed.data.password,
    });

  const success = !signInError;
  const userId = signIn?.user?.id ?? null;

  // --- 3. Record the attempt (audit log) ---------------------------
  const { error: logError } = await admin.from('auth_login_attempts').insert({
    email,
    user_id: userId,
    success,
    ip_address: meta.ip,
    user_agent: meta.userAgent,
    city: meta.city,
    region: meta.region,
    country: meta.country,
    latitude: meta.latitude,
    longitude: meta.longitude,
  });
  if (logError) {
    console.error('[security] attempt log failed:', logError.message);
  }

  if (!success) {
    const remaining = MAX_FAILURES - failures - 1;
    return NextResponse.json(
      {
        error: 'Invalid email or password.',
        ...(remaining > 0 && remaining <= 2
          ? { warning: `${remaining} attempts left before a temporary lock.` }
          : {}),
      },
      { status: 401 }
    );
  }

  // Record this session as a device immediately, with location.
  const sessionId = (
    signIn.session
      ? (JSON.parse(
          Buffer.from(
            signIn.session.access_token.split('.')[1],
            'base64url'
          ).toString('utf8')
        ) as { session_id?: string })
      : {}
  ).session_id;
  if (sessionId && userId) {
    const { error: deviceError } = await admin.from('auth_devices').upsert(
      {
        user_id: userId,
        session_id: sessionId,
        user_agent: meta.userAgent,
        ip_address: meta.ip,
        city: meta.city,
        region: meta.region,
        country: meta.country,
        last_seen_at: new Date().toISOString(),
        revoked_at: null,
      },
      { onConflict: 'session_id' }
    );
    if (deviceError) {
      console.error('[security] device record failed:', deviceError.message);
    }
  }

  return NextResponse.json({ data: { signedIn: true } });
}
