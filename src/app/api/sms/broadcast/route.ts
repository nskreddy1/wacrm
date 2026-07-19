import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { TwilioSmsAdapter } from '@/lib/channels/adapters/twilio-sms'
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import type { ChannelConnection } from '@/types'

interface SmsBroadcastRecipient {
  phone: string
  /** Fully rendered message body — variables are resolved client-side. */
  body: string
}

interface SmsBroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  /** Twilio Message SID (SM…) when accepted. */
  message_id?: string
  error?: string
}

/**
 * Twilio error 21610: "Attempt to send to unsubscribed recipient" —
 * the number previously texted STOP. When we see it, the contact's
 * opt-out flag is stale (e.g. they replied STOP before this feature
 * shipped), so we backfill it to keep future sends clean.
 */
const TWILIO_OPT_OUT_ERROR = '21610'

/**
 * SMS broadcast fan-out.
 *
 * Counterpart of /api/whatsapp/broadcast for the SMS channel. Accepts
 * pre-rendered per-recipient bodies (SMS has no carrier template
 * concept — personalization happens in the sending hook) and sends
 * each through the account's enabled Twilio SMS channel connection.
 *
 * Compliance: message content is validated at template-save time
 * (TCPA/CTIA checks in lib/templates/compliance.ts); this route only
 * enforces transport-level rules (E.164 recipients, rate budget).
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Same per-user campaign budget as WhatsApp broadcasts.
    const limit = checkRateLimit(`broadcast:${user.id}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const recipients: SmsBroadcastRecipient[] = Array.isArray(body?.recipients)
      ? body.recipients
      : []
    if (recipients.length === 0) {
      return NextResponse.json(
        { error: '`recipients` must be a non-empty array of { phone, body }' },
        { status: 400 },
      )
    }
    if (recipients.some((r) => typeof r.body !== 'string' || !r.body.trim())) {
      return NextResponse.json(
        { error: 'Every recipient needs a non-empty message body' },
        { status: 400 },
      )
    }

    // Resolve the account's SMS sender — a Twilio SMS channel
    // connection. Fetch without the enabled filter first so we can
    // tell the user exactly what is wrong (missing vs disabled).
    const { data: connectionRows } = await supabase
      .from('channel_connections')
      .select('*')
      .eq('account_id', accountId)
      .eq('channel', 'sms')
      .order('is_primary', { ascending: false })
    const connectionRow = (connectionRows ?? []).find((row) => row.is_enabled)
    if (!connectionRow) {
      const hasDisabled = (connectionRows ?? []).length > 0
      return NextResponse.json(
        {
          error: hasDisabled
            ? 'Your SMS connection is saved but not enabled. In Settings → Channels → SMS, run "Test connection" and switch it on, then retry this broadcast.'
            : 'SMS is not connected. Add a Twilio SMS number in Settings → Channels first.',
        },
        { status: 400 },
      )
    }
    const connection = connectionRow as ChannelConnection

    // Opt-out compliance (Twilio error 21610): skip contacts that
    // texted STOP before wasting a send Twilio would block anyway.
    // Contacts store digits-only phones, matching sanitizePhoneForMeta.
    const sanitizedPhones = recipients
      .map((r) => sanitizePhoneForMeta(r.phone))
      .filter((p) => isValidE164(p))
    const { data: optedOutRows } = await supabase
      .from('contacts')
      .select('phone')
      .eq('account_id', accountId)
      .eq('sms_opted_out', true)
      .in('phone', sanitizedPhones)
    const optedOutPhones = new Set((optedOutRows ?? []).map((row) => row.phone as string))

    const adapter = new TwilioSmsAdapter()
    const results: SmsBroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const recipient of recipients) {
      const sanitized = sanitizePhoneForMeta(recipient.phone)
      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      if (optedOutPhones.has(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Recipient opted out of SMS (replied STOP)',
        })
        failedCount++
        continue
      }

      try {
        const result = await adapter.send({
          accountId,
          connection,
          recipient: {
            // Broadcast recipients are keyed by phone here; the
            // sending hook owns the contact/recipient row updates.
            contactId: '',
            identity: `+${sanitized}`,
          },
          contentType: 'text',
          payload: { kind: 'text', text: recipient.body },
          idempotencyKey: randomUUID(),
        })
        results.push({
          phone: recipient.phone,
          status: 'sent',
          message_id: result.externalMessageId,
        })
        sentCount++
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error'
        console.error(`Failed to send SMS broadcast to ${recipient.phone}:`, message)
        // Backfill stale opt-out state when Twilio rejects with 21610
        // so the next campaign skips this number up front.
        if (message.includes(TWILIO_OPT_OUT_ERROR)) {
          await supabase
            .from('contacts')
            .update({ sms_opted_out: true, sms_opted_out_at: new Date().toISOString() })
            .eq('account_id', accountId)
            .eq('phone', sanitized)
        }
        results.push({ phone: recipient.phone, status: 'failed', error: message })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    console.error('Error in SMS broadcast POST:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 },
    )
  }
}
