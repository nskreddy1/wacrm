import { describe, expect, it } from 'vitest'
import type { BuilderInitial } from '@/components/automations/automation-builder'
import {
  documentToRuleAutomation,
  RuleAdapterError,
  ruleAutomationToDocument,
} from './rule-automation-adapter'

const initial: BuilderInitial = {
  id: 'automation-1',
  name: 'Welcome lead',
  description: 'Routes qualified leads',
  trigger_type: 'new_contact_created',
  trigger_config: { source: 'website' },
  is_active: false,
  steps: [
    {
      cid: 'condition-1',
      step_type: 'condition',
      step_config: { field: 'status', operator: 'equals', value: 'qualified' },
      branches: {
        yes: [{ cid: 'message-1', step_type: 'send_message', step_config: { body: 'Welcome' } }],
        no: [{ cid: 'tag-1', step_type: 'add_tag', step_config: { tag: 'nurture' } }],
      },
    },
    { cid: 'delay-1', step_type: 'wait', step_config: { amount: 5, unit: 'minutes' } },
  ],
}

describe('rule automation adapter', () => {
  it('round-trips triggers, ordered steps, and condition branches', () => {
    const payload = documentToRuleAutomation(ruleAutomationToDocument(initial))

    expect(payload).toEqual({
      name: initial.name,
      description: initial.description,
      trigger_type: initial.trigger_type,
      trigger_config: initial.trigger_config,
      is_active: initial.is_active,
      steps: initial.steps.map(stripClientIds),
    })
  })

  it('preserves existing server identities in the editor document', () => {
    const document = ruleAutomationToDocument({
      ...initial,
      steps: [{ ...initial.steps[0], sourceRef: 'server-step-1' }],
    })

    expect(document.nodes[0].sourceRef).toBe('server-step-1')
  })

  it('rejects disconnected graphs instead of silently dropping nodes', () => {
    const document = ruleAutomationToDocument(initial)
    document.edges = document.edges.filter((edge) => edge.target !== 'delay-1')

    expect(() => documentToRuleAutomation(document)).toThrowError(RuleAdapterError)
    expect(() => documentToRuleAutomation(document)).toThrow(/connected/i)
  })
})

function stripClientIds(step: BuilderInitial['steps'][number]): unknown {
  return {
    step_type: step.step_type,
    step_config: step.step_config,
    branches: step.branches
      ? {
          yes: step.branches.yes.map(stripClientIds),
          no: step.branches.no.map(stripClientIds),
        }
      : undefined,
  }
}
