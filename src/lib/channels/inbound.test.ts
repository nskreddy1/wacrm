import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/api/v1/contacts', () => ({
  resolveAuditUserId: vi.fn(async () => 'owner-1'),
}))

import { persistInboundChannelMessage } from './inbound'

interface MockState {
  duplicate: boolean
  identityContactId: string | null
  existingContactId: string | null
  conversation: { id: string; unread_count: number } | null
  priorInboundCount: number
  insertedContacts: unknown[]
}

function createDb(state: MockState): SupabaseClient {
  function resolve(ops: { table: string; type: string; payload?: unknown }) {
    if (ops.table === 'channel_webhook_events' && ops.type === 'insert') {
      return state.duplicate
        ? { data: null, error: { code: '23505' } }
        : { data: { id: 'event-1' }, error: null }
    }
    if (ops.table === 'contact_identities' && ops.type === 'select') {
      return { data: state.identityContactId ? { contact_id: state.identityContactId } : null, error: null }
    }
    if (ops.table === 'contacts' && ops.type === 'select') {
      return { data: state.existingContactId ? { id: state.existingContactId } : null, error: null }
    }
    if (ops.table === 'contacts' && ops.type === 'insert') {
      state.insertedContacts.push(ops.payload)
      return { data: { id: 'contact-created' }, error: null }
    }
    if (ops.table === 'conversations' && ops.type === 'select') {
      return { data: state.conversation, error: null }
    }
    if (ops.table === 'conversations' && ops.type === 'insert') {
      return { data: { id: 'conversation-created', unread_count: 0 }, error: null }
    }
    if (ops.table === 'messages' && ops.type === 'select') {
      return { data: null, count: state.priorInboundCount, error: null }
    }
    return { data: null, error: null }
  }

  function builder(table: string) {
    const ops = { table, type: 'select', payload: undefined as unknown }
    const chain = {
      select: () => chain,
      insert: (payload: unknown) => { ops.type = 'insert'; ops.payload = payload; return chain },
      update: (payload: unknown) => { ops.type = 'update'; ops.payload = payload; return chain },
      upsert: (payload: unknown) => { ops.type = 'upsert'; ops.payload = payload; return chain },
      eq: () => chain,
      single: () => Promise.resolve(resolve(ops)),
      maybeSingle: () => Promise.resolve(resolve(ops)),
      then: (fulfilled: (value: unknown) => unknown, rejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve(ops)).then(fulfilled, rejected),
    }
    return chain
  }

  return { from: (table: string) => builder(table) } as unknown as SupabaseClient
}

const connection = {
  id: 'connection-1',
  account_id: 'account-1',
  created_by_user_id: 'owner-1',
  external_identity: '15550000000',
}
const message = {
  provider: 'twilio' as const,
  externalMessageId: 'SM123',
  from: 'whatsapp:+15551112222',
  to: '+15550000000',
  text: 'Hello',
  payload: {},
}

let state: MockState
beforeEach(() => {
  state = {
    duplicate: false,
    identityContactId: null,
    existingContactId: null,
    conversation: null,
    priorInboundCount: 0,
    insertedContacts: [],
  }
})

describe('persistInboundChannelMessage metadata', () => {
  it('returns the duplicate branch without resolving message metadata', async () => {
    state.duplicate = true

    await expect(persistInboundChannelMessage(createDb(state), connection, message)).resolves.toEqual({ duplicate: true })
  })

  it('reports a newly created contact and first inbound message', async () => {
    const result = await persistInboundChannelMessage(createDb(state), connection, message)

    expect(result).toEqual({
      duplicate: false,
      conversationId: 'conversation-created',
      contactId: 'contact-created',
      contactCreated: true,
      isFirstInboundMessage: true,
    })
    expect(state.insertedContacts).toHaveLength(1)
  })

  it('reports an existing contact and subsequent inbound message', async () => {
    state.identityContactId = 'contact-existing'
    state.conversation = { id: 'conversation-existing', unread_count: 2 }
    state.priorInboundCount = 1

    const result = await persistInboundChannelMessage(createDb(state), connection, message)

    expect(result).toMatchObject({
      duplicate: false,
      conversationId: 'conversation-existing',
      contactId: 'contact-existing',
      contactCreated: false,
      isFirstInboundMessage: false,
    })
    expect(state.insertedContacts).toHaveLength(0)
  })
})
