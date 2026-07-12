"use client"

import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { Check, LoaderCircle, TriangleAlert } from "lucide-react"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { demoStages, type DemoDeal } from "@/lib/demo/crm-data"

export type SheetField = keyof Pick<DemoDeal, "title" | "value" | "stageId" | "due" | "company" | "contact" | "owner" | "priority" | "probability" | "createdAt" | "source" | "activity">

const labels: Record<SheetField, string> = {
  title: "Deal name", value: "Amount", stageId: "Stage", due: "Closing date", company: "Company name", contact: "Contact name",
  owner: "Deal owner", priority: "Priority", probability: "Probability", createdAt: "Created time", source: "Lead source", activity: "Last activity",
}
const owners = ["Sam Silva", "Nora James", "Ravi Patel"]
const priorities: DemoDeal["priority"][] = ["Hot", "Warm", "Normal"]
const selectFields = new Set<SheetField>(["stageId", "owner", "priority"])
const numberFields = new Set<SheetField>(["value", "probability"])
const dateFields = new Set<SheetField>(["due", "createdAt"])

type Cell = { row: number; column: number }
type Status = "idle" | "saving" | "saved" | "error"

function rawValue(deal: DemoDeal, field: SheetField) {
  return String(deal[field] ?? "")
}

function parseValue(field: SheetField, value: string) {
  if (numberFields.has(field)) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error("Enter a valid positive number")
    if (field === "probability" && parsed > 100) throw new Error("Probability must be between 0 and 100")
    return parsed
  }
  if (field === "title" && !value.trim()) throw new Error("Deal name is required")
  return value.trim()
}

export function PipelineSheet({ deals, fields, onCommit }: { deals: DemoDeal[]; fields: SheetField[]; onCommit: (deal: DemoDeal) => Promise<void> | void }) {
  const [active, setActive] = useState<Cell | null>(null)
  const [draft, setDraft] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState("")
  const committing = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!active) return
    const deal = deals[active.row]
    const field = fields[active.column]
    if (deal && field && !committing.current) setDraft(rawValue(deal, field))
  }, [active, deals, fields])

  function focusCell(row: number, column: number) {
    const nextRow = Math.max(0, Math.min(deals.length - 1, row))
    const nextColumn = Math.max(0, Math.min(fields.length - 1, column))
    setActive({ row: nextRow, column: nextColumn })
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-cell="${nextRow}-${nextColumn}"]`)?.focus())
  }

  async function commit(next?: Cell, valueOverride?: string) {
    if (!active || committing.current) return
    const deal = deals[active.row]
    const field = fields[active.column]
    if (!deal || !field) return
    const valueToCommit = valueOverride ?? draft
    if (rawValue(deal, field) === valueToCommit) {
      if (next) focusCell(next.row, next.column)
      return
    }
    try {
      const value = parseValue(field, valueToCommit)
      committing.current = true
      setStatus("saving")
      setError("")
      await onCommit({ ...deal, [field]: value })
      setStatus("saved")
      if (next) focusCell(next.row, next.column)
      window.setTimeout(() => setStatus("idle"), 1200)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Unable to save this cell"
      setStatus("error")
      setError(message)
      toast.error(message)
    } finally {
      committing.current = false
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>, row: number, column: number) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === "Escape") {
      event.preventDefault()
      setDraft(rawValue(deals[row], fields[column]))
      setStatus("idle")
      setError("")
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      void commit({ row: Math.min(row + 1, deals.length - 1), column })
    } else if (event.key === "Tab") {
      event.preventDefault()
      const direction = event.shiftKey ? -1 : 1
      const flat = row * fields.length + column + direction
      const bounded = Math.max(0, Math.min(deals.length * fields.length - 1, flat))
      void commit({ row: Math.floor(bounded / fields.length), column: bounded % fields.length })
    }
  }

  if (deals.length === 0) return <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">No deals match this view.</div>

  return <div ref={gridRef} className="min-h-0 flex-1 overflow-auto bg-card" role="grid" aria-label="Editable deals sheet" aria-rowcount={deals.length + 1} aria-colcount={fields.length}>
    <table className="min-w-max border-separate border-spacing-0 text-sm">
      <thead className="sticky top-0 z-20 bg-muted"><tr>{fields.map((field, column) => <th key={field} role="columnheader" className={cn("min-w-44 border-b border-r px-3 py-2 text-left font-semibold", column === 0 && "sticky left-0 z-30 bg-muted")}>{labels[field]}</th>)}</tr></thead>
      <tbody>{deals.map((deal, row) => <tr key={deal.id} role="row">{fields.map((field, column) => {
        const selected = active?.row === row && active.column === column
        const common = { "data-cell": `${row}-${column}`, onFocus: () => { setActive({ row, column }); setDraft(rawValue(deal, field)); setStatus("idle"); setError("") }, onKeyDown: (event: KeyboardEvent<HTMLElement>) => handleKeyDown(event, row, column), onBlur: () => { if (selected) void commit() } }
        return <td key={field} role="gridcell" aria-selected={selected} className={cn("h-10 border-b border-r p-0", column === 0 && "sticky left-0 z-10 bg-card", selected && "outline-2 -outline-offset-2 outline-primary")}>
          {selectFields.has(field) ? <select {...common} value={selected ? draft : rawValue(deal, field)} onChange={(event) => { const nextValue = event.target.value; setDraft(nextValue); void commit(undefined, nextValue) }} className="h-10 w-full bg-transparent px-2 outline-none" aria-label={`${labels[field]} for ${deal.title}`}>{field === "stageId" ? demoStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>) : field === "owner" ? owners.map((owner) => <option key={owner}>{owner}</option>) : priorities.map((priority) => <option key={priority}>{priority}</option>)}</select> : <Input {...common} type={numberFields.has(field) ? "number" : dateFields.has(field) ? "date" : "text"} min={numberFields.has(field) ? 0 : undefined} max={field === "probability" ? 100 : undefined} value={selected ? draft : rawValue(deal, field)} onChange={(event) => setDraft(event.target.value)} className="h-10 rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0" aria-label={`${labels[field]} for ${deal.title}`} />}
        </td>
      })}</tr>)}</tbody>
    </table>
    <div className="sticky bottom-2 left-2 flex h-6 w-fit items-center gap-1 rounded-sm bg-card px-2 text-xs shadow-sm" aria-live="polite">{status === "saving" && <><LoaderCircle className="size-3 animate-spin" /> Saving</>}{status === "saved" && <><Check className="size-3 text-primary" /> Saved</>}{status === "error" && <><TriangleAlert className="size-3 text-destructive" /> {error}</>}</div>
  </div>
}
