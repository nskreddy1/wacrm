import 'server-only'

import type { TemplateButton } from '@/types'
import type { TwilioCredentials } from '@/lib/channels/credentials'

const CONTENT_BASE = 'https://content.twilio.com/v1'

export interface TwilioContentItem {
  sid: string
  friendly_name: string
  language: string
  variables?: Record<string, string>
  types?: Record<string, Record<string, unknown>>
}

export interface TwilioApproval {
  status?: string
  rejection_reason?: string
  name?: string
  category?: string
}

function headers(credentials: TwilioCredentials) {
  return {
    Authorization: `Basic ${Buffer.from(`${credentials.accountSid}:${credentials.authToken}`).toString('base64')}`,
    'Content-Type': 'application/json',
  }
}

async function request<T>(credentials: TwilioCredentials, url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { ...headers(credentials), ...init?.headers } })
  const result = (await response.json().catch(() => ({}))) as T & { message?: string; code?: number }
  if (!response.ok) throw new Error(result.message ?? `Twilio Content API failed (${response.status})`)
  return result
}

export async function listTwilioContent(credentials: TwilioCredentials): Promise<TwilioContentItem[]> {
  const items: TwilioContentItem[] = []
  let url: string | null = `${CONTENT_BASE}/Content?PageSize=100`
  while (url) {
    const page: { contents?: TwilioContentItem[]; meta?: { next_page_url?: string | null } } = await request(credentials, url)
    items.push(...(page.contents ?? []))
    const next: string | null | undefined = page.meta?.next_page_url
    url = next ? (next.startsWith('http') ? next : `https://content.twilio.com${next}`) : null
  }
  return items
}

export async function getTwilioApproval(credentials: TwilioCredentials, sid: string): Promise<TwilioApproval | null> {
  try {
    // Per Twilio Content API docs: status is fetched from
    // GET /v1/Content/{sid}/ApprovalRequests and arrives nested in a
    // `whatsapp` object ({ whatsapp: { status, rejection_reason, … } }).
    // The `/ApprovalRequests/whatsapp` path is POST-only (submission).
    const result = await request<{ whatsapp?: TwilioApproval }>(
      credentials,
      `${CONTENT_BASE}/Content/${encodeURIComponent(sid)}/ApprovalRequests`,
    )
    return result.whatsapp ?? null
  } catch {
    return null
  }
}

export interface TwilioContentWithApproval extends TwilioContentItem {
  approval_requests?: TwilioApproval & { content_type?: string }
}

/**
 * Bulk list of contents WITH approval statuses in one call
 * (GET /v2/ContentAndApprovals) — used by the sync route so it does
 * one paginated request instead of one ApprovalRequests fetch per
 * template.
 */
export async function listTwilioContentAndApprovals(
  credentials: TwilioCredentials,
): Promise<TwilioContentWithApproval[]> {
  const items: TwilioContentWithApproval[] = []
  let url: string | null = `https://content.twilio.com/v2/ContentAndApprovals?PageSize=100`
  while (url) {
    const page: { contents?: TwilioContentWithApproval[]; meta?: { next_page_url?: string | null } } =
      await request(credentials, url)
    items.push(...(page.contents ?? []))
    const next: string | null | undefined = page.meta?.next_page_url
    url = next ? (next.startsWith('http') ? next : `https://content.twilio.com${next}`) : null
  }
  return items
}

export async function createTwilioContent(credentials: TwilioCredentials, input: {
  name: string
  language: string
  body: string
  header?: string
  footer?: string
  buttons?: TemplateButton[]
  variables?: Record<string, string>
}): Promise<TwilioContentItem> {
  const quickReplies = (input.buttons ?? []).filter((button) => button.type === 'QUICK_REPLY').map((button) => ({ title: button.text, id: button.text }))
  const actions: Array<Record<string, string>> = []
  for (const button of input.buttons ?? []) {
    if (button.type === 'URL') actions.push({ type: 'URL', title: button.text, url: button.url })
    if (button.type === 'PHONE_NUMBER') actions.push({ type: 'PHONE', title: button.text, phone: button.phone_number })
  }
  const types: Record<string, unknown> = quickReplies.length
    ? { 'twilio/quick-reply': { body: input.body, actions: quickReplies } }
    : actions.length
      ? { 'twilio/call-to-action': { body: input.body, actions } }
      : { 'twilio/text': { body: input.body } }
  return request<TwilioContentItem>(credentials, `${CONTENT_BASE}/Content`, {
    method: 'POST',
    body: JSON.stringify({ friendly_name: input.name, language: input.language, variables: input.variables ?? {}, types }),
  })
}

export async function submitTwilioApproval(credentials: TwilioCredentials, sid: string, input: { name: string; category: string }) {
  return request<TwilioApproval>(credentials, `${CONTENT_BASE}/Content/${encodeURIComponent(sid)}/ApprovalRequests/whatsapp`, {
    method: 'POST',
    body: JSON.stringify({ name: input.name, category: input.category.toUpperCase() }),
  })
}

export function normalizeTwilioContent(item: TwilioContentItem) {
  const types = item.types ?? {}
  const value = (types['twilio/text'] ?? types['twilio/quick-reply'] ?? types['twilio/call-to-action'] ?? Object.values(types)[0] ?? {}) as Record<string, unknown>
  const actions = Array.isArray(value.actions) ? value.actions as Array<Record<string, string>> : []
  const buttons: TemplateButton[] = []
  for (const action of actions) {
    if (action.type === 'URL') buttons.push({ type: 'URL', text: action.title ?? 'Open', url: action.url ?? '' })
    else if (action.type === 'PHONE') buttons.push({ type: 'PHONE_NUMBER', text: action.title ?? 'Call', phone_number: action.phone ?? '' })
    else buttons.push({ type: 'QUICK_REPLY', text: action.title ?? action.id ?? 'Reply' })
  }
  return { body: String(value.body ?? ''), buttons }
}
