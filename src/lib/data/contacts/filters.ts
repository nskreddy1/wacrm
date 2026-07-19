import type { ContactField, WorkspaceContact } from "@/lib/data/contacts/types"

export type FilterOperator = "is" | "is_not" | "contains" | "not_contains" | "starts_with" | "ends_with" | "is_empty" | "is_not_empty" | "gt" | "gte" | "lt" | "lte"
export type FilterRule = { id: string; field: string; operator: FilterOperator; value: string }
export type FilterGroup = { id: string; combinator: "and" | "or"; rules: Array<FilterRule | FilterGroup> }

export const emptyFilterGroup = (): FilterGroup => ({ id: crypto.randomUUID(), combinator: "and", rules: [] })
export const isGroup = (item: FilterRule | FilterGroup): item is FilterGroup => "rules" in item

export function operatorsFor(field?: ContactField): Array<{ value: FilterOperator; label: string }> {
  const common: Array<{ value: FilterOperator; label: string }> = [{ value: "is", label: "is" }, { value: "is_not", label: "is not" }]
  if (field?.type === "number" || field?.type === "currency" || field?.type === "date") return [...common, { value: "gt", label: field.type === "date" ? "is after" : "is greater than" }, { value: "gte", label: "is greater than or equal" }, { value: "lt", label: field.type === "date" ? "is before" : "is less than" }, { value: "lte", label: "is less than or equal" }, { value: "is_empty", label: "is empty" }, { value: "is_not_empty", label: "is not empty" }]
  if (field?.type === "checkbox") return common
  return [...common, { value: "contains", label: "contains" }, { value: "not_contains", label: "does not contain" }, { value: "starts_with", label: "starts with" }, { value: "ends_with", label: "ends with" }, { value: "is_empty", label: "is empty" }, { value: "is_not_empty", label: "is not empty" }]
}

function evaluateRule(contact: WorkspaceContact, field: ContactField | undefined, rule: FilterRule) {
  const raw = contact.values[rule.field]
  const empty = raw === undefined || raw === null || raw === "" || (Array.isArray(raw) && raw.length === 0)
  if (rule.operator === "is_empty") return empty
  if (rule.operator === "is_not_empty") return !empty
  const actual = Array.isArray(raw) ? raw.join(", ") : String(raw ?? "")
  const expected = rule.value.trim()
  if (field?.type === "number" || field?.type === "currency") {
    const a = Number(raw); const b = Number(expected)
    if (rule.operator === "gt") return a > b
    if (rule.operator === "gte") return a >= b
    if (rule.operator === "lt") return a < b
    if (rule.operator === "lte") return a <= b
  }
  if (field?.type === "date") {
    const a = new Date(actual).getTime(); const b = new Date(expected).getTime()
    if (rule.operator === "gt") return a > b
    if (rule.operator === "gte") return a >= b
    if (rule.operator === "lt") return a < b
    if (rule.operator === "lte") return a <= b
  }
  const a = actual.toLocaleLowerCase(); const b = expected.toLocaleLowerCase()
  if (rule.operator === "is") return a === b
  if (rule.operator === "is_not") return a !== b
  if (rule.operator === "contains") return a.includes(b)
  if (rule.operator === "not_contains") return !a.includes(b)
  if (rule.operator === "starts_with") return a.startsWith(b)
  if (rule.operator === "ends_with") return a.endsWith(b)
  return true
}

export function validateFilterGroup(group: FilterGroup, fields: ContactField[]): string[] {
  const errors: string[] = []
  const signatures = new Set<string>()
  for (const rule of flattenRules(group)) {
    const field = fields.find((item) => item.id === rule.field)
    if (!field) { errors.push("A filter references a field that no longer exists"); continue }
    if (!operatorsFor(field).some((item) => item.value === rule.operator)) errors.push(`${field.label} uses an incompatible operator`)
    const needsValue = !rule.operator.includes("empty")
    if (needsValue && !rule.value.trim()) errors.push(`${field.label} needs a value`)
    if (needsValue && (field.type === "number" || field.type === "currency") && !Number.isFinite(Number(rule.value))) errors.push(`${field.label} needs a valid number`)
    if (needsValue && field.type === "date" && Number.isNaN(Date.parse(rule.value))) errors.push(`${field.label} needs a valid date`)
    if (needsValue && field.type === "single_select" && !field.options?.includes(rule.value)) errors.push(`${field.label} needs one of its configured options`)
    const signature = `${rule.field}|${rule.operator}|${rule.value.trim().toLocaleLowerCase()}`
    if (signatures.has(signature)) errors.push(`Duplicate condition for ${field.label}`)
    signatures.add(signature)
  }
  return [...new Set(errors)]
}

export function matchesFilter(contact: WorkspaceContact, fields: ContactField[], group: FilterGroup): boolean {
  if (!group.rules.length) return true
  const results = group.rules.map((item) => isGroup(item) ? matchesFilter(contact, fields, item) : evaluateRule(contact, fields.find((field) => field.id === item.field), item))
  return group.combinator === "and" ? results.every(Boolean) : results.some(Boolean)
}

export function countRules(group: FilterGroup): number { return group.rules.reduce((total, item) => total + (isGroup(item) ? countRules(item) : 1), 0) }
export function summarizeRule(rule: FilterRule, fields: ContactField[]) { const field = fields.find((item) => item.id === rule.field); const operator = operatorsFor(field).find((item) => item.value === rule.operator)?.label; return `${field?.label ?? rule.field} ${operator ?? rule.operator}${rule.operator.includes("empty") ? "" : ` ${rule.value}`}` }
export function flattenRules(group: FilterGroup): FilterRule[] { return group.rules.flatMap((item) => isGroup(item) ? flattenRules(item) : item) }
