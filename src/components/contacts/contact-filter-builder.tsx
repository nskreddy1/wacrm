"use client"

import * as React from "react"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { ContactField } from "@/lib/demo/contact-repository"
import { isGroup, operatorsFor, type FilterGroup, type FilterOperator, type FilterRule } from "@/lib/demo/contact-filters"

const makeRule = (field: ContactField): FilterRule => ({ id: crypto.randomUUID(), field: field.id, operator: "contains", value: "" })
function mapGroup(root: FilterGroup, id: string, fn: (group: FilterGroup) => FilterGroup): FilterGroup { return root.id === id ? fn(root) : { ...root, rules: root.rules.map((item) => isGroup(item) ? mapGroup(item, id, fn) : item) } }
function mapRule(root: FilterGroup, id: string, fn: (rule: FilterRule) => FilterRule): FilterGroup { return { ...root, rules: root.rules.map((item) => isGroup(item) ? mapRule(item, id, fn) : item.id === id ? fn(item) : item) } }
function remove(root: FilterGroup, id: string): FilterGroup { return { ...root, rules: root.rules.filter((item) => item.id !== id).map((item) => isGroup(item) ? remove(item, id) : item) } }

function Rule({ rule, fields, root, change }: { rule: FilterRule; fields: ContactField[]; root: FilterGroup; change: (value: FilterGroup) => void }) {
  const field = fields.find((item) => item.id === rule.field) ?? fields[0]
  const patch = (value: Partial<FilterRule>) => change(mapRule(root, rule.id, (current) => ({ ...current, ...value })))
  return <div className="grid grid-cols-[1fr_1fr_auto] gap-2 rounded-lg border bg-background p-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
    <Select value={rule.field} onValueChange={(value) => { const next = fields.find((item) => item.id === value); patch({ field: value, operator: operatorsFor(next)[0]?.value ?? "is", value: "" }) }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{fields.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
    <Select value={rule.operator} onValueChange={(value) => patch({ operator: value as FilterOperator })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{operatorsFor(field).map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectGroup></SelectContent></Select>
    {!rule.operator.includes("empty") && (field?.type === "single_select" || field?.type === "checkbox" ? <Select value={rule.value} onValueChange={(value) => patch({ value })}><SelectTrigger className="col-span-2 w-full sm:col-span-1"><SelectValue placeholder="Select value" /></SelectTrigger><SelectContent><SelectGroup>{(field.type === "checkbox" ? ["true", "false"] : field.options ?? []).map((option) => <SelectItem key={option} value={option}>{option}</SelectItem>)}</SelectGroup></SelectContent></Select> : <Input className="col-span-2 sm:col-span-1" type={field?.type === "date" ? "date" : ["number", "currency"].includes(field?.type ?? "") ? "number" : "text"} value={rule.value} onChange={(event) => patch({ value: event.target.value })} placeholder="Value" />)}
    <Button variant="ghost" size="icon-sm" aria-label="Remove filter rule" onClick={() => change(remove(root, rule.id))}><Trash2 /></Button>
  </div>
}
function Group({ group, fields, root, change, nested = false }: { group: FilterGroup; fields: ContactField[]; root: FilterGroup; change: (value: FilterGroup) => void; nested?: boolean }) {
  const addRule = () => fields[0] && change(mapGroup(root, group.id, (current) => ({ ...current, rules: [...current.rules, makeRule(fields[0])] })))
  const addGroup = () => change(mapGroup(root, group.id, (current) => ({ ...current, rules: [...current.rules, { id: crypto.randomUUID(), combinator: "and", rules: fields[0] ? [makeRule(fields[0])] : [] }] })))
  return <div className={nested ? "flex flex-col gap-3 rounded-xl border bg-muted/30 p-3" : "flex flex-col gap-3"}><div className="flex items-center gap-2"><span className="text-xs font-medium text-muted-foreground">Match</span><Select value={group.combinator} onValueChange={(value) => change(mapGroup(root, group.id, (current) => ({ ...current, combinator: value as "and" | "or" })))}><SelectTrigger size="sm"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="and">all conditions (AND)</SelectItem><SelectItem value="or">any condition (OR)</SelectItem></SelectGroup></SelectContent></Select>{nested && <Button className="ml-auto" variant="ghost" size="icon-sm" aria-label="Remove condition group" onClick={() => change(remove(root, group.id))}><Trash2 /></Button>}</div><div className="flex flex-col gap-2">{group.rules.map((item) => isGroup(item) ? <Group key={item.id} group={item} fields={fields} root={root} change={change} nested /> : <Rule key={item.id} rule={item} fields={fields} root={root} change={change} />)}</div><div className="flex gap-2"><Button variant="outline" size="sm" onClick={addRule}><Plus data-icon="inline-start" /> Rule</Button>{!nested && <Button variant="outline" size="sm" onClick={addGroup}><Plus data-icon="inline-start" /> Group</Button>}</div></div>
}
export function ContactFilterBuilder({ open, fields, value, onOpenChange, onApply, onClear }: { open: boolean; fields: ContactField[]; value: FilterGroup; onOpenChange: (open: boolean) => void; onApply: (value: FilterGroup) => void; onClear: () => void }) {
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => { if (open) setDraft(structuredClone(value)) }, [open, value])
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="w-full sm:max-w-3xl"><SheetHeader><SheetTitle>Filter contacts</SheetTitle><SheetDescription>Build nested rules across standard and custom fields. These filters apply to every view.</SheetDescription></SheetHeader><Separator /><ScrollArea className="min-h-0 flex-1"><div className="p-4"><Group group={draft} fields={fields} root={draft} change={setDraft} />{draft.rules.length === 0 && <div className="mt-3 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No conditions yet. Add a rule to narrow your contacts.</div>}</div></ScrollArea><Separator /><SheetFooter className="flex-row justify-between"><Button variant="ghost" onClick={() => { onClear(); onOpenChange(false) }}>Clear all</Button><div className="flex gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => { onApply(draft); onOpenChange(false) }}>Apply filters</Button></div></SheetFooter></SheetContent></Sheet>
}
