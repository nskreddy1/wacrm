import { describe, expect, it } from 'vitest'

import type { AutomationEditorDocument } from './document'
import { canConnect, canPublishAutomation, validateEditorDocument } from './validation'

const validRule: AutomationEditorDocument = {
  mode: 'rule',
  name: 'Lead welcome',
  description: '',
  status: 'draft',
  trigger: { type: 'new_contact_created', config: {} },
  nodes: [
    {
      id: 'message-1',
      kind: 'send_message',
      config: { text: 'Hello' },
      position: { x: 300, y: 100 },
    },
  ],
  edges: [{ id: 'entry', source: 'trigger', target: 'message-1' }],
  revision: 0,
}

describe('editor document validation', () => {
  it('accepts a connected, serializable rule document', () => {
    expect(validateEditorDocument(validRule)).toEqual([])
    expect(canPublishAutomation(validRule)).toBe(true)
  })

  it('reports duplicate identities and dangling endpoints', () => {
    const issues = validateEditorDocument({
      ...validRule,
      nodes: [...validRule.nodes, { ...validRule.nodes[0] }],
      edges: [
        ...validRule.edges,
        { id: 'entry', source: 'missing', target: 'message-1' },
      ],
    })

    expect(issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(['node-id-message-1', 'edge-id-entry', 'edge-source-entry']),
    )
  })

  it('blocks cycles and multiple parents in rule mode', () => {
    const second = {
      id: 'message-2',
      kind: 'send_message',
      config: { text: 'Again' },
      position: { x: 500, y: 100 },
    }
    const issues = validateEditorDocument({
      ...validRule,
      nodes: [...validRule.nodes, second],
      edges: [
        ...validRule.edges,
        { id: 'next', source: 'message-1', target: 'message-2' },
        { id: 'cycle', source: 'message-2', target: 'message-1' },
      ],
    })

    expect(issues.some((issue) => issue.id === 'rule-cycle')).toBe(true)
    expect(issues.some((issue) => issue.id === 'rule-parent-message-1')).toBe(true)
  })

  it('surfaces runtime field errors with node and field identity', () => {
    const issues = validateEditorDocument({
      ...validRule,
      nodes: [{ ...validRule.nodes[0], config: { text: '' } }],
    })

    expect(issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        scope: 'node',
        nodeId: 'message-1',
        field: 'text',
      }),
    )
  })

  it('rejects invalid rule connections before mutation', () => {
    const verdict = canConnect(validRule, {
      source: 'message-1',
      target: 'message-1',
    })

    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('Expected the connection to be rejected')
    expect(verdict.message).toMatch(/itself/i)
  })
})
