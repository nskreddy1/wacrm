import type { AutomationEditorDocument } from './document'

export interface AutomationValidationIssue {
  id: string
  severity: 'error' | 'warning'
  message: string
  nodeId?: string
}

export function validateAutomationDocument(document: AutomationEditorDocument): AutomationValidationIssue[] {
  const issues: AutomationValidationIssue[] = []
  if (!document.name.trim()) {
    issues.push({ id: 'name-required', severity: 'error', message: 'Give this automation a name.' })
  }
  if (!document.trigger.type.trim()) {
    issues.push({ id: 'trigger-required', severity: 'error', message: 'Choose a trigger.' })
  }
  if (document.nodes.length === 0) {
    issues.push({ id: 'node-required', severity: 'error', message: 'Add at least one step.' })
  }

  const ids = new Set(document.nodes.map((node) => node.id))
  const incoming = new Set(document.edges.map((edge) => edge.target))
  for (const edge of document.edges) {
    if ((edge.source !== 'trigger' && !ids.has(edge.source)) || !ids.has(edge.target)) {
      issues.push({
        id: `dangling-${edge.id}`,
        severity: 'error',
        message: 'A connection points to a missing step.',
      })
    }
  }
  for (const node of document.nodes) {
    if (!incoming.has(node.id)) {
      issues.push({
        id: `unreachable-${node.id}`,
        severity: 'warning',
        message: 'This step is not connected to the trigger.',
        nodeId: node.id,
      })
    }
  }
  return issues
}

export function canPublishAutomation(document: AutomationEditorDocument) {
  return !validateAutomationDocument(document).some((issue) => issue.severity === 'error')
}
