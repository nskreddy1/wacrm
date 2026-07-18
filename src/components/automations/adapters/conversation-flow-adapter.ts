import type {
  AutomationEditorDocument,
  AutomationEditorEdge,
  AutomationEditorNode,
} from '@/components/automation-editor/document'
import { cloneValue } from '@/components/automation-editor/document'

const ROOT_ID = 'trigger'
const DIRECT_POINTER_KEYS = ['next_node_key', 'true_next', 'false_next'] as const

export interface ConversationFlowRecord {
  id?: string
  name: string
  description?: string | null
  status?: 'draft' | 'active' | 'archived'
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
  records.forEach((record) => addConfigEdges(edges, record.node_key, record.config ?? {}))

  return {
    id: flow.id,
    name: flow.name,
    description: flow.description ?? '',
    status: flow.status ?? 'draft',
    mode: 'flow',
    trigger: { type: flow.trigger_type, config: cloneValue(flow.trigger_config ?? {}) },
    nodes,
    edges,
    revision: 0,
  }
}

export function documentToConversationFlow(document: AutomationEditorDocument): ConversationFlowPayload {
  const entry = document.edges.find((edge) => edge.source === ROOT_ID)
  return {
    name: document.name,
    description: document.description || null,
    trigger_type: document.trigger.type as ConversationFlowRecord['trigger_type'],
    trigger_config: cloneValue(document.trigger.config),
    entry_node_id: entry?.target ?? null,
    nodes: document.nodes.map((node) => ({
      node_key: node.id,
      node_type: node.kind,
      config: withPointers(node, document.edges),
      position_x: Math.round(node.position.x),
      position_y: Math.round(node.position.y),
    })),
  }
}

function addConfigEdges(
  edges: AutomationEditorEdge[],
  source: string,
  config: Record<string, unknown>,
): void {
  addPointerEdge(edges, source, config.next_node_key, undefined)
  addPointerEdge(edges, source, config.true_next, 'true')
  addPointerEdge(edges, source, config.false_next, 'false')

  const buttons = Array.isArray(config.buttons) ? config.buttons : []
  for (const button of buttons) {
    if (!isRecord(button)) continue
    const replyId = typeof button.reply_id === 'string' ? button.reply_id : ''
    addPointerEdge(edges, source, button.next_node_key, `button:${replyId}`)
  }

  const sections = Array.isArray(config.sections) ? config.sections : []
  for (const section of sections) {
    if (!isRecord(section) || !Array.isArray(section.rows)) continue
    for (const row of section.rows) {
      if (!isRecord(row)) continue
      const replyId = typeof row.reply_id === 'string' ? row.reply_id : ''
      addPointerEdge(edges, source, row.next_node_key, `row:${replyId}`)
    }
  }
}

function withPointers(
  node: AutomationEditorNode,
  edges: AutomationEditorEdge[],
): Record<string, unknown> {
  const config = cloneValue(node.config)
  const outgoing = edges.filter((edge) => edge.source === node.id)
  for (const edge of outgoing) {
    if (!edge.sourceHandle) config.next_node_key = edge.target
    else if (edge.sourceHandle === 'true' || edge.sourceHandle === 'yes') config.true_next = edge.target
    else if (edge.sourceHandle === 'false' || edge.sourceHandle === 'no') config.false_next = edge.target
    else if (edge.sourceHandle.startsWith('button:')) {
      patchInteractiveTarget(config, 'buttons', edge.sourceHandle.slice('button:'.length), edge.target)
    } else if (edge.sourceHandle.startsWith('row:')) {
      patchListTarget(config, edge.sourceHandle.slice('row:'.length), edge.target)
    }
  }
  return config
}

function withoutPointers(config: Record<string, unknown>): Record<string, unknown> {
  const copy = cloneValue(config)
  for (const key of DIRECT_POINTER_KEYS) delete copy[key]

  if (Array.isArray(copy.buttons)) {
    copy.buttons = copy.buttons.map((button) => {
      if (!isRecord(button)) return button
      const next = { ...button }
      delete next.next_node_key
      return next
    })
  }
  if (Array.isArray(copy.sections)) {
    copy.sections = copy.sections.map((section) => {
      if (!isRecord(section) || !Array.isArray(section.rows)) return section
      return {
        ...section,
        rows: section.rows.map((row) => {
          if (!isRecord(row)) return row
          const next = { ...row }
          delete next.next_node_key
          return next
        }),
      }
    })
  }
  return copy
}

function patchInteractiveTarget(
  config: Record<string, unknown>,
  key: 'buttons',
  replyId: string,
  target: string,
): void {
  if (!Array.isArray(config[key])) return
  config[key] = config[key].map((item) => isRecord(item) && item.reply_id === replyId
    ? { ...item, next_node_key: target }
    : item)
}

function patchListTarget(config: Record<string, unknown>, replyId: string, target: string): void {
  if (!Array.isArray(config.sections)) return
  config.sections = config.sections.map((section) => {
    if (!isRecord(section) || !Array.isArray(section.rows)) return section
    return {
      ...section,
      rows: section.rows.map((row) => isRecord(row) && row.reply_id === replyId
        ? { ...row, next_node_key: target }
        : row),
    }
  })
}

function addPointerEdge(
  edges: AutomationEditorEdge[],
  source: string,
  target: unknown,
  sourceHandle: string | undefined,
): void {
  if (typeof target !== 'string' || !target) return
  edges.push({ id: `${source}:${target}:${sourceHandle ?? 'next'}`, source, target, sourceHandle })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
