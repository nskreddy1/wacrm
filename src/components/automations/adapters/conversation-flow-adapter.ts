import type {
  AutomationEditorDocument,
  AutomationEditorEdge,
  AutomationEditorNode,
} from '@/components/automation-editor/document'

const ROOT_ID = 'trigger'
const POINTER_KEYS = ['next_node_id', 'yes_node_id', 'no_node_id'] as const

export interface ConversationFlowRecord {
  id?: string
  name: string
  description?: string | null
  status?: 'draft' | 'active' | 'paused'
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual'
  trigger_config?: Record<string, unknown> | null
  entry_node_id?: string | null
}

export interface ConversationFlowNodeRecord {
  node_key: string
  node_type: string
  config?: Record<string, unknown> | null
  position_x?: number | null
  position_y?: number | null
}

export interface ConversationFlowPayload {
  name: string
  description: string | null
  trigger_type: ConversationFlowRecord['trigger_type']
  trigger_config: Record<string, unknown>
  entry_node_id: string | null
  nodes: Array<{
    node_key: string
    node_type: string
    config: Record<string, unknown>
    position_x: number
    position_y: number
  }>
}

export function conversationFlowToDocument(
  flow: ConversationFlowRecord,
  records: ConversationFlowNodeRecord[],
): AutomationEditorDocument {
  const nodes: AutomationEditorNode[] = records.map((record) => ({
    id: record.node_key,
    kind: record.node_type,
    config: withoutPointers(record.config ?? {}),
    position: { x: record.position_x ?? 320, y: record.position_y ?? 160 },
    sourceRef: record.node_key,
  }))
  const edges: AutomationEditorEdge[] = []
  if (flow.entry_node_id) {
    edges.push({ id: `${ROOT_ID}:${flow.entry_node_id}`, source: ROOT_ID, target: flow.entry_node_id })
  }
  records.forEach((record) => {
    const config = record.config ?? {}
    addPointerEdge(edges, record.node_key, config.next_node_id, undefined)
    addPointerEdge(edges, record.node_key, config.yes_node_id, 'yes')
    addPointerEdge(edges, record.node_key, config.no_node_id, 'no')
  })

  return {
    id: flow.id,
    name: flow.name,
    description: flow.description ?? '',
    status: flow.status === 'paused' ? 'inactive' : (flow.status ?? 'draft'),
    mode: 'flow',
    trigger: { type: flow.trigger_type, config: { ...(flow.trigger_config ?? {}) } },
    nodes,
    edges,
    revision: 0,
  }
}

export function documentToConversationFlow(document: AutomationEditorDocument): ConversationFlowPayload {
  const entry = document.edges.find((edge) => edge.source === ROOT_ID)
  const pointerFor = (nodeId: string, branch?: 'yes' | 'no') =>
    document.edges.find(
      (edge) => edge.source === nodeId && (branch ? edge.sourceHandle === branch : edge.sourceHandle == null),
    )?.target

  return {
    name: document.name,
    description: document.description || null,
    trigger_type: document.trigger.type as ConversationFlowRecord['trigger_type'],
    trigger_config: { ...document.trigger.config },
    entry_node_id: entry?.target ?? null,
    nodes: document.nodes.map((node) => {
      const config = { ...node.config }
      const next = pointerFor(node.id)
      const yes = pointerFor(node.id, 'yes')
      const no = pointerFor(node.id, 'no')
      if (next) config.next_node_id = next
      if (yes) config.yes_node_id = yes
      if (no) config.no_node_id = no
      return {
        node_key: node.id,
        node_type: node.kind,
        config,
        position_x: Math.round(node.position.x),
        position_y: Math.round(node.position.y),
      }
    }),
  }
}

function addPointerEdge(
  edges: AutomationEditorEdge[],
  source: string,
  target: unknown,
  sourceHandle: 'yes' | 'no' | undefined,
) {
  if (typeof target !== 'string' || !target) return
  edges.push({ id: `${source}:${target}:${sourceHandle ?? 'next'}`, source, target, sourceHandle })
}

function withoutPointers(config: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(config).filter(
      ([key]) => !POINTER_KEYS.includes(key as (typeof POINTER_KEYS)[number]),
    ),
  )
}
