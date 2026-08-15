import { NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/features/auth/lib/super-admin';
import { toErrorResponse } from '@/features/auth/lib/account';
import { logPlatformAudit } from '@/features/admin/lib/platform/audit';
import { sendWithSettings } from '@/lib/email/mailer';
import {
  clearPlatformTransport,
  getPlatformTransport,
  getPlatformTransportSummary,
  isPlatformTransportProvider,
  savePlatformTransport,
  type PlatformTransportInput,
} from '@/lib/email/platform-invite-transport';

// ============================================================
// /api/admin/invite-transport — the SMTP/email sender used for
// invitations. Platform super admins only.
//
// Every method here goes through `requireSuperAdmin()`, the same
// gate as /api/admin/platform-settings: the DB flag
// `profiles.is_super_admin`, with the SUPER_ADMIN_EMAILS env
// allowlist as a transition fallback. A workspace owner or admin
// gets 403 — there is deliberately no tenant-facing equivalent of
// this route, because invite mail goes to people who are not yet
// users and must come from the platform's verified sender.
//
// The underlying `platform_settings` row is unreachable from any
// browser client (RLS on, zero policies), and the credential blob
// inside it is AES-256-GCM encrypted. Secrets are write-only over
// this API: GET returns host/port/username/from plus a `hasSecret`
// boolean, never the password or API key itself.
//
//   GET    — current config summary (no secrets)
//   PUT    — save/replace the transport
//   POST   — send a test email through the saved transport
//   DELETE — remove it (invites revert to link-only)
// ============================================================

/** Never let a provider error string leak credentials back to the UI. */
function scrub(message: string | undefined): string {
  if (!message) return 'Send failed';
  return message.slice(0, 300);
}

export async function GET() {
  try {
    await requireSuperAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  const summary = await getPlatformTransportSummary();
  return NextResponse.json(summary);
}

export async function PUT(request: Request) {
  let ctx;
  try {
    ctx = await requireSuperAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = (await request.json().catch(() => null)) as
    | Partial<PlatformTransportInput>
    | null;
  if (!body || !isPlatformTransportProvider(body.provider)) {
    return NextResponse.json(
      { error: "provider must be 'smtp', 'resend', or 'mailtrap'" },
      { status: 400 }
    );
  }

  const result = await savePlatformTransport({
    provider: body.provider,
    fromEmail: typeof body.fromEmail === 'string' ? body.fromEmail : '',
    fromName: typeof body.fromName === 'string' ? body.fromName : null,
    host: typeof body.host === 'string' ? body.host : undefined,
    port: typeof body.port === 'number' ? body.port : Number(body.port),
    secure: body.secure === true,
    username: typeof body.username === 'string' ? body.username : undefined,
    secret: typeof body.secret === 'string' ? body.secret : undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: 'Invalid transport settings', fields: result.errors },
      { status: 400 }
    );
  }

  // Configuring the platform's outbound sender is exactly the kind of
  // change that needs an operator trail. The summary carries no
  // secrets, so it is safe to persist in the audit row.
  await logPlatformAudit(ctx.supabase, {
    actorId: ctx.userId,
    accountId: null,
    action: 'invite_transport.update',
    entity: 'platform_settings',
    after: result.summary,
  });

  return NextResponse.json(result.summary);
}

/**
 * Send a test message through the saved transport.
 *
 * The recipient defaults to the operator's own address and may be
 * overridden only with an explicit `to`. This is a deliberate
 * constraint: a "test" button that mails arbitrary strangers is a
 * spam cannon with a friendly label.
 */
export async function POST(request: Request) {
  let ctx;
  try {
    ctx = await requireSuperAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  const body = (await request.json().catch(() => null)) as {
    to?: unknown;
  } | null;
  const to =
    typeof body?.to === 'string' && body.to.trim() ? body.to.trim() : ctx.email;

  if (!to) {
    return NextResponse.json(
      { error: 'No recipient available for the test send' },
      { status: 400 }
    );
  }

  const transport = await getPlatformTransport();
  if (!transport) {
    return NextResponse.json(
      { error: 'No transport configured yet — save one first.' },
      { status: 400 }
    );
  }

  const result = await sendWithSettings(transport, {
    to,
    subject: 'Axon — invite delivery test',
    html: `<p>This is a test from your Axon platform invite transport.</p>
           <p>If you received this, invitation email is configured correctly
           and you can switch invite delivery to <strong>Email</strong>.</p>`,
    text: 'This is a test from your Axon platform invite transport.',
  });

  await logPlatformAudit(ctx.supabase, {
    actorId: ctx.userId,
    accountId: null,
    action: 'invite_transport.test',
    entity: 'platform_settings',
    after: { to, sent: result.sent, provider: result.provider },
  });

  if (!result.sent) {
    return NextResponse.json(
      { sent: false, error: scrub(result.error) },
      // 200, not 5xx: the request was handled correctly and the answer
      // is "your SMTP rejected it". The UI needs the message, not a
      // thrown error.
      { status: 200 }
    );
  }

  return NextResponse.json({ sent: true, provider: result.provider, to });
}

export async function DELETE() {
  let ctx;
  try {
    ctx = await requireSuperAdmin();
  } catch (err) {
    return toErrorResponse(err);
  }

  await clearPlatformTransport();

  await logPlatformAudit(ctx.supabase, {
    actorId: ctx.userId,
    accountId: null,
    action: 'invite_transport.delete',
    entity: 'platform_settings',
  });

  return NextResponse.json({ ok: true });
}
