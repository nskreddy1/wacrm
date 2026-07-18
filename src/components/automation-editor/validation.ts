import { validateStepsForActivation } from '@/lib/automations/validate'
import { validateFlowForActivation } from '@/lib/flows/validate'

import type {
  AutomationEditorDocument,
  AutomationEditorEdge,
  AutomationEditorNode,
} from './document'

const TRIGGER_ID = 'trigger'
const BRANCH_KINDS = new Set(['condition', 'branch'])

export interface EditorValidationIssue {
  id: string
  severity: 'error' | 'warning'
  scope: 'document' | 'trigger' | 'node' | 'edge'
  nodeId?: string
  edgeId?: string
  field?: string
  message: string
}

export interface EditorConnection {
  source: string | null
  target: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

export type ConnectionVerdict =
  | { ok: true }
  | { ok: false; message: string }

export function validateEditorDocument(
  document: AutomationEditorDocument,
): EditorValidationIssue[] {
  const issues: EditorValidationIssue[] = []
  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()

  if (!document.name.trim()) {
    issues.push(issue('name-required', 'error', 'document', 'Give this automation a name.', { field: 'name' }))
  }
  if (!document.trigger.type.trim()) {
    issues.push(issue('trigger-required', 'error', 'trigger', 'Choose a trigger.', { field: 'type' }))
  }
  if (document.nodes.length === 0) {
    issues.push(issue('node-required', 'error', 'document', 'Add at least one step.'))
  }

  for (const node of document.nodes) {
    if (node.id === TRIGGER_ID || nodeIds.has(node.id)) {
      issues.push(issue(`node-id-${node.id}`, 'error', 'node', `Node id “${node.id}” must be unique.`, { nodeId: node.id }))
    }
    nodeIds.add(node.id)
  }

  for (const edge of document.edges) {
    if (edgeIds.has(edge.id)) {
      issues.push(issue(`edge-id-${edge.id}`, 'error', 'edge', `Edge id “${edge.id}” must be unique.`, { edgeId: edge.id }))
    }
    edgeIds.add(edge.id)
    if (edge.source !== TRIGGER_ID && !nodeIds.has(edge.source)) {
      issues.push(issue(`edge-source-${edge.id}`, 'error', 'edge', 'A connection starts at a missing step.', { edgeId: edge.id }))
    }
    if (!nodeIds.has(edge.target)) {
      issues.push(issue(`edge-target-${edge.id}`, 'error', 'edge', 'A connection points to a missing step.', { edgeId: edge.id }))
    }
  }

  const reachable = reachableNodeIds(document)
  for (const node of document.nodes) {
    if (!reachable.has(node.id)) {
      issues.push(issue(`unreachable-${node.id}`, 'warning', 'node', 'This step is not connected to the trigger.', { nodeId: node.id }))
    }
  }

  if (document.mode === 'rule') {
    validateRuleShape(document, issues)
    appendRuleRuntimeIssues(document, issues)
  } else {
    appendFlowRuntimeIssues(document, issues)
  }

  return dedupeIssues(issues)
}

/** Kept as a compatibility export while route wrappers migrate. */
export const validateAutomationDocument = validateEditorDocument

export function canPublishAutomation(document: AutomationEditorDocument): boolean {
  return !validateEditorDocument(document).some((entry) => entry.severity === 'error')
}

export function canConnect(
  document: AutomationEditorDocument,
  connection: EditorConnection,
): ConnectionVerdict {
  const { source, target, sourceHandle } = connection
  if (!source || !target) return { ok: false, message: 'Choose a source and destination.' }
  if (source === target) return { ok: false, message: 'A step cannot connect to itself.' }
  if (source === TRIGGER_ID && sourceHandle) return { ok: false, message: 'The trigger has only one output.' }
  if (target === TRIGGER_ID) return { ok: false, message: 'The trigger cannot have an incoming connection.' }
  if (document.edges.some((edge) => edge.source === source && (edge.sourceHandle ?? null) === (sourceHandle ?? null))) {
    return { ok: false, message: 'That output is already connected.' }
  }

  if (document.mode === 'rule') {
    const sourceNode = document.nodes.find((node) => node.id === source)
    if (sourceHandle && (!sourceNode || !BRANCH_KINDS.has(sourceNode.kind))) {
      return { ok: false, message: 'Only condition steps can branch.' }
    }
    if (document.edges.some((edge) => edge.target === target)) {
      return { ok: false, message: 'Rule steps can only have one parent.' }
    }
    if (pathExists(document.edges, target, source)) {
      return { ok: false, message: 'Rule automations cannot contain cycles.' }
    }
  }

  return { ok: true }
}

function validateRuleShape(
  document: AutomationEditorDocument,
  issues: EditorValidationIssue[],
): void {
  const incoming = new Map<string, number>()
  for (const edge of document.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
    const sourceNode = document.nodes.find((node) => node.id === edge.source)
    if (edge.sourceHandle && edge.source !== TRIGGER_ID && (!sourceNode || !BRANCH_KINDS.has(sourceNode.kind))) {
      issues.push(issue(`rule-branch-${edge.id}`, 'error', 'edge', 'Only condition steps can branch.', { edgeId: edge.id }))
    }
  }
  for (const [nodeId, count] of incoming) {
    if (count > 1) {
      issues.push(issue(`rule-parent-${nodeId}`, 'error', 'node', 'Rule steps can only have one parent.', { nodeId }))
    }
  }
  if (hasCycle(document)) {
    issues.push(issue('rule-cycle', 'error', 'document', 'Rule automations cannot contain cycles.'))
  }
}

function appendRuleRuntimeIssues(
  document: AutomationEditorDocument,
  issues: EditorValidationIssue[],
): void {
  const ordered = serializeRuleSteps(document)
  for (const runtimeIssue of validateStepsForActivation(ordered)) {
    const match = runtimeIssue.path.match(/^steps\[(\d+)](?:\.(.+))?$/)
    const node = match ? ordered[Number(match[1])] : undefined
    issues.push(issue(
      `rule-runtime-${runtimeIssue.path}`,
      'error',
      node ? 'node' : 'document',
      runtimeIssue.message,
      { nodeId: node?.__nodeId, field: match?.[2] },
    ))
  }
}

function appendFlowRuntimeIssues(
  document: AutomationEditorDocument,
  issues: EditorValidationIssue[],
): void {
  const entry = document.edges.find((edge) => edge.source === TRIGGER_ID)?.target ?? null
  const nodes = document.nodes.map((node) => ({
    node_key: node.id,
    node_type: node.kind,
    config: flowConfigFor(node, document.edges),
  }))
  const triggerType = document.trigger.type === 'first_inbound_message' || document.trigger.type === 'manual'
    ? document.trigger.type
    : 'keyword'

  for (const runtimeIssue of validateFlowForActivation({
    name: document.name,
    trigger_type: triggerType,
    trigger_config: document.trigger.config,
    entry_node_id: entry,
  }, nodes)) {
    issues.push(issue(
      `flow-runtime-${runtimeIssue.scope}-${runtimeIssue.node_key ?? runtimeIssue.field ?? runtimeIssue.message}`,
      runtimeIssue.severity,
      runtimeIssue.scope === 'node' ? 'node' : runtimeIssue.scope === 'trigger' ? 'trigger' : 'document',
      runtimeIssue.message,
      { nodeId: runtimeIssue.node_key, field: runtimeIssue.field },
    ))
  }
}

function serializeRuleSteps(document: AutomationEditorDocument) {
  const result: Array<{
    __nodeId: string
    step_type: string
    step_config: Record<string, unknown>
    branches?: { yes: ReturnType<typeof serializeRuleSteps>; no: ReturnType<typeof serializeRuleSteps> }
  }> = []
  const visited = new Set<string>()

  const walk = (source: string, handle?: string): typeof result => {
    const edge = document.edges.find((candidate) => candidate.source === source && (candidate.sourceHandle ?? undefined) === handle)
    if (!edge || visited.has(edge.target)) return []
    visited.add(edge.target)
    const node = document.nodes.find((candidate) => candidate.id === edge.target)
    if (!node) return []
    const current: (typeof result)[number] = {
      __nodeId: node.id,
      step_type: node.kind,
      step_config: node.config,
    }
    if (node.kind === 'condition') {
      current.branches = { yes: walk(node.id, 'yes'), no: walk(node.id, 'no') }
    }
    return [current, ...walk(node.id)]
  }

  return walk(TRIGGER_ID)
}

function flowConfigFor(node: AutomationEditorNode, edges: AutomationEditorEdge[]) {
  const config = { ...node.config }
  const outgoing = edges.filter((edge) => edge.source === node.id)
  const next = outgoing.find((edge) => !edge.sourceHandle)
  if (next) config.next_node_key = next.target
  for (const edge of outgoing) {
    if (edge.sourceHandle === 'true' || edge.sourceHandle === 'yes') config.true_next = edge.target
    if (edge.sourceHandle === 'false' || edge.sourceHandle === 'no') config.false_next = edge.target
  }
  return config
}

function reachableNodeIds(document: AutomationEditorDocument): Set<string> {
  const reached = new Set<string>()
  const queue = document.edges.filter((edge) => edge.source === TRIGGER_ID).map((edge) => edge.target)
  while (queue.length) {
    const current = queue.shift()!
    if (reached.has(current)) continue
    reached.add(current)
    for (const edge of document.edges) if (edge.source === current) queue.push(edge.target)
  }
  return reached
}

function hasCycle(document: AutomationEditorDocument): boolean {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true
    if (visited.has(nodeId)) return false
    visiting.add(nodeId)
    for (const edge of document.edges) {
      if (edge.source === nodeId && visit(edge.target)) return true
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }
  return [TRIGGER_ID, ...document.nodes.map((node) => node.id)].some(visit)
}

function pathExists(edges: AutomationEditorEdge[], from: string, to: string): boolean {
  const seen = new Set<string>()
  const queue = [from]
  while (queue.length) {
    const current = queue.shift()!
    if (current === to) return true
    if (seen.has(current)) continue
    seen.add(current)
    for (const edge of edges) if (edge.source === current) queue.push(edge.target)
  }
  return false
}

function issue(
  id: string,
  severity: EditorValidationIssue['severity'],
  scope: EditorValidationIssue['scope'],
  message: string,
  details: Partial<Pick<EditorValidationIssue, 'nodeId' | 'edgeId' | 'field'>> = {},
): EditorValidationIssue {
  return { id, severity, scope, message, ...details }
}

function dedupeIssues(issues: EditorValidationIssue[]): EditorValidationIssue[] {
  return [...new Map(issues.map((entry) => [entry.id, entry])).values()]
}
