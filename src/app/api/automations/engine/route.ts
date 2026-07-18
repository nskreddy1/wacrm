import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import type { AutomationTriggerType } from '@/types'

/**
 * Manual trigger for testing or for external integrations that want
 * to fire automations. Auth is required — we resolve the caller's
 * account_id and dispatch over the account's automations.
 */
const SUPPORTED_TRIGGER_TYPES = new Set<AutomationTriggerType>([
  'new_message_received',
  'first_inbound_message',
  'keyword_match',
  'new_contact_created',
  'conversation_assigned',
  'tag_added',
  'time_based',
  'interactive_reply',
])

export async function POST(request: Request) {
  // Firing automations sends outbound WhatsApp — a write action. Require
  // at least `agent`; a viewer must not be able to trigger sends.
  let accountId: string
  try {
    const ctx = await requireRole('agent')
    accountId = ctx.accountId
  } catch (err) {
    return toErrorResponse(err)
  }

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (
    typeof body.trigger_type !== 'string' ||
    !SUPPORTED_TRIGGER_TYPES.has(body.trigger_type as AutomationTriggerType)
  ) {
    return NextResponse.json(
      { error: 'trigger_type is missing or unsupported' },
      { status: 400 },
    )
  }
  if (body.contact_id != null && typeof body.contact_id !== 'string') {
    return NextResponse.json({ error: 'contact_id must be a string' }, { status: 400 })
  }
  if (
    body.context != null &&
    (typeof body.context !== 'object' || Array.isArray(body.context))
  ) {
    return NextResponse.json({ error: 'context must be an object' }, { status: 400 })
  }

  await runAutomationsForTrigger({
    accountId,
    triggerType: body.trigger_type as AutomationTriggerType,
    contactId: body.contact_id ?? null,
    context: body.context ?? {},
  })

  return NextResponse.json({ ok: true })
}
