"use client"

import { useRef, useState } from "react"
import { Check, LoaderCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ActionResult } from "@/features/pipelines/lib/actions"
import type { PipelineDeal, PipelineMember, PipelineStage } from "@/features/pipelines/lib/domain"
import type { DealInput } from "@/features/pipelines/lib/validation"

const columns = ["title", "value", "stageId", "assignedTo", "due", "company"] as const
type Column = typeof columns[number]

export function nextCell(row: number, column: number, rowCount: number, backwards = false) {
  const size = columns.length
  const index = row * size + column + (backwards ? -1 : 1)
  const bounded = Math.max(0, Math.min(rowCount * size - 1, index))
  return { row: Math.floor(bounded / size), column: bounded % size }
}

function toInput(deal: PipelineDeal): DealInput { return { id: deal.id, pipelineId: deal.pipelineId, stageId: deal.stageId, contactId: deal.contactId, assignedTo: deal.assignedTo, title: deal.title, value: deal.value, currency: deal.currency, company: deal.company, priority: deal.priority, probability: deal.probability, source: deal.source, activity: deal.activity, nextStep: deal.nextStep, description: deal.description, due: deal.due, status: deal.status, position: deal.position } }

export function PipelineSheet({ deals, stages, members, onSave }: { deals: PipelineDeal[]; stages: PipelineStage[]; members: PipelineMember[]; onSave: (input: DealInput) => Promise<ActionResult<PipelineDeal>> }) {
  const refs = useRef(new Map<string, HTMLElement>())
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  async function commit(deal: PipelineDeal, column: Column, value: string | number | null) {
    const key = `${deal.id}:${column}`; setSaving(key)
    const result = await onSave({ ...toInput(deal), [column]: value })
    setSaving(null); if (result.ok) { setSaved(key); window.setTimeout(() => setSaved(null), 1200) }
  }
  function keyboard(event: React.KeyboardEvent, row: number, column: number) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key !== "Tab" && event.key !== "Enter") return
    event.preventDefault(); const next = nextCell(row, column, deals.length, event.shiftKey); refs.current.get(`${next.row}:${next.column}`)?.focus()
  }
  return <div className="min-h-0 flex-1 overflow-auto"><table className="min-w-full border-separate border-spacing-0 text-sm"><thead className="sticky top-0 z-20 bg-card"><tr>{["Deal name", "Amount", "Stage", "Owner", "Closing date", "Company"].map((label, index) => <th key={label} className={`min-w-44 border-b border-r px-3 py-2 text-left font-medium ${index === 0 ? "sticky left-0 z-30 bg-card" : ""}`}>{label}</th>)}</tr></thead><tbody>{deals.map((deal, row) => <tr key={deal.id}>{columns.map((column, index) => { const key = `${deal.id}:${column}`; const status = saving === key ? <LoaderCircle className="animate-spin" /> : saved === key ? <Check /> : null; return <td key={column} className={`relative border-b border-r bg-background p-0 ${index === 0 ? "sticky left-0 z-10" : ""}`}>{column === "stageId" ? <Select items={Object.fromEntries(stages.map((stage) => [stage.id, stage.name]))} value={deal.stageId} onValueChange={(value) => value && void commit(deal, column, value)}><SelectTrigger ref={(node) => { if (node) refs.current.set(`${row}:${index}`, node) }} onKeyDown={(event) => keyboard(event, row, index)} className="h-10 w-full rounded-none border-0"><SelectValue /></SelectTrigger><SelectContent><SelectGroup>{stages.map((stage) => <SelectItem key={stage.id} value={stage.id}>{stage.name}</SelectItem>)}</SelectGroup></SelectContent></Select> : column === "assignedTo" ? <Select items={{ none: "Unassigned", ...Object.fromEntries(members.map((member) => [member.id, member.name])) }} value={deal.assignedTo ?? "none"} onValueChange={(value) => value && void commit(deal, column, value === "none" ? null : value)}><SelectTrigger ref={(node) => { if (node) refs.current.set(`${row}:${index}`, node) }} onKeyDown={(event) => keyboard(event, row, index)} className="h-10 w-full rounded-none border-0"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="none">Unassigned</SelectItem>{members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}</SelectGroup></SelectContent></Select> : <Input ref={(node) => { if (node) refs.current.set(`${row}:${index}`, node) }} defaultValue={String(deal[column] ?? "")} type={column === "value" ? "number" : column === "due" ? "date" : "text"} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.value = String(deal[column] ?? ""); event.currentTarget.blur(); return } if (event.key === "Enter" || event.key === "Tab") { void commit(deal, column, column === "value" ? Number(event.currentTarget.value) : event.currentTarget.value || null); keyboard(event, row, index) } }} onBlur={(event) => { const value = column === "value" ? Number(event.currentTarget.value) : event.currentTarget.value || null; if (String(value ?? "") !== String(deal[column] ?? "")) void commit(deal, column, value) }} className="h-10 rounded-none border-0 focus-visible:ring-inset" />}{status && <span className="absolute right-1 top-1 text-primary" aria-live="polite">{status}</span>}</td>})}</tr>)}</tbody></table>{deals.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No deals match this view.</p>}</div>
}
