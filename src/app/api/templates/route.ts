import { NextResponse } from 'next/server'
import { z } from 'zod'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkCompliance } from '@/lib/templates/compliance'

/**
 * Unified template surface for the Template Studio.
 *
 * GET  — list every template on the account (WhatsApp + SMS),
 *        newest first. RLS scopes rows to the caller's account.
 * POST — save a draft (WhatsApp) or save/activate (SMS).
 *
 * WhatsApp *submission* stays on the provider-specific routes —
 * `/api/whatsapp/templates/submit` (Meta) and
 * `/api/whatsapp/templates/twilio` (Twilio Content API) — because
 * those already own credential decryption, dry-run mode, resumable
 * header uploads, and provider status normalization. This route
 * only handles the channel-agnostic persistence layer.
 *
 * SMS templates need no carrier approval, but they DO need to obey
 * TCPA/CTIA rules — `checkCompliance` runs server-side here and
 * blocks saves with `error`-level violations. The audit result is
 * persisted to the `compliance` column.
 */

const buttonSchema = z.object({
  type: z.enum(['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE']),
  text: z.string().trim().min(1).max(25),
  url: z.string().trim().optional(),
  phone_number: z.string().trim().optional(),
  example: z.string().trim().optional(),
})

const saveSchema = z.discriminatedUnion('channel', [
  z.object({
    channel: z.literal('whatsapp'),
    id: z.string().uuid().optional(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[a-z0-9_]+$/, 'Name must be lowercase letters, digits, and underscores.'),
    category: z.enum(['Marketing', 'Utility', 'Authentication']),
    language: z.string().trim().min(2).max(12),
    header_type: z.enum(['text', 'image']).nullable().optional(),
    header_content: z.string().trim().max(60).nullable().optional(),
    body_text: z.string().trim().min(1).max(1024),
    footer_text: z.string().trim().max(60).nullable().optional(),
    buttons: z.array(buttonSchema).max(10).nullable().optional(),
    sample_values: z
      .object({ body: z.array(z.string()).optional(), header: z.array(z.string()).optional() })
      .nullable()
      .optional(),
    provider: z.enum(['meta', 'twilio']),
  }),
  z.object({
    channel: z.literal('sms'),
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(512),
    category: z.enum(['marketing', 'transactional', 'otp']),
    language: z.string().trim().min(2).max(12),
    body_text: z.string().trim().min(1).max(1600),
    sample_values: z
      .object({ body: z.array(z.string()).optional() })
      .nullable()
      .optional(),
  }),
])

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { data, error } = await supabase
      .from('message_templates')
      .select(
        'id, name, channel, provider, category, language, status, header_type, header_content, header_media_url, body_text, footer_text, buttons, sample_values, compliance, rejection_reason, submission_error, meta_template_id, twilio_content_sid, updated_at, created_at',
      )
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ templates: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const raw = await request.json().catch(() => null)
    const parsed = saveSchema.safeParse(raw)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      return NextResponse.json(
        { error: `${first?.path.join('.') || 'payload'}: ${first?.message || 'Invalid input.'}` },
        { status: 400 },
      )
    }
    const input = parsed.data

    // Server-side compliance gate. Error-level violations block the
    // save; warnings are persisted so the UI can keep surfacing them.
    const compliance = checkCompliance(
      input.channel === 'whatsapp'
        ? {
            channel: 'whatsapp',
            category: input.category.toLowerCase(),
            body: input.body_text,
            footer: input.footer_text ?? '',
            hasButtons: (input.buttons?.length ?? 0) > 0,
          }
        : { channel: 'sms', category: input.category, body: input.body_text },
    )
    if (!compliance.ok) {
      return NextResponse.json(
        {
          error: compliance.issues.find((i) => i.level === 'error')?.message ?? 'Compliance check failed.',
          compliance: compliance.issues,
        },
        { status: 422 },
      )
    }

    // Single object shape (not a per-channel union) so Supabase's
    // typed insert accepts it. WhatsApp saves as DRAFT (submission
    // happens via the provider routes); SMS has no carrier review,
    // so a compliant save is immediately APPROVED/live.
    const isWhatsApp = input.channel === 'whatsapp'
    const row = {
      account_id: accountId,
      user_id: userId,
      channel: input.channel,
      provider: isWhatsApp ? input.provider : 'none',
      name: input.name,
      category: input.category,
      language: input.language,
      header_type: isWhatsApp ? (input.header_type ?? null) : null,
      header_content: isWhatsApp ? (input.header_content ?? null) : null,
      body_text: input.body_text,
      footer_text: isWhatsApp ? (input.footer_text ?? null) : null,
      buttons: isWhatsApp && input.buttons?.length ? input.buttons : null,
      sample_values: input.sample_values ?? null,
      status: isWhatsApp ? 'DRAFT' : 'APPROVED',
      compliance: compliance.audit,
      submission_error: null,
    }

    if (input.id) {
      const { data, error } = await supabase
        .from('message_templates')
        .update(row)
        .eq('id', input.id)
        .eq('account_id', accountId)
        .select()
        .single()
      if (error) throw error
      return NextResponse.json({ template: data, compliance: compliance.issues })
    }

    const { data, error } = await supabase
      .from('message_templates')
      .insert(row)
      .select()
      .single()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `A template named "${input.name}" (${input.language}) already exists.` },
          { status: 409 },
        )
      }
      throw error
    }
    return NextResponse.json({ template: data, compliance: compliance.issues }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
