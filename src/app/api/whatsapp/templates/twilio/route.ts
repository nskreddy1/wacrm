import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import { channelAdmin } from '@/lib/supabase/admin';
import { resolveTwilioCredentials } from '@/features/channels/lib/twilio-account';
import {
  createTwilioContent,
  getTwilioApproval,
  listTwilioContentAndApprovals,
  normalizeTwilioContent,
  submitTwilioApproval,
  validateWhatsAppTemplateBody,
} from '@/features/whatsapp/lib/twilio-content';
import type { TemplateButton } from '@/types';

// Tolerant by design: the studio's saveBody() serializes empty
// optional fields as null (matching the DB row shape), and the
// create action is implied when no action is provided. Rejecting
// null here caused "Invalid Twilio template" for every submit.
const createSchema = z.object({
  action: z.literal('create').optional(),
  name: z.string().trim().min(1).max(512),
  category: z.enum(['Marketing', 'Utility', 'Authentication']),
  language: z.string().trim().min(2).max(12),
  body_text: z.string().trim().min(1).max(1600),
  header_type: z.enum(['text', 'image']).nullish(),
  header_content: z.string().trim().nullish(),
  footer_text: z.string().trim().nullish(),
  buttons: z
    .array(z.record(z.string(), z.unknown()))
    .nullish()
    .transform((v) => v ?? undefined),
  sample_values: z
    .object({
      body: z.array(z.string()).optional(),
      header: z.array(z.string()).optional(),
    })
    .nullish()
    .transform((v) => v ?? undefined),
});

/**
 * Twilio credentials are account-scoped: the Content API works with
 * ANY enabled Twilio connection (SMS or WhatsApp) on this workspace.
 * resolveTwilioCredentials prefers the WhatsApp row but falls back
 * to the SMS row, fixing the "connected for SMS but WhatsApp
 * templates say not connected" inconsistency.
 */
async function connectionFor(accountId: string) {
  const resolved = await resolveTwilioCredentials(accountId, 'whatsapp');
  return resolved.credentials;
}

/**
 * Category for synced templates. Twilio only reports a category once
 * a template has been SUBMITTED for WhatsApp review — templates that
 * are session-only ("user initiated" in the console) have none.
 * Defaulting those to Marketing was wrong: it slapped the marketing
 * opt-out compliance blocker on order-tracking/support templates.
 * Infer from the name instead (matches how Meta auto-categorizes),
 * falling back to Utility — the least restrictive tier for the
 * transactional templates people actually build.
 */
function inferCategory(approvalCategory: string | undefined, name: string) {
  if (approvalCategory === 'UTILITY') return 'Utility';
  if (approvalCategory === 'AUTHENTICATION') return 'Authentication';
  if (approvalCategory === 'MARKETING') return 'Marketing';
  const n = name.toLowerCase();
  if (/\b(otp|verif|auth|2fa|passcode|login[_ ]?code|one[_ ]?time)/.test(n))
    return 'Authentication';
  if (
    /(promo|offer|discount|sale|campaign|marketing|newsletter|announce|opt[_ ]?in)/.test(
      n
    )
  )
    return 'Marketing';
  return 'Utility';
}

/**
 * Twilio approval status → our MessageTemplateStatus.
 * Full set per the Content API docs: unsubmitted, received, pending,
 * approved, rejected, paused, disabled. `received` AND `pending` both
 * mean "in review" — missing `pending` here was the bug that stomped
 * every in-review template back to DRAFT on the next sync.
 */
function approvalStatus(value?: string) {
  switch (value?.toLowerCase()) {
    case 'approved':
      return 'APPROVED';
    case 'received':
    case 'pending':
      return 'PENDING';
    case 'rejected':
      return 'REJECTED';
    case 'paused':
      return 'PAUSED';
    case 'disabled':
      return 'DISABLED';
    default:
      // unsubmitted / missing — never submitted for WhatsApp review.
      return 'DRAFT';
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent');
    const credentials = await connectionFor(accountId);
    const body = await request.json().catch(() => ({}));

    if (body.action === 'check') {
      // Per-template status check: fetch THIS template's approval from
      // Twilio and update just its row — so "did my template get
      // approved?" is one click on the template, not a full re-import.
      const templateId = typeof body.id === 'string' ? body.id : null;
      if (!templateId) {
        return NextResponse.json(
          { error: 'Template id is required.' },
          { status: 400 }
        );
      }
      const { data: tplRow, error: tplErr } = await channelAdmin()
        .from('message_templates')
        .select('id, twilio_content_sid, status')
        .eq('id', templateId)
        .eq('account_id', accountId)
        .maybeSingle();
      if (tplErr) throw tplErr;
      if (!tplRow) {
        return NextResponse.json(
          { error: 'Template not found.' },
          { status: 404 }
        );
      }
      if (!tplRow.twilio_content_sid) {
        return NextResponse.json(
          {
            error:
              'This template has not been submitted to Twilio yet — submit it for review first.',
          },
          { status: 400 }
        );
      }
      const approval = await getTwilioApproval(
        credentials,
        tplRow.twilio_content_sid
      );
      const status = approvalStatus(approval?.status);
      const { error: updErr } = await channelAdmin()
        .from('message_templates')
        .update({
          status,
          rejection_reason: approval?.rejection_reason ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', tplRow.id)
        .eq('account_id', accountId);
      if (updErr) throw updErr;
      return NextResponse.json({
        status,
        rejection_reason: approval?.rejection_reason ?? null,
        provider: 'twilio',
      });
    }

    if (body.action === 'sync') {
      // v2 ContentAndApprovals returns approval status inline — one
      // paginated call instead of one ApprovalRequests fetch per
      // template (docs: /docs/content/content-api-resources).
      const contents = await listTwilioContentAndApprovals(credentials);

      // Twilio allows many Content SIDs with the same friendly_name,
      // but our table is unique on (account_id, provider, name,
      // language). Provider IS part of that key, so a Meta Cloud API
      // template with the same name coexists as its own row — this
      // dedup only ranks duplicates WITHIN the Twilio catalog. Without
      // ranking,
      // whichever duplicate the API listed LAST won the upsert — an
      // old "unsubmitted" copy would stomp the in-review/approved one
      // back to DRAFT (the exact bug seen with
      // customer_support_routing_template × 4). Keep the copy with the
      // best approval status; tie-break on most recently updated.
      const STATUS_RANK: Record<string, number> = {
        approved: 6,
        received: 5,
        pending: 5,
        paused: 4,
        disabled: 3,
        rejected: 2,
        unsubmitted: 1,
      };
      const byKey = new Map<string, (typeof contents)[number]>();
      for (const content of contents) {
        const key = `${content.friendly_name}::${content.language}`;
        const prev = byKey.get(key);
        if (!prev) {
          byKey.set(key, content);
          continue;
        }
        const rank = (c: (typeof contents)[number]) =>
          STATUS_RANK[c.approval_requests?.status?.toLowerCase() ?? ''] ?? 0;
        const newer = (c: (typeof contents)[number]) =>
          Date.parse(c.date_updated ?? c.date_created ?? '') || 0;
        if (
          rank(content) > rank(prev) ||
          (rank(content) === rank(prev) && newer(content) > newer(prev))
        ) {
          byKey.set(key, content);
        }
      }
      const deduped = Array.from(byKey.values());

      let inserted = 0;
      let updated = 0;
      for (const content of deduped) {
        const normalized = normalizeTwilioContent(content);
        const approval = content.approval_requests ?? null;
        const row = {
          account_id: accountId,
          user_id: userId,
          provider: 'twilio',
          twilio_content_sid: content.sid,
          meta_template_id: null,
          name: content.friendly_name,
          language: content.language,
          category: inferCategory(approval?.category, content.friendly_name),
          body_text: normalized.body,
          header_type: normalized.mediaUrl ? 'image' : null,
          header_content: normalized.mediaUrl,
          buttons: normalized.buttons.length ? normalized.buttons : null,
          sample_values: content.variables
            ? {
                body: Object.keys(content.variables)
                  .sort()
                  .map((key) => content.variables?.[key] ?? ''),
              }
            : null,
          status: approvalStatus(approval?.status),
          rejection_reason: approval?.rejection_reason ?? null,
          submission_error: null,
        };
        const { data: existing } = await channelAdmin()
          .from('message_templates')
          .select('id')
          .eq('account_id', accountId)
          .eq('provider', 'twilio')
          .eq('twilio_content_sid', content.sid)
          .maybeSingle();
        // Upsert on the account-scoped unique index so a locally
        // drafted template with the same (name, language) is adopted
        // by the sync instead of failing with 23505.
        const result = existing
          ? await channelAdmin()
              .from('message_templates')
              .update(row)
              .eq('id', existing.id)
              .eq('account_id', accountId)
          : await channelAdmin()
              .from('message_templates')
              .upsert(row, {
                onConflict: 'account_id,provider,name,language',
              });
        if (result.error) throw result.error;
        if (existing) updated++;
        else inserted++;
      }
      return NextResponse.json({
        total: contents.length,
        inserted,
        updated,
        provider: 'twilio',
      });
    }

    const parsed = createSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: 'Invalid Twilio template', details: parsed.error.flatten() },
        { status: 400 }
      );
    const input = parsed.data;

    // ---- assemble the Twilio-compliant template -------------------
    // Twilio's Content API has no separate text-header/footer params
    // (only Meta does): a text header becomes a bold first line and
    // the footer a subtly-italic last line, so what the user designed
    // is what WhatsApp reviews and customers see. Header variables
    // ({{1}}…) are renumbered ahead of the body's so numbering stays
    // unique across the merged text.
    const isImageHeader = input.header_type === 'image';
    const headerText =
      !isImageHeader && input.header_content?.trim()
        ? input.header_content.trim()
        : null;
    const headerSamples = input.sample_values?.header ?? [];
    const bodySamples = input.sample_values?.body ?? [];

    let mergedBody = input.body_text;
    let samples = bodySamples;
    if (headerText) {
      const headerVarCount = new Set(
        Array.from(headerText.matchAll(/\{\{(\d+)\}\}/g), (m) => m[1])
      ).size;
      const shiftedBody = headerVarCount
        ? input.body_text.replace(
            /\{\{(\d+)\}\}/g,
            (_, n) => `{{${Number(n) + headerVarCount}}}`
          )
        : input.body_text;
      mergedBody = `*${headerText}*\n\n${shiftedBody}`;
      samples = [...headerSamples, ...bodySamples];
    }
    if (input.footer_text?.trim())
      mergedBody = `${mergedBody}\n\n_${input.footer_text.trim()}_`;

    // Image headers require a public URL sample for review, and
    // Twilio's basic content types don't combine media with buttons.
    const mediaUrl = isImageHeader ? input.header_content?.trim() : undefined;
    if (isImageHeader && !/^https:\/\//.test(mediaUrl ?? '')) {
      return NextResponse.json(
        {
          error:
            'Image headers need a public https image URL — upload the image somewhere public and paste its link.',
        },
        { status: 400 }
      );
    }
    if (mediaUrl && input.buttons?.length) {
      return NextResponse.json(
        {
          error:
            'Twilio WhatsApp templates can\u2019t have both an image header and buttons — remove one of them.',
        },
        { status: 400 }
      );
    }

    // Catch WhatsApp auto-reject rules NOW instead of a silent
    // rejection 48 hours from now.
    const validationError = validateWhatsAppTemplateBody(mergedBody, samples);
    if (validationError)
      return NextResponse.json({ error: validationError }, { status: 400 });

    const variables = Object.fromEntries(
      samples.map((value, index) => [String(index + 1), value])
    );
    const content = await createTwilioContent(credentials, {
      name: input.name,
      language: input.language,
      body: mergedBody,
      mediaUrl,
      buttons: input.buttons as TemplateButton[] | undefined,
      variables,
    });
    const approval = await submitTwilioApproval(credentials, content.sid, {
      name: input.name,
      category: input.category,
    });
    // Upsert on the account-scoped unique index: re-submitting a
    // template that already has a local row (e.g. a saved draft with
    // the same name + language) updates it instead of failing 23505.
    const { data, error } = await channelAdmin()
      .from('message_templates')
      .upsert(
        {
          account_id: accountId,
          user_id: userId,
          provider: 'twilio',
          twilio_content_sid: content.sid,
          name: input.name,
          category: input.category,
          language: input.language,
          header_type: input.header_content
            ? (input.header_type ?? 'text')
            : null,
          header_content: input.header_content ?? null,
          body_text: input.body_text,
          footer_text: input.footer_text ?? null,
          buttons: input.buttons ?? null,
          sample_values: input.sample_values ?? null,
          status: approvalStatus(approval.status),
          last_submitted_at: new Date().toISOString(),
          submission_error: null,
        },
        { onConflict: 'account_id,provider,name,language' }
      )
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          {
            error: `A template named "${input.name}" (${input.language}) already exists on this workspace.`,
          },
          { status: 409 }
        );
      }
      throw error;
    }
    return NextResponse.json(
      { template: data, provider: 'twilio' },
      { status: 201 }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith('Connect and enable') ||
        error.message.startsWith('No Twilio connection'))
    )
      return NextResponse.json({ error: error.message }, { status: 409 });
    return toErrorResponse(error);
  }
}
