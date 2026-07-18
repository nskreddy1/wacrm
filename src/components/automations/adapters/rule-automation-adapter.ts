import type {
  BuilderInitial,
  BuilderStep,
} from '@/components/automations/automation-builder'
import type {
  AutomationEditorDocument,
  AutomationEditorEdge,
  AutomationEditorNode,
} from '@/components/automation-editor/document'

const ROOT_ID = 'trigger'

export class RuleAdapterError extends Error {
  constructor(
    message: string,
    readonly code: 'cycle' | 'disconnected' | 'multiple_parents' | 'multiple_outputs' | 'dangling_edge',
  ) {
    super(message)
    this.name = 'RuleAdapterError'
  }
}

export interface RuleAutomationPayload {
  name: string
  description: string
  trigger_type: BuilderInitial['trigger_type']
  trigger_config: Record<string, unknown>
  is_active: boolean
  steps: Array<{
    step_type: BuilderStep['step_type']
    step_config: Record<string, unknown>
    branches?: { yes: RuleAutomationPayload['steps']; no: RuleAutomationPayload['steps'] }
  }>
}

export function ruleAutomationToDocument(initial: BuilderInitial): AutomationEditorDocument {
  const nodes: AutomationEditorNode[] = []
  const edges: AutomationEditorEdge[] = []
  let row = 0

  function visit(steps: BuilderStep[], sourceId: string, branch?: 'yes' | 'no') {
    let previousId = sourceId
    steps.forEach((step, index) => {
      nodes.push({
        id: step.cid,
        kind: step.step_type,
        config: structuredClone(step.step_config),
        position: { x: branch === 'no' ? 560 : 320, y: 160 + row++ * 120 },
        sourceRef: step.sourceRef,
      })
      edges.push({
        id: `${previousId}:${step.cid}:${branch ?? 'next'}`,
        source: previousId,
        target: step.cid,
        sourceHandle: index === 0 ? branch : undefined,
      })
      previousId = step.cid
      if (step.branches) {
        visit(step.branches.yes, step.cid, 'yes')
        visit(step.branches.no, step.cid, 'no')
      }
    })
  }

  visit(initial.steps, ROOT_ID)
  return {
    id: initial.id,
    name: initial.name,
    description: initial.description,
    status: initial.is_active ? 'active' : 'draft',
    mode: 'rule',
    trigger: { type: initial.trigger_type, config: structuredClone(initial.trigger_config) },
    nodes,
    edges,
    revision: 0,
  }
}

export function documentToRuleAutomation(document: AutomationEditorDocument): RuleAutomationPayload {
  assertSerializableRuleGraph(document)
  const outgoing = (source: string, branch?: 'yes' | 'no') =>
    document.edges.find(
      (edge) => edge.source === source && (branch ? edge.sourceHandle === branch : edge.sourceHandle == null),
    )

  function build(sourceId: string, branch?: 'yes' | 'no'): RuleAutomationPayload['steps'] {
    const edge = outgoing(sourceId, branch)
    if (!edge) return []
    const node = document.nodes.find((candidate) => candidate.id === edge.target)!
    const step = {
      step_type: node.kind as BuilderStep['step_type'],
      step_config: structuredClone(node.config),
      branches:
        node.kind === 'condition'
          ? {
              yes: build(node.id, 'yes'),
              no: build(node.id, 'no'),
            }
          : undefined,
    }
    return [step, ...build(node.id)]
  }

  return {
    name: document.name,
    description: document.description,
    trigger_type: document.trigger.type as BuilderInitial['trigger_type'],
    trigger_config: structuredClone(document.trigger.config),
    is_active: document.status === 'active',
    steps: build(ROOT_ID),
  }
}

function assertSerializableRuleGraph(document: AutomationEditorDocument): void {
  const nodeIds = new Set(document.nodes.map((node) => node.id))
  const incoming = new Map<string, number>()
  const outputKeys = new Set<string>()
  for (const edge of document.edges) {
    if ((edge.source !== ROOT_ID && !nodeIds.has(edge.source)) || !nodeIds.has(edge.target)) {
      throw new RuleAdapterError('The rule graph contains a dangling connection.', 'dangling_edge')
    }
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
    const outputKey = `${edge.source}:${edge.sourceHandle ?? 'next'}`
    if (outputKeys.has(outputKey)) {
      throw new RuleAdapterError('A rule output cannot connect to multiple steps.', 'multiple_outputs')
    }
    outputKeys.add(outputKey)
  }
  if ([...incoming.values()].some((count) => count > 1)) {
    throw new RuleAdapterError('A rule step cannot have multiple parents.', 'multiple_parents')
  }

  const reached = new Set<string>()
  const visiting = new Set<string>()
  const visit = (source: string): void => {
    if (visiting.has(source)) throw new RuleAdapterError('Rule automations cannot contain cycles.', 'cycle')
    if (reached.has(source)) return
    visiting.add(source)
    for (const edge of document.edges.filter((candidate) => candidate.source === source)) visit(edge.target)
    visiting.delete(source)
    if (source !== ROOT_ID) reached.add(source)
  }
  visit(ROOT_ID)
  if (reached.size !== document.nodes.length) {
    throw new RuleAdapterError('Every rule step must be connected to the trigger.', 'disconnected')
  }
}
