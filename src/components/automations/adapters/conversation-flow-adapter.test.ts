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
  entry_node_id: 'start-1',
}

const nodes: ConversationFlowNodeRecord[] = [
  {
    node_key: 'start-1',
    node_type: 'start',
    config: { next_node_key: 'buttons-1', future_key: 'preserved' },
    position_x: 120,
    position_y: 120,
  },
  {
    node_key: 'buttons-1',
    node_type: 'send_buttons',
    config: {
      text: 'How can we help?',
      buttons: [
        { reply_id: 'sales', title: 'Sales', next_node_key: 'condition-1' },
        { reply_id: 'support', title: 'Support', next_node_key: 'end-1' },
      ],
    },
    position_x: 360,
    position_y: 120,
  },
  {
    node_key: 'condition-1',
    node_type: 'condition',
    config: {
      subject: 'var',
      subject_key: 'qualified',
      operator: 'present',
      true_next: 'end-1',
      false_next: 'message-1',
    },
    position_x: 600,
    position_y: 160,
  },
  {
    node_key: 'message-1',
    node_type: 'send_message',
    config: { text: 'Thanks', next_node_key: 'end-1' },
    position_x: 840,
    position_y: 240,
  },
  {
    node_key: 'end-1',
    node_type: 'end',
    config: {},
    position_x: 1080,
    position_y: 120,
  },
]

describe('conversation flow adapter', () => {
  it('round-trips runtime pointer fields, unknown config, and positions', () => {
    const document = conversationFlowToDocument(flow, nodes)
    expect(document.nodes.find((node) => node.id === 'start-1')?.config).toEqual({
      future_key: 'preserved',
    })
    expect(document.edges.map((edge) => edge.sourceHandle)).toEqual(
      expect.arrayContaining([undefined, 'button:sales', 'button:support', 'true', 'false']),
    )

    const payload = documentToConversationFlow(document)
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
