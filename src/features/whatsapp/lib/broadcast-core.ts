// ============================================================
// Public-API broadcast core.
//
// Splits a broadcast into two phases so the HTTP route can persist +
// acknowledge fast and fan out afterwards (in `after()`):
//
//   createBroadcast()  — validate, resolve contacts, insert the
//                        `broadcasts` row + `broadcast_recipients`
//                        rows (status 'pending'), return a plan.
//   deliverBroadcast() — send each recipient's template via Meta
//                        (phone-variant retry), stamp each recipient
//                        row + the aggregate counts, finalize status.
//
// Recipient rows carry `whatsapp_message_id`, so the inbound webhook's
// status handler (which matches on that column) updates delivered/read
// for API broadcasts exactly as it does for dashboard ones.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { sendTemplateMessage } from '@/features/whatsapp/lib/meta-api';
import { decrypt } from '@/lib/crypto/secrets';
import {
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/features/whatsapp/lib/phone-utils';
import { toE164 } from '@/lib/phone/e164';
import { isMessageTemplate } from '@/features/whatsapp/lib/template-row-guard';
import type { MessageTemplate } from '@/types';
import { findOrCreateContact } from '@/lib/api/v1/contacts';
import { loadOptedOutContactIds } from '@/features/channels/lib/orchestration/consent-filter';

/** Thrown by createBroadcast on a caller-visible failure; route maps it. */
export class BroadcastError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'BroadcastError';
    this.code = code;
    this.status = status;
  }
}

export interface BroadcastRecipientInput {
  /** E.164 phone. */
  to: string;
  /** Positional body params for the template ({{1}}, {{2}}…). */
  params?: string[];
}

export interface CreateBroadcastParams {
  name?: string | null;
  templateName: string;
  templateLanguage?: string | null;
  recipients: BroadcastRecipientInput[];
}

interface PlannedRecipient {
  recipientRowId: string;
  /**
   * Carried through to delivery so the fan-out phase can re-check consent
   * against the same identity the plan resolved — matching on contact id,
   * not on a phone string that would have to be re-normalised.
   */
  contactId: string;
  phone: string;
  params: string[];
}

export interface BroadcastPlan {
  broadcastId: string;
  /**
   * Required by the delivery phase: every service-role query filters by
   * account, including the consent re-check, so one tenant's consent state
   * can never decide another tenant's fan-out.
   */
  accountId: string;
  templateName: string;
  templateLanguage: string;
  phoneNumberId: string;
  accessToken: string;
  templateRow: MessageTemplate | null;
  planned: PlannedRecipient[];
  /** Phones rejected up front (invalid E.164) — counted as failed. */
  rejected: number;
  /** Recipients dropped at plan time for WhatsApp opt-out (ADR-006 D8). */
  optedOut: number;
}

const MAX_RECIPIENTS = 1000;

/**
 * Validate + persist a broadcast, resolving each recipient to a
 * contact. Returns a plan for {@link deliverBroadcast}. Throws
 * {@link BroadcastError} on bad input / missing config / a malformed
 * template / a DB failure — nothing is sent in this phase.
 */
export async function createBroadcast(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  params: CreateBroadcastParams
): Promise<BroadcastPlan> {
  const { name, templateName, recipients } = params;
  const templateLanguage = params.templateLanguage || 'en_US';

  if (!templateName) {
    throw new BroadcastError('bad_request', "'template_name' is required", 400);
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new BroadcastError(
      'bad_request',
      "'recipients' must be a non-empty array of { to, params? }",
      400
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new BroadcastError(
      'bad_request',
      `A broadcast is capped at ${MAX_RECIPIENTS} recipients per request; split larger sends`,
      400
    );
  }

  // Config (fail fast + provides the audit trail owner already resolved
  // by the caller). Meta send needs phone_number_id + decrypted token.
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();
  if (configError || !config) {
    throw new BroadcastError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }
  const accessToken = decrypt(config.access_token);

  // Template row (once) for header/button components; guard a
  // malformed local row rather than N identical opaque failures.
  const { data: rawTemplateRow } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', templateName)
    .eq('language', templateLanguage)
    .maybeSingle();
  if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
    throw new BroadcastError(
      'template_malformed',
      'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
      500
    );
  }
  const templateRow = (rawTemplateRow as MessageTemplate | null) ?? null;

  // Resolve each recipient to a contact. Invalid phones are dropped
  // (counted as rejected) rather than aborting the whole broadcast.
  const resolved: { contactId: string; phone: string; params: string[] }[] = [];
  let rejected = 0;
  for (const r of recipients) {
    // Two different shapes are needed: the contact record stores E.164
    // (with country code) while Meta's API requires digits only.
    const normalized = toE164(typeof r.to === 'string' ? r.to : '');
    if (!normalized) {
      rejected++;
      continue;
    }
    const { id } = await findOrCreateContact(db, accountId, auditUserId, {
      phone: normalized.e164,
    });
    resolved.push({
      contactId: id,
      phone: normalized.digits,
      params: Array.isArray(r.params)
        ? r.params.filter((p): p is string => typeof p === 'string')
        : [],
    });
  }

  // Collapse recipients that resolved to the SAME contact (the caller
  // listed a phone twice, or two numbers fuzzy-matched to one contact).
  // Keep the first occurrence so the contact is messaged once and its
  // params aren't silently overwritten by a later duplicate — and so
  // the row↔params pairing below (keyed by contact_id) is unambiguous.
  const seenContact = new Set<string>();
  const dedupedAll = resolved.filter((r) => {
    if (seenContact.has(r.contactId)) return false;
    seenContact.add(r.contactId);
    return true;
  });

  // ADR-006 D8: consent is enforced at plan time, so an opted-out contact
  // never gets a recipient row, never counts toward the persisted total,
  // and cannot be resurrected by a retry of the delivery phase. Counted as
  // `optedOut` rather than folded into `rejected` so the caller can tell an
  // unreachable number from a person who said STOP.
  const optedOutIds = await loadOptedOutContactIds(
    db,
    accountId,
    dedupedAll.map((r) => r.contactId)
  );
  const deduped = dedupedAll.filter((r) => !optedOutIds.has(r.contactId));
  const optedOut = dedupedAll.length - deduped.length;

  if (deduped.length === 0) {
    throw optedOut > 0
      ? new BroadcastError(
          'contact_opted_out',
          'Every recipient has opted out of WhatsApp messages, so nothing was sent.',
          409
        )
      : new BroadcastError(
          'bad_request',
          'No recipients had a valid E.164 phone number',
          400
        );
  }

  // Persist the broadcast + its recipients. The count columns
  // (sent/delivered/read/replied/failed) are owned by the DB aggregate
  // trigger (migrations 003/005) and derived purely from
  // broadcast_recipients rows — we deliberately do NOT seed them here
  // (a manual value would be clobbered by the trigger on the first
  // recipient change). `rejected` phones have no recipient row, so they
  // are reported to the caller in the POST response, not in these
  // persisted counts.
  const { data: broadcast, error: bErr } = await db
    .from('broadcasts')
    .insert({
      account_id: accountId,
      user_id: auditUserId,
      name: name || `API broadcast (${templateName})`,
      template_name: templateName,
      template_language: templateLanguage,
      status: 'sending',
      total_recipients: deduped.length,
    })
    .select('id')
    .single();
  if (bErr || !broadcast) {
    console.error('[broadcast-core] create broadcast error:', bErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  const { data: recipientRows, error: rErr } = await db
    .from('broadcast_recipients')
    .insert(
      deduped.map((r) => ({
        broadcast_id: broadcast.id,
        contact_id: r.contactId,
        status: 'pending' as const,
      }))
    )
    .select('id, contact_id');
  if (rErr || !recipientRows) {
    console.error('[broadcast-core] create recipients error:', rErr);
    throw new BroadcastError('internal', 'Failed to create broadcast', 500);
  }

  // Pair each inserted recipient row back to its phone/params by
  // contact_id — unambiguous now that duplicates are collapsed.
  const byContact = new Map(deduped.map((r) => [r.contactId, r]));
  const planned: PlannedRecipient[] = recipientRows.map((row) => {
    const r = byContact.get(row.contact_id as string)!;
    return {
      recipientRowId: row.id as string,
      contactId: r.contactId,
      phone: r.phone,
      params: r.params,
    };
  });

  return {
    broadcastId: broadcast.id,
    accountId,
    templateName,
    templateLanguage,
    phoneNumberId: config.phone_number_id,
    accessToken,
    templateRow,
    planned,
    rejected,
    optedOut,
  };
}

/**
 * Fan out a {@link BroadcastPlan}: send each recipient's template
 * (phone-variant retry) and stamp its `broadcast_recipients` row.
 * Best-effort per recipient — one failure never aborts the rest.
 * Designed to run inside `after()`.
 *
 * The per-status count columns on `broadcasts` are owned by the DB
 * aggregate trigger (migrations 003/005): each recipient-row update
 * below advances them automatically, and later Meta delivery/read
 * webhooks keep advancing them. We therefore never write those columns
 * here — only the terminal `status` — otherwise a manual value would
 * race and clobber the trigger-maintained counts.
 */
export async function deliverBroadcast(
  db: SupabaseClient,
  plan: BroadcastPlan
): Promise<void> {
  let sentCount = 0;

  // ADR-006 D8/D13 — consent is re-read at *delivery* time, not just at
  // plan time.
  //
  // Plan and fan-out are deliberately separated (the route acknowledges,
  // then `after()` sends), so the two are not the same instant: a contact
  // can reply STOP in the gap, and on a 1000-recipient plan that gap is
  // long. Plan-time filtering alone would send to someone the system
  // already knows has opted out — the exact violation D8 exists to
  // prevent, just arriving a few seconds later.
  //
  // Still one indexed query for the whole fan-out, hitting the partial
  // `contacts_whatsapp_opted_out_idx`. If it fails we do NOT sail on:
  // unproven consent is treated as no consent, the recipients are stamped
  // failed with the machine code, and the tenant retries — the same
  // fail-closed direction as the plan-time load.
  let optedOut: ReadonlySet<string>;
  try {
    optedOut = await loadOptedOutContactIds(
      db,
      plan.accountId,
      plan.planned.map((r) => r.contactId)
    );
  } catch (error) {
    console.warn('[broadcast-core] consent re-check failed; refusing fan-out', {
      broadcastId: plan.broadcastId,
      error: error instanceof Error ? error.message : String(error),
    });
    optedOut = new Set(plan.planned.map((r) => r.contactId));
  }

  for (const recipient of plan.planned) {
    if (optedOut.has(recipient.contactId)) {
      // Never enters the provider loop, so no message is sent and no
      // whatsapp_message_id is recorded. Stamped failed with the code so
      // the recipient list explains itself rather than showing a blank
      // failure the tenant reads as a delivery bug.
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: 'Contact has opted out of WhatsApp messages.',
        })
        .eq('id', recipient.recipientRowId);
      continue;
    }

    const variants = phoneVariants(recipient.phone);
    let sentMessageId: string | null = null;
    let lastError: string | null = null;

    for (const variant of variants) {
      try {
        const result = await sendTemplateMessage({
          phoneNumberId: plan.phoneNumberId,
          accessToken: plan.accessToken,
          to: variant,
          templateName: plan.templateName,
          language: plan.templateLanguage,
          template: plan.templateRow ?? undefined,
          params: recipient.params,
        });
        sentMessageId = result.messageId;
        lastError = null;
        break;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        lastError = message;
        // Only a "recipient not allowed" error is worth another variant.
        if (!isRecipientNotAllowedError(message)) break;
      }
    }

    if (sentMessageId) {
      sentCount++;
      await db
        .from('broadcast_recipients')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          whatsapp_message_id: sentMessageId,
          error_message: null,
        })
        .eq('id', recipient.recipientRowId);
    } else {
      await db
        .from('broadcast_recipients')
        .update({
          status: 'failed',
          error_message: lastError || 'Unknown error',
        })
        .eq('id', recipient.recipientRowId);
    }
  }

  // Terminal status only — counts are trigger-owned (see the note
  // above). If nothing sent, the broadcast failed outright; a partial
  // send is still 'sent' (per-recipient failures show in failed_count).
  await db
    .from('broadcasts')
    .update({
      status: sentCount > 0 ? 'sent' : 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', plan.broadcastId);
}
