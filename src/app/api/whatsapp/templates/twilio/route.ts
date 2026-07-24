import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole, toErrorResponse } from '@/features/auth/lib/account';
import { channelAdmin } from '@/features/channels/lib/admin-client';
import { decryptProviderCredentials } from '@/features/channels/lib/credentials';
import {
  createTwilioContent,
  listTwilioContentAndApprovals,
  normalizeTwilioContent,
  submitTwilioApproval,
} from '@/features/whatsapp/lib/twilio-content';
import type { ChannelConnection, TemplateButton } from '@/types';

const createSchema = z.object({
  action: z.literal('create'),
  name: z.string().trim().min(1).max(512),
  category: z.enum(['Marketing', 'Utility', 'Authentication']),
  language: z.string().trim().min(2).max(12),
  body_text: z.string().trim().min(1).max(1600),
  header_content: z.string().trim().optional(),
  footer_text: z.string().trim().optional(),
  buttons: z.array(z.record(z.string(), z.unknown())).optional(),
  sample_values: z
    .object({
      body: z.array(z.string()).optional(),
      header: z.array(z.string()).optional(),
    })
    .optional(),
});

async function connectionFor(accountId: string) {
  const { data, error } = await channelAdmin()
    .from('channel_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('channel', 'whatsapp')
    .eq('provider', 'twilio')
    .eq('is_enabled', true)
    .order('is_primary', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new Error(
      'Connect and enable a Twilio WhatsApp channel before managing Twilio templates.'
    );
  const credentials = decryptProviderCredentials(
    data as ChannelConnection & { credentials_encrypted?: string }
  );
  if (credentials.provider !== 'twilio')
    throw new Error('Twilio credentials are unavailable.');
  return credentials.value;
}

function approvalStatus(value?: string) {
  const status = value?.toLowerCase();
  if (status === 'approved' || status === 'received')
    return status === 'approved' ? 'APPROVED' : 'PENDING';
  if (status === 'rejected') return 'REJECTED';
  if (status === 'paused') return 'PAUSED';
  return 'DRAFT';
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('agent');
    const credentials = await connectionFor(accountId);
    const body = await request.json().catch(() => ({}));

    if (body.action === 'sync') {
      // v2 ContentAndApprovals returns approval status inline — one
      // paginated call instead of one ApprovalRequests fetch per
      // template (docs: /docs/content/content-api-resources).
      const contents = await listTwilioContentAndApprovals(credentials);
      let inserted = 0;
      let updated = 0;
      for (const content of contents) {
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
          category:
            approval?.category === 'UTILITY'
              ? 'Utility'
              : approval?.category === 'AUTHENTICATION'
                ? 'Authentication'
                : 'Marketing',
          body_text: normalized.body,
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
        const result = existing
          ? await channelAdmin()
              .from('message_templates')
              .update(row)
              .eq('id', existing.id)
              .eq('account_id', accountId)
          : await channelAdmin().from('message_templates').insert(row);
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
    const variables = Object.fromEntries(
      (input.sample_values?.body ?? []).map((value, index) => [
        String(index + 1),
        value,
      ])
    );
    const content = await createTwilioContent(credentials, {
      name: input.name,
      language: input.language,
      body: input.body_text,
      header: input.header_content,
      footer: input.footer_text,
      buttons: input.buttons as TemplateButton[] | undefined,
      variables,
    });
    const approval = await submitTwilioApproval(credentials, content.sid, {
      name: input.name,
      category: input.category,
    });
    const { data, error } = await channelAdmin()
      .from('message_templates')
      .insert({
        account_id: accountId,
        user_id: userId,
        provider: 'twilio',
        twilio_content_sid: content.sid,
        name: input.name,
        category: input.category,
        language: input.language,
        header_type: input.header_content ? 'text' : null,
        header_content: input.header_content ?? null,
        body_text: input.body_text,
        footer_text: input.footer_text ?? null,
        buttons: input.buttons ?? null,
        sample_values: input.sample_values ?? null,
        status: approvalStatus(approval.status),
        last_submitted_at: new Date().toISOString(),
        submission_error: null,
      })
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(
      { template: data, provider: 'twilio' },
      { status: 201 }
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Connect and enable')
    )
      return NextResponse.json({ error: error.message }, { status: 409 });
    return toErrorResponse(error);
  }
}
