import { describe, expect, it } from 'vitest'
import type { AutomationEditorDocument } from './document'
import { canPublishAutomation, validateAutomationDocument } from './validation'

const valid: AutomationEditorDocument = {
  mode: 'rule',
  name: 'Lead welcome',
  description: '',
  status: 'draft',
  trigger: { type: 'new_contact_created', config: {} },
  nodes: [{ id: 'message-1', kind: 'send_message', config: { text: 'Hello' }, position: { x: 300, y: 100 } }],
  edges: [{ id: 'entry', source: 'trigger', target: 'message-1' }],
  revision: 0,
}

describe('automation document validation', () => {
  it('accepts a connected named document', () => {
    expect(validateAutomationDocument(valid)).toEqual([])
    expect(canPublishAutomation(valid)).toBe(true)
  })

  it('reports missing required values and disconnected nodes', () => {
    const issues = validateAutomationDocument({
      ...valid,
      name: '',
      trigger: { type: '', config: {} },
      edges: [],
    })
    expect(issues.map((issue) => issue.id)).toEqual([
      'name-required',
      'trigger-required',
      'unreachable-message-1',
    ])
    expect(canPublishAutomation({ ...valid, name: '' })).toBe(false)
  })
})
