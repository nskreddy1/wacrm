import {
  BellRing,
  Bot,
  BriefcaseBusiness,
  CircleStop,
  Clock3,
  FileText,
  GitBranch,
  Handshake,
  ListChecks,
  MessageSquareText,
  MousePointerClick,
  PencilLine,
  Play,
  Send,
  Smartphone,
  Tag,
  Tags,
  UserRoundCheck,
  Webhook,
  type LucideIcon,
} from 'lucide-react'

export type AutomationNodeCategory = 'messaging' | 'logic' | 'crm' | 'control'

export interface AutomationNodeDefinition {
  type: string
  label: string
  description: string
  category: AutomationNodeCategory
  icon: LucideIcon
  modes: Array<'rule' | 'flow'>
  defaultConfig: Record<string, unknown>
}

export const AUTOMATION_NODE_DEFINITIONS: AutomationNodeDefinition[] = [
  definition('send_message', 'Send message', 'Send a text reply', 'messaging', MessageSquareText, ['rule'], { text: '' }),
  definition('send_buttons', 'Send buttons', 'Offer quick reply buttons', 'messaging', MousePointerClick, ['rule'], {}),
  definition('send_list', 'Send list', 'Send an interactive list', 'messaging', ListChecks, ['rule'], {}),
  definition('send_template', 'Send template', 'Send an approved template', 'messaging', FileText, ['rule'], { template_name: '', language: 'en_US' }),
  definition('message', 'Message', 'Send a message in the conversation', 'messaging', Send, ['flow'], { body: '' }),
  definition('question', 'Question', 'Ask and capture a response', 'messaging', Bot, ['flow'], { prompt: '' }),
  definition('interactive', 'Interactive', 'Present choices to the contact', 'messaging', Smartphone, ['flow'], {}),
  definition('condition', 'Condition', 'Branch using configured criteria', 'logic', GitBranch, ['rule', 'flow'], {}),
  definition('branch', 'Branch', 'Route the conversation by response', 'logic', GitBranch, ['flow'], {}),
  definition('wait', 'Wait', 'Pause before continuing', 'control', Clock3, ['rule'], { amount: 5, unit: 'minutes' }),
  definition('wait_for_reply', 'Wait for reply', 'Pause until the contact replies', 'control', BellRing, ['flow'], { timeout_minutes: 60 }),
  definition('start', 'Start', 'Mark a flow entry point', 'control', Play, ['flow'], {}),
  definition('end', 'End', 'Finish the conversation flow', 'control', CircleStop, ['flow'], {}),
  definition('handoff', 'Handoff', 'Hand the conversation to a person', 'control', Handshake, ['flow'], {}),
  definition('add_tag', 'Add tag', 'Apply a contact tag', 'crm', Tag, ['rule'], { tag_id: '' }),
  definition('remove_tag', 'Remove tag', 'Remove a contact tag', 'crm', Tags, ['rule'], { tag_id: '' }),
  definition('assign_conversation', 'Assign conversation', 'Assign to an agent or team', 'crm', UserRoundCheck, ['rule'], { mode: 'round_robin' }),
  definition('assign', 'Assign', 'Assign the conversation', 'crm', UserRoundCheck, ['flow'], {}),
  definition('update_contact_field', 'Update contact', 'Change a contact field', 'crm', PencilLine, ['rule'], {}),
  definition('create_deal', 'Create deal', 'Create a CRM deal', 'crm', BriefcaseBusiness, ['rule'], {}),
  definition('send_webhook', 'Send webhook', 'Call an external endpoint', 'control', Webhook, ['rule'], { method: 'POST', url: '' }),
  definition('close_conversation', 'Close conversation', 'Close the current conversation', 'control', CircleStop, ['rule'], {}),
]

export const AUTOMATION_NODE_CATEGORIES: Array<{ id: AutomationNodeCategory; label: string }> = [
  { id: 'messaging', label: 'Messaging' },
  { id: 'logic', label: 'Logic' },
  { id: 'crm', label: 'CRM' },
  { id: 'control', label: 'Flow control' },
]

export function getAutomationNodeDefinition(type: string) {
  return AUTOMATION_NODE_DEFINITIONS.find((item) => item.type === type)
}

function definition(
  type: string,
  label: string,
  description: string,
  category: AutomationNodeCategory,
  icon: LucideIcon,
  modes: Array<'rule' | 'flow'>,
  defaultConfig: Record<string, unknown>,
): AutomationNodeDefinition {
  return { type, label, description, category, icon, modes, defaultConfig }
}
