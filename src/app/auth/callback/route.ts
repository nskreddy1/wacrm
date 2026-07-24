import { NextResponse, type NextRequest } from 'next/server';

import { routes } from '@/lib/routing/routes';
import { createClient } from '@/lib/supabase/server';

const callbackDestinations = {
  recovery: routes.auth.resetPassword,
  signup: routes.app.dashboard,
} as const;

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const purpose = request.nextUrl.searchParams.get('purpose');
  const next = request.nextUrl.searchParams.get('next');
  // Only allow same-origin relative paths to prevent open redirects.
  const safeNext =
    next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  const destination =
    safeNext ??
    (purpose && purpose in callbackDestinations
      ? callbackDestinations[purpose as keyof typeof callbackDestinations]
      : routes.app.dashboard);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(destination, request.url));
  }

  return NextResponse.redirect(
    new URL(`${routes.auth.login}?error=auth_callback_failed`, request.url)
  );
}
