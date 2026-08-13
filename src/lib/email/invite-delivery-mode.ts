import { supabaseAdmin } from '@/features/assistant/lib/ai/admin-client';

// ============================================================
// Platform-wide invite delivery mode.
//
// Decides whether the system is allowed to SEND invitation email
// at all, or whether invites are link-only (the admin copies the
// /join/<token> URL and delivers it themselves).
//
// This is a PLATFORM operator control, not a per-workspace one:
// it lives in `platform_settings` and is written only by super
// admins through /api/admin/platform-settings. A workspace owner
// configures their own SMTP credentials in Settings → Email
// delivery, but they cannot decide that the platform may start
// sending mail — that gate is ours.
//
// Resolution order:
//   1. platform_settings row (key = 'invite_delivery_mode')
//   2. INVITE_DELIVERY_MODE env var (local dev / tests)
//   3. default: 'link_only'
//
// The default is 'link_only' and every failure path resolves to
// 'link_only'. This is deliberate and is the security property of
// this module: sending mail is the side effect that reaches
// third parties who never consented, so it must require an
// explicit, present, valid "yes". A missing row, an unreadable
// settings table, or a typo'd env value must never be interpreted
// as permission to email people. Compare `ai_engine`, which fails
// open to a default engine — the worst case there is the wrong
// code path; the worst case here is unsolicited mail sent from a
// misconfigured deployment.
// ============================================================

export type InviteDeliveryMode = 'email' | 'link_only';

/** Fail-closed default: never send mail unless explicitly enabled. */
export const DEFAULT_INVITE_DELIVERY_MODE: InviteDeliveryMode = 'link_only';

export const PLATFORM_SETTING_KEY = 'invite_delivery_mode';

/** How long a fetched value is trusted before re-reading the DB. */
const CACHE_TTL_MS = 30_000;

let cached: { value: InviteDeliveryMode; expiresAt: number } | null = null;

export function isInviteDeliveryMode(v: unknown): v is InviteDeliveryMode {
  return v === 'email' || v === 'link_only';
}

/** Env fallback — local dev and tests, used only when no DB row exists. */
function envMode(): InviteDeliveryMode | null {
  const raw = process.env.INVITE_DELIVERY_MODE?.trim().toLowerCase();
  return isInviteDeliveryMode(raw) ? raw : null;
}

/**
 * Resolve the current invite delivery mode.
 *
 * DB value wins; on a missing row the env var applies; otherwise
 * the fail-closed default. A read error resolves to 'link_only'
 * WITHOUT consulting env, because an unreadable settings table
 * means we cannot prove an operator opted in.
 */
export async function getInviteDeliveryMode(): Promise<InviteDeliveryMode> {
  const now = Date.now();
  if (cached && now < cached.expiresAt) return cached.value;

  let value: InviteDeliveryMode | null = null;
  let readFailed = false;
  try {
    const { data, error } = await supabaseAdmin()
      .from('platform_settings')
      .select('value')
      .eq('key', PLATFORM_SETTING_KEY)
      .maybeSingle();
    if (error) {
      readFailed = true;
      console.error('[invite-delivery-mode] read failed:', error.message);
    } else if (data && isInviteDeliveryMode(data.value)) {
      value = data.value;
    }
  } catch (err) {
    readFailed = true;
    console.error('[invite-delivery-mode] read threw:', err);
  }

  // Don't cache a failure for the full TTL — a transient DB blip
  // would otherwise disable sending for 30s after it recovered.
  if (readFailed) return DEFAULT_INVITE_DELIVERY_MODE;

  const resolved = value ?? envMode() ?? DEFAULT_INVITE_DELIVERY_MODE;
  cached = { value: resolved, expiresAt: now + CACHE_TTL_MS };
  return resolved;
}

/**
 * Drop the cached value so the next read hits the DB. Called by the
 * admin route right after an update, and by tests.
 */
export function resetInviteDeliveryModeCache(): void {
  cached = null;
}
