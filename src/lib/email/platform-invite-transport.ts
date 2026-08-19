// ============================================================
// Platform invite email transport (super-admin only).
//
// WHO OWNS THIS: the platform operator, and nobody else. Invitation
// email is the one outbound channel that reaches people who have no
// relationship with the product yet — a stranger's inbox. Letting
// each workspace owner point that at their own SMTP server would
// mean every tenant could send mail that looks like it came from the
// platform, with no operator visibility. So the transport used for
// invites is configured in exactly ONE place: Platform admin →
// Invite delivery. Workspace owners cannot set it, see its
// credentials, or override it.
//
// This is deliberately NOT the same thing as `sendEmail()` in
// ./mailer.ts, which resolves a *workspace's* own provider. That is
// correct for broadcasts and template test-sends, where a tenant
// mails its own customers from its own domain. Invites are the
// platform's voice, so they use this module instead.
//
// Storage: one `platform_settings` row (key = 'invite_email_transport').
// That table has RLS enabled with NO policies, so it is unreachable
// by anon/authenticated clients entirely — every read and write goes
// through the service-role client here, and only after
// requireSuperAdmin() has passed in the API layer. Secrets inside
// the row are additionally AES-256-GCM encrypted, so a leaked DB
// dump does not hand over the SMTP password.
//
// Nothing in this module is ever sent to the browser: the UI reads
// getPlatformTransportSummary(), which returns host/port/from but
// NEVER the password or API key.
// ============================================================

import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt } from '@/lib/crypto/secrets';
import {
  encryptEmailCredentials,
  type AccountEmailSettings,
  type EmailCredentials,
} from './mailer';

/** platform_settings key holding the invite transport config. */
export const PLATFORM_TRANSPORT_KEY = 'invite_email_transport';

/**
 * Providers an operator may configure for invites. `msg91` is
 * intentionally absent: it is a workspace-oriented transactional
 * vendor in this codebase, and invites should come from the
 * platform's own sender.
 */
export type PlatformTransportProvider = 'smtp' | 'resend' | 'mailtrap';

export function isPlatformTransportProvider(
  v: unknown
): v is PlatformTransportProvider {
  return v === 'smtp' || v === 'resend' || v === 'mailtrap';
}

/**
 * What the platform admin UI is allowed to see. No secret material:
 * `hasSecret` tells the operator that a password/key is stored
 * without ever shipping the value itself to the browser.
 */
export interface PlatformTransportSummary {
  configured: boolean;
  provider: PlatformTransportProvider | null;
  fromEmail: string | null;
  fromName: string | null;
  host: string | null;
  port: number | null;
  secure: boolean;
  username: string | null;
  hasSecret: boolean;
  updatedAt: string | null;
}

/** Input accepted from the platform admin form. */
export interface PlatformTransportInput {
  provider: PlatformTransportProvider;
  fromEmail: string;
  fromName?: string | null;
  /** SMTP only. */
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  /**
   * SMTP password, Resend API key, or Mailtrap token. Optional on
   * update: omitting it keeps the stored secret, so an operator can
   * change the port or From address without re-entering the password.
   */
  secret?: string;
}

/** Shape stored in platform_settings.value. */
interface StoredTransport {
  provider: PlatformTransportProvider;
  fromEmail: string;
  fromName: string | null;
  host: string | null;
  port: number | null;
  secure: boolean;
  username: string | null;
  /** AES-256-GCM blob of the provider's EmailCredentials. */
  credentialsEncrypted: string;
}

const EMPTY_SUMMARY: PlatformTransportSummary = {
  configured: false,
  provider: null,
  fromEmail: null,
  fromName: null,
  host: null,
  port: null,
  secure: false,
  username: null,
  hasSecret: false,
  updatedAt: null,
};

// Short TTL cache, mirroring invite-delivery-mode.ts: invites are
// sent one at a time by humans, so this only spares a round trip on
// bursts. Any write resets it so an operator never saves a change
// and then watches a stale transport get used.
const CACHE_TTL_MS = 30_000;
let cached: { value: StoredTransport | null; expiresAt: number } | null = null;

export function resetPlatformTransportCache(): void {
  cached = null;
}

function isStoredTransport(v: unknown): v is StoredTransport {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    isPlatformTransportProvider(r.provider) &&
    typeof r.fromEmail === 'string' &&
    typeof r.credentialsEncrypted === 'string' &&
    r.credentialsEncrypted.length > 0
  );
}

async function readStored(): Promise<StoredTransport | null> {
  const now = Date.now();
  if (cached && now < cached.expiresAt) return cached.value;

  const { data, error } = await supabaseAdmin()
    .from('platform_settings')
    .select('value, updated_at')
    .eq('key', PLATFORM_TRANSPORT_KEY)
    .maybeSingle();

  if (error) {
    // Don't cache a transient DB failure for the full TTL.
    console.error('[platform-transport] read failed:', error.message);
    return null;
  }

  const value = isStoredTransport(data?.value)
    ? (data.value as StoredTransport)
    : null;
  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

/**
 * Operator-facing view of the configured transport. Safe to return
 * from an API route (after the super-admin gate) — contains no
 * secret material.
 */
export async function getPlatformTransportSummary(): Promise<PlatformTransportSummary> {
  const { data, error } = await supabaseAdmin()
    .from('platform_settings')
    .select('value, updated_at')
    .eq('key', PLATFORM_TRANSPORT_KEY)
    .maybeSingle();

  if (error || !isStoredTransport(data?.value)) return EMPTY_SUMMARY;
  const v = data.value as StoredTransport;
  return {
    configured: true,
    provider: v.provider,
    fromEmail: v.fromEmail,
    fromName: v.fromName ?? null,
    host: v.host ?? null,
    port: v.port ?? null,
    secure: v.secure === true,
    username: v.username ?? null,
    hasSecret: true,
    updatedAt: (data.updated_at as string) ?? null,
  };
}

/**
 * Resolve the transport into the shape `sendWithSettings()` expects,
 * so invites reuse the same audited provider adapters as the rest of
 * the email layer. Returns null when unconfigured or undecryptable —
 * callers then fall back to the platform env key, or report
 * 'no_provider' rather than silently doing nothing.
 */
export async function getPlatformTransport(): Promise<AccountEmailSettings | null> {
  const stored = await readStored();
  if (!stored) return null;

  try {
    const credentials = JSON.parse(
      decrypt(stored.credentialsEncrypted)
    ) as EmailCredentials;
    return {
      provider: stored.provider,
      fromEmail: stored.fromEmail,
      fromName: stored.fromName ?? null,
      credentials,
    };
  } catch (err) {
    // Rotated ENCRYPTION_KEY or a tampered row. Fail closed and stay
    // quiet about specifics.
    console.error('[platform-transport] decrypt failed:', err);
    return null;
  }
}

export interface TransportValidationError {
  field: string;
  message: string;
}

/**
 * Validate operator input. Returned as a list so the form can mark
 * every bad field at once instead of one save round-trip per typo.
 *
 * `existing` lets an update omit the secret: we only require one
 * when nothing is stored yet.
 */
export function validateTransportInput(
  input: PlatformTransportInput,
  existing: PlatformTransportSummary
): TransportValidationError[] {
  const errors: TransportValidationError[] = [];

  if (!isPlatformTransportProvider(input.provider)) {
    errors.push({ field: 'provider', message: 'Choose a provider.' });
    return errors;
  }

  const from = input.fromEmail?.trim() ?? '';
  // Deliberately loose: the transport itself is the real validator,
  // and the Test button proves deliverability far better than a
  // regex ever could. This only catches obvious typos.
  if (!from || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(from)) {
    errors.push({
      field: 'fromEmail',
      message: 'Enter a valid From address.',
    });
  }

  const secretRequired =
    !existing.hasSecret || existing.provider !== input.provider;
  const secret = input.secret?.trim() ?? '';
  if (secretRequired && !secret) {
    errors.push({
      field: 'secret',
      message:
        input.provider === 'smtp'
          ? 'Enter the SMTP password.'
          : 'Enter the API key.',
    });
  }

  if (input.provider === 'smtp') {
    if (!input.host?.trim()) {
      errors.push({ field: 'host', message: 'Enter the SMTP host.' });
    }
    const port = Number(input.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push({ field: 'port', message: 'Port must be 1–65535.' });
    }
    if (!input.username?.trim()) {
      errors.push({ field: 'username', message: 'Enter the SMTP username.' });
    }
  }

  return errors;
}

/**
 * Build the credentials object for a provider, reusing the stored
 * secret when the operator left the field blank on an edit.
 */
async function resolveSecret(
  input: PlatformTransportInput
): Promise<string | null> {
  const provided = input.secret?.trim();
  if (provided) return provided;

  // Reuse the existing secret. Read it through the same decrypt path
  // so a rotated key surfaces here as "re-enter the password" rather
  // than silently persisting an unusable blob.
  const current = await getPlatformTransport();
  if (!current || current.provider !== input.provider) return null;
  // Via `unknown`: EmailCredentials is a union of closed interfaces, so
  // TS won't widen it to an index signature directly. We only read the
  // one secret field each provider actually has.
  const creds = current.credentials as unknown as Record<string, unknown>;
  const existing = creds.password ?? creds.apiKey ?? creds.token;
  return typeof existing === 'string' && existing ? existing : null;
}

/**
 * Persist the transport. Returns the new summary so the caller can
 * write an audit entry and refresh the UI without a second read.
 */
export async function savePlatformTransport(
  input: PlatformTransportInput
): Promise<
  | { ok: true; summary: PlatformTransportSummary }
  | { ok: false; errors: TransportValidationError[] }
> {
  const existing = await getPlatformTransportSummary();
  const errors = validateTransportInput(input, existing);
  if (errors.length) return { ok: false, errors };

  const secret = await resolveSecret(input);
  if (!secret) {
    return {
      ok: false,
      errors: [
        {
          field: 'secret',
          message:
            'Could not reuse the stored secret — please re-enter it.',
        },
      ],
    };
  }

  let credentials: EmailCredentials;
  if (input.provider === 'smtp') {
    credentials = {
      host: input.host!.trim(),
      port: Number(input.port),
      secure: input.secure === true,
      username: input.username!.trim(),
      password: secret,
    };
  } else if (input.provider === 'resend') {
    credentials = { apiKey: secret };
  } else {
    credentials = { token: secret };
  }

  const stored: StoredTransport = {
    provider: input.provider,
    fromEmail: input.fromEmail.trim(),
    fromName: input.fromName?.trim() || null,
    host: input.provider === 'smtp' ? input.host!.trim() : null,
    port: input.provider === 'smtp' ? Number(input.port) : null,
    secure: input.provider === 'smtp' ? input.secure === true : false,
    username: input.provider === 'smtp' ? input.username!.trim() : null,
    credentialsEncrypted: encryptEmailCredentials(credentials),
  };

  const { error } = await supabaseAdmin().from('platform_settings').upsert(
    {
      key: PLATFORM_TRANSPORT_KEY,
      value: stored,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'key' }
  );

  if (error) {
    return {
      ok: false,
      errors: [{ field: 'provider', message: error.message }],
    };
  }

  resetPlatformTransportCache();
  return { ok: true, summary: await getPlatformTransportSummary() };
}

/** Remove the transport entirely (invites fall back to link-only). */
export async function clearPlatformTransport(): Promise<void> {
  await supabaseAdmin()
    .from('platform_settings')
    .delete()
    .eq('key', PLATFORM_TRANSPORT_KEY);
  resetPlatformTransportCache();
}
