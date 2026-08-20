import type { SupabaseClient } from '@supabase/supabase-js';

import { sanitizePhoneForMeta } from '@/features/whatsapp/lib/phone-utils';
import {
  evaluateOutboundWindow,
  OutboundBlockedError,
} from './window-guard';

// ============================================================
// ADR-006 D8/D13 — consent at broadcast *plan* time.
//
// A broadcast is a fan-out of the same one-to-one operation, so it is
// bound by the same consent rule: a contact who replied STOP must not
// be messaged, at N = 1 or N = 1000, template or not.
//
// The decision itself is NOT re-implemented here. This module resolves
// the state (which of these recipients are opted out) and then asks the
// one guard that owns the rule — `evaluateOutboundWindow` — for the
// verdict. Duplicating the predicate is what the ADR rejected: two
// copies drift, and the copy in the bulk path is the one nobody reads.
//
// Cost: one indexed query per broadcast, not per recipient. The
// partial index `contacts_whatsapp_opted_out_idx (account_id,
// whatsapp_opted_out) WHERE whatsapp_opted_out` means this reads only
// the opted-out slice of the tenant, which is the small side by
// construction.
// ============================================================

/** Machine code stamped on recipients dropped at plan time. */
export const CONSENT_BLOCKED_CODE = 'contact_opted_out';

export interface WhatsAppConsentBlocklist {
  /** Sanitized (digits-only) phone numbers that have opted out. */
  readonly digits: ReadonlySet<string>;
  /**
   * True when this recipient must not be sent to. Compares on the
   * sanitized form so `+91 98765 43210` and `919876543210` are one number.
   */
  blocks(phone: string): boolean;
  /** The refusal to record against a blocked recipient. */
  reason(): OutboundBlockedError;
}

const EMPTY: WhatsAppConsentBlocklist = {
  digits: new Set<string>(),
  blocks: () => false,
  reason: () => consentError(),
};

/** Ask the single guard for the refusal so the message stays in one place. */
function consentError(): OutboundBlockedError {
  try {
    evaluateOutboundWindow({
      channel: 'whatsapp',
      lastInboundAt: null,
      payload: { kind: 'template', templateName: '', language: 'en_US' },
      optedOut: true,
    });
  } catch (err) {
    if (err instanceof OutboundBlockedError) return err;
    throw err;
  }
  // Unreachable: the guard refuses an opted-out contact unconditionally.
  // If it ever stops doing so, fail loudly rather than silently allowing
  // a bulk send that the boundary no longer blocks.
  throw new Error(
    'window-guard no longer blocks an opted-out contact — ADR-006 D8 regression'
  );
}

/**
 * Load this account's WhatsApp opt-outs once, for the phones in a broadcast.
 *
 * Always filtered by `account_id` (service-role callers included) so one
 * tenant's consent state can never leak into another's plan.
 */
export async function loadWhatsAppConsentBlocklist(
  db: SupabaseClient,
  accountId: string,
  phones: readonly string[]
): Promise<WhatsAppConsentBlocklist> {
  if (phones.length === 0) return EMPTY;

  const { data, error } = await db
    .from('contacts')
    .select('phone')
    .eq('account_id', accountId)
    .eq('whatsapp_opted_out', true);

  if (error) {
    // Fail closed on the *rule*, not on the campaign: we cannot prove
    // consent, so nothing is sent. A broadcast that silently ignores
    // STOP is a WABA-quality incident; one that refuses to start is a
    // retry.
    throw new OutboundBlockedError(
      CONSENT_BLOCKED_CODE,
      `Consent state could not be read, so the broadcast was not sent: ${error.message}`
    );
  }

  const digits = new Set(
    (data ?? [])
      .map((row) => sanitizePhoneForMeta((row as { phone: string }).phone ?? ''))
      .filter((d) => d.length > 0)
  );

  return {
    digits,
    blocks: (phone: string) => digits.has(sanitizePhoneForMeta(phone)),
    reason: consentError,
  };
}

/**
 * Contact-id variant for callers that already resolved contacts (the
 * public-API broadcast core resolves before it plans).
 */
export async function loadOptedOutContactIds(
  db: SupabaseClient,
  accountId: string,
  contactIds: readonly string[]
): Promise<ReadonlySet<string>> {
  if (contactIds.length === 0) return new Set();

  const { data, error } = await db
    .from('contacts')
    .select('id')
    .eq('account_id', accountId)
    .eq('whatsapp_opted_out', true)
    .in('id', contactIds as string[]);

  if (error) {
    throw new OutboundBlockedError(
      CONSENT_BLOCKED_CODE,
      `Consent state could not be read, so the broadcast was not sent: ${error.message}`
    );
  }

  return new Set((data ?? []).map((row) => (row as { id: string }).id));
}
