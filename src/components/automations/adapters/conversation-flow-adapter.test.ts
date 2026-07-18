import { describe, expect, it } from 'vitest'
import {
  conversationFlowToDocument,
  documentToConversationFlow,
  type ConversationFlowNodeRecord,
  type ConversationFlowRecord,
} from './conversation-flow-adapter'

const flow: ConversationFlowRecord = {
  id: 'flow-1',
  name: 'Inbound qualification',
  description: 'Qualifies new conversations',
  status: 'draft',
  trigger_type: 'keyword',
  trigger_config: { keywords: ['pricing'] },
  entry_node_id: 'message-1',
}

const nodes: ConversationFlowNodeRecord[] = [
  {
    node_key: 'message-1',
    node_type: 'message',
    config: { body: 'How can we help?', next_node_id: 'branch-1' },
    position_x: 240,
    position_y: 120,
  },
  {
    node_key: 'branch-1',
    node_type: 'branch',
    config: { field: 'reply', yes_node_id: 'assign-1', no_node_id: 'wait-1' },
    position_x: 480,
    position_y: 240,
  },
  {
    node_key: 'assign-1',
    node_type: 'assign',
    config: { team: 'sales' },
    position_x: 720,
    position_y: 160,
  },
  {
    node_key: 'wait-1',
    node_type: 'wait_for_reply',
    config: { timeout_minutes: 60 },
    position_x: 720,
    position_y: 320,
  },
]

describe('conversation flow adapter', () => {
  it('round-trips node keys, graph pointers, configuration, and positions', () => {
    const payload = documentToConversationFlow(conversationFlowToDocument(flow, nodes))

    expect(payload).toEqual({
      name: flow.name,
      description: flow.description,
      trigger_type: flow.trigger_type,
      trigger_config: flow.trigger_config,
      entry_node_id: flow.entry_node_id,
      nodes: nodes.map((node) => ({
        node_key: node.node_key,
        node_type: node.node_type,
        config: node.config,
        position_x: node.position_x,
        position_y: node.position_y,
      })),
    })
  })
})
