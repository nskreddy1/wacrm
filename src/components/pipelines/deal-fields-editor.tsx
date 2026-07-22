"use client"

import { useState } from "react"
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { DealFieldLayout } from "@/lib/pipelines/validation"

// Standard fields that can be hidden from the deal form (required ones excluded)
const OPTIONAL_FIELDS: { id: string; label: string; kind: string }[] = [
  { id: "company", label: "Company", kind: "Single Line" },
  { id: "contact", label: "Contact", kind: "Lookup" },
  { id: "due", label: "Expected close", kind: "Date Picker" },
  { id: "source", label: "Source", kind: "Single Line" },
  { id: "salesDetails", label: "Sales details", kind: "Section" },
  { id: "catalog", label: "Associated Catalog", kind: "Line Items" },
  { id: "description", label: "Notes", kind: "Multi-line (Large)" },
]

const REQUIRED_FIELDS: { id: string; label: string; kind: string }[] = [
  { id: "title", label: "Deal name", kind: "Single Line" },
  { id: "value", label: "Amount", kind: "Currency" },
  { id: "stage", label: "Stage", kind: "Single Select" },
  { id: "owner", label: "Owner", kind: "Lookup" },
]

export function DealFieldsEditor({ open, pipelineName, layout, pending, onOpenChange, onSave }: {
  open: boolean
  pipelineName: string
  layout: DealFieldLayout
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSave: (layout: DealFieldLayout) => Promise<void>
}) {
  const [draft, setDraft] = useState<DealFieldLayout>(layout)
  const [error, setError] = useState("")
  const [newLabel, setNewLabel] = useState("")
  const [newType, setNewType] = useState<"text" | "number" | "date">("text")

  function toggleHidden(id: string) {
    setDraft((current) => ({
      ...current,
      hidden: current.hidden.includes(id) ? current.hidden.filter((entry) => entry !== id) : [...current.hidden, id],
    }))
  }

  function addCustomField() {
    const label = newLabel.trim()
    if (!label) { setError("Enter a label for the custom field"); return }
    if (draft.custom.length >= 10) { setError("You can add up to 10 custom fields"); return }
    if (draft.custom.some((field) => field.label.toLowerCase() === label.toLowerCase())) { setError("A field with this label already exists"); return }
    setDraft((current) => ({ ...current, custom: [...current.custom, { id: crypto.randomUUID().slice(0, 8), label, type: newType }] }))
    setNewLabel("")
    setError("")
  }

  async function submit() {
    setError("")
    try {
      await onSave(draft)
    } catch {
      setError("The layout could not be saved. Please try again.")
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-hidden border-l bg-background p-0 sm:max-w-[34rem]" showCloseButton>
        <div className="flex min-h-0 flex-1 flex-col">
          <SheetHeader className="border-b px-5 py-5 sm:px-7">
            <SheetTitle className="flex items-center gap-2 text-xl font-semibold tracking-tight">Edit Deal Fields <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{pipelineName}</span></SheetTitle>
            <SheetDescription className="text-pretty">Show, hide, and add fields for every deal in this pipeline.</SheetDescription>
          </SheetHeader>

          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-6 px-5 py-6 sm:px-7">
              <section aria-labelledby="required-fields-heading" className="flex flex-col gap-2">
                <h2 id="required-fields-heading" className="text-sm font-semibold">Deal Information</h2>
                {REQUIRED_FIELDS.map((field) => (
                  <div key={field.id} className="flex items-center justify-between gap-2 rounded-lg border border-l-2 border-l-destructive/60 bg-card px-3 py-2.5">
                    <span className="text-sm font-medium">{field.label}</span>
                    <span className="text-xs text-muted-foreground">{field.kind}</span>
                  </div>
                ))}
                {OPTIONAL_FIELDS.map((field) => {
                  const hidden = draft.hidden.includes(field.id)
                  return (
                    <div key={field.id} className={hidden ? "flex items-center justify-between gap-2 rounded-lg border border-dashed bg-muted/40 px-3 py-2.5 opacity-70" : "flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2.5"}>
                      <span className="text-sm font-medium">{field.label}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{field.kind}</span>
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => toggleHidden(field.id)} aria-label={hidden ? `Show ${field.label}` : `Hide ${field.label}`} aria-pressed={hidden}>
                          {hidden ? <EyeOff /> : <Eye />}
                        </Button>
                      </span>
                    </div>
                  )
                })}
              </section>

              <section aria-labelledby="custom-fields-heading" className="flex flex-col gap-2 border-t pt-5">
                <div className="flex items-center justify-between">
                  <h2 id="custom-fields-heading" className="text-sm font-semibold">Custom Fields</h2>
                  <span className="text-xs text-muted-foreground">Used: {draft.custom.length}/10</span>
                </div>
                {draft.custom.length === 0 && <p className="rounded-lg border border-dashed bg-muted/40 px-3 py-4 text-center text-sm text-muted-foreground">No custom fields yet. Add one below.</p>}
                {draft.custom.map((field) => (
                  <div key={field.id} className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2.5">
                    <span className="text-sm font-medium">{field.label}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs capitalize text-muted-foreground">{field.type}</span>
                      <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-destructive" onClick={() => setDraft((current) => ({ ...current, custom: current.custom.filter((entry) => entry.id !== field.id) }))} aria-label={`Delete ${field.label}`}><Trash2 /></Button>
                    </span>
                  </div>
                ))}
                <div className="mt-1 flex flex-wrap items-end gap-2">
                  <Field className="min-w-40 flex-1">
                    <FieldLabel htmlFor="custom-field-label">New field label</FieldLabel>
                    <Input id="custom-field-label" value={newLabel} onChange={(event) => { setNewLabel(event.target.value); if (error) setError("") }} placeholder="Probability (%), Next step…" maxLength={60} />
                  </Field>
                  <Field className="w-32">
                    <FieldLabel htmlFor="custom-field-type">Type</FieldLabel>
                    <Select items={{ text: "Text", number: "Number", date: "Date" }} value={newType} onValueChange={(value) => value && setNewType(value as typeof newType)}>
                      <SelectTrigger id="custom-field-type" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectGroup><SelectItem value="text">Text</SelectItem><SelectItem value="number">Number</SelectItem><SelectItem value="date">Date</SelectItem></SelectGroup></SelectContent>
                    </Select>
                  </Field>
                  <Button type="button" variant="outline" onClick={addCustomField} disabled={draft.custom.length >= 10}><Plus data-icon="inline-start" />Custom Field</Button>
                </div>
              </section>

              {error && <Field data-invalid><FieldError>{error}</FieldError></Field>}
            </div>
          </ScrollArea>

          <SheetFooter className="border-t bg-background/95 px-5 py-4 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <p className="hidden text-xs text-muted-foreground sm:block">Used Custom Fields: {draft.custom.length}/10</p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
              <Button type="button" onClick={submit} disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
            </div>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  )
}
