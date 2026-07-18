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
        config: { ...step.step_config },
        position: { x: branch === 'no' ? 560 : 320, y: 160 + row++ * 120 },
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
    trigger: { type: initial.trigger_type, config: { ...initial.trigger_config } },
    nodes,
    edges,
    revision: 0,
  }
}

export function documentToRuleAutomation(document: AutomationEditorDocument): RuleAutomationPayload {
  const outgoing = (source: string, branch?: 'yes' | 'no') =>
    document.edges.find(
      (edge) => edge.source === source && (branch ? edge.sourceHandle === branch : edge.sourceHandle == null),
    )

  function build(sourceId: string, branch?: 'yes' | 'no', seen = new Set<string>()): RuleAutomationPayload['steps'] {
    const edge = outgoing(sourceId, branch)
    if (!edge || seen.has(edge.target)) return []
    seen.add(edge.target)
    const node = document.nodes.find((candidate) => candidate.id === edge.target)
    if (!node) return []
    const step = {
      step_type: node.kind as BuilderStep['step_type'],
      step_config: { ...node.config },
      branches:
        node.kind === 'condition'
          ? {
              yes: build(node.id, 'yes', new Set(seen)),
              no: build(node.id, 'no', new Set(seen)),
            }
          : undefined,
    }
    return [step, ...build(node.id, undefined, seen)]
  }

  return {
    name: document.name,
    description: document.description,
    trigger_type: document.trigger.type as BuilderInitial['trigger_type'],
    trigger_config: { ...document.trigger.config },
    is_active: document.status === 'active',
    steps: build(ROOT_ID),
  }
}
