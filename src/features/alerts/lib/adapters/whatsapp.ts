import { supabaseAdmin } from '@/features/flows/lib/admin-client';
import { decrypt } from '@/features/whatsapp/lib/encryption';
import { sendTemplateMessage } from '@/features/whatsapp/lib/meta-api';
import { sanitizePhoneForMeta } from '@/features/whatsapp/lib/phone-utils';
import type {
  AlertAdapter,
  AlertDestination,
  AlertPayload,
  AlertSendResult,
} from '../types';

/**
 * WhatsApp alert adapter (Meta Cloud API).
 *
 * Reuses the account's EXISTING WhatsApp connection (`whatsapp_config`)
 * rather than asking for separate credentials. An account that already
 * messages customers on WhatsApp can alert its staff there with no extra
 * setup, and we avoid a second copy of the same access token.
 *
 * Why this MUST send a template, not plain text
 * ---------------------------------------------
 * Meta only allows free-form text within a 24-hour customer service
 * window opened by the *recipient* messaging you first. A staff alert is
 * proactive, first-touch messaging to a teammate — essentially never
 * inside such a window — so a plain-text send would be rejected with
 * error 131047 ("re-engagement message"). Every alert would fail, and it
 * would fail *intermittently* (working only right after a teammate
 * happened to message the business number), which is the worst kind of
 * bug to diagnose. So this adapter always sends a pre-approved template
 * and treats a missing template as a configuration error rather than
 * pretending free-form will do.
 *
 * The template needs exactly two body variables: {{1}} title, {{2}} body.
 */

export interface WhatsAppDestinationConfig {
  /** E.164 recipient, e.g. "+919876543210". */
  recipient: string;
  /** Name of the approved template in the account's WABA. */
  template_name: string;
  /** Template language code; Meta defaults to en_US. */
  template_language?: string;
}

/**
 * WhatsApp template body variables cannot contain newlines, tabs, or
 * runs of 4+ spaces — Meta rejects the send with a 132000-class error.
 * Alert bodies are multi-line, so flatten before sending.
 */
function flattenForTemplate(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Meta caps a body variable at 1024 characters. */
function clampParam(value: string, max = 1024): string {
  const flat = flattenForTemplate(value);
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Permanent failures. Meta surfaces these as human-readable messages
 * (see throwMetaError), so match on the distinctive fragments.
 */
function isPermanent(message: string): boolean {
  const m = message.toLowerCase();
  return (
    // Template missing / renamed / not approved in this WABA.
    m.includes('template name does not exist') ||
    m.includes('template does not exist') ||
    m.includes('does not exist in') ||
    // Variable count or format mismatch — a code/config problem.
    m.includes('number of parameters') ||
    m.includes('parameter format') ||
    // Recipient simply isn't a WhatsApp user, or opted out.
    m.includes('not a valid whatsapp user') ||
    m.includes('recipient phone number not in allowed list') ||
    // Token revoked or expired: needs an admin reconnect, not a retry.
    m.includes('access token') ||
    m.includes('session has expired') ||
    m.includes('permission') ||
    // Business account restricted/blocked by Meta policy.
    m.includes('account has been restricted') ||
    m.includes('business account is restricted')
  );
}

export const whatsappAlertAdapter: AlertAdapter = {
  provider: 'whatsapp',

  async send(
    destination: AlertDestination,
    payload: AlertPayload
  ): Promise<AlertSendResult> {
    const config = destination.config as unknown as WhatsAppDestinationConfig;
    const recipient = config?.recipient?.trim();
    const templateName = config?.template_name?.trim();

    if (!recipient) {
      return { ok: false, retryable: false, error: 'No recipient configured' };
    }
    if (!templateName) {
      // Explicit, actionable message: this is the single most likely
      // misconfiguration for this provider.
      return {
        ok: false,
        retryable: false,
        error:
          'No approved template configured. WhatsApp requires a pre-approved template for proactive alerts.',
      };
    }

    // --- Credentials come from the account's existing WhatsApp setup ---
    const db = supabaseAdmin();
    const { data: waConfig, error: configError } = await db
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', destination.account_id)
      .maybeSingle();

    if (configError) {
      // Database blip — worth another attempt.
      return { ok: false, retryable: true, error: configError.message };
    }
    if (!waConfig?.phone_number_id || !waConfig?.access_token) {
      return {
        ok: false,
        retryable: false,
        error:
          'WhatsApp is not connected for this account — connect it in Settings first',
      };
    }

    let accessToken: string;
    try {
      accessToken = decrypt(waConfig.access_token);
    } catch {
      return {
        ok: false,
        retryable: false,
        error: 'Stored WhatsApp token could not be decrypted — reconnect',
      };
    }

    try {
      await sendTemplateMessage({
        phoneNumberId: waConfig.phone_number_id,
        accessToken,
        to: sanitizePhoneForMeta(recipient),
        templateName,
        language: config.template_language?.trim() || 'en_US',
        // Body-only params: {{1}} = title, {{2}} = summary.
        params: [clampParam(payload.title), clampParam(payload.body)],
      });
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'WhatsApp send failed';

      if (isPermanent(message)) {
        return { ok: false, retryable: false, error: message };
      }
      // Rate limits (code 4 / 80007), spam throttles (131048/131049),
      // Meta 5xx, and network timeouts all land here and get the
      // backoff ladder, which terminates at MAX_ATTEMPTS.
      return { ok: false, retryable: true, error: message };
    }
  },
};
