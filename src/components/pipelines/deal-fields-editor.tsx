"use client"

import { useMemo, useState } from "react"
import { RecordFieldsEditor, type RecordCustomFieldDraft, type RecordEditorField } from "@/components/shared/record-fields-editor"
import type { DealFieldLayout } from "@/lib/pipelines/validation"

// Standard fields pinned on every deal form (cannot be removed)
export const DEAL_REQUIRED_FIELDS: RecordEditorField[] = [
  { id: "title", label: "Deal Name", typeLabel: "Single Line", required: true },
  { id: "value", label: "Amount", typeLabel: "Currency", required: true },
  { id: "stage", label: "Sub-Pipeline & Stage", typeLabel: "Single Select", required: true },
  { id: "owner", label: "Owner", typeLabel: "Lookup", required: true },
]

// Standard fields that can be hidden from the deal form
export const DEAL_OPTIONAL_FIELDS: RecordEditorField[] = [
  { id: "company", label: "Company Name", typeLabel: "Single Line", removable: true },
  { id: "contact", label: "Contact Name", typeLabel: "Lookup", removable: true },
  { id: "due", label: "Closing Date", typeLabel: "Date Picker", removable: true },
  { id: "source", label: "Source", typeLabel: "Single Line", removable: true },
  { id: "salesDetails", label: "Sales Details", typeLabel: "Section", removable: true },
  { id: "catalog", label: "Associated Products", typeLabel: "Line Items", removable: true },
  { id: "description", label: "Description", typeLabel: "Multi-line (Large)", removable: true },
]

const DEAL_FIELD_TYPES: Record<string, string> = { text: "Single Line", number: "Number", date: "Date Picker" }
const OPTIONAL_IDS = new Set(DEAL_OPTIONAL_FIELDS.map((field) => field.id))

/**
 * Deal flavour of the generic RecordFieldsEditor. Custom fields live inside
 * the pipeline's DealFieldLayout, so creating one only mutates local state —
 * everything persists together when the layout is saved.
 */
export function DealFieldsEditor({ open, pipelineName, layout, pending, onOpenChange, onSave }: {
  open: boolean
  pipelineName: string
  layout: DealFieldLayout
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSave: (layout: DealFieldLayout) => Promise<void>
}) {
  const [custom, setCustom] = useState(layout.custom)

  const fields = useMemo<RecordEditorField[]>(() => [
    ...DEAL_REQUIRED_FIELDS,
    ...DEAL_OPTIONAL_FIELDS,
    ...custom.map((field) => ({
      id: field.id,
      label: field.label,
      typeLabel: DEAL_FIELD_TYPES[field.type] ?? field.type,
      removable: true,
      editable: true,
      countsTowardLimit: true,
      draft: { label: field.label, type: field.type, options: [], required: false, unique: false },
    })),
  ], [custom])

  const initialUsed = useMemo(() => [
    ...DEAL_REQUIRED_FIELDS.map((field) => field.id),
    ...DEAL_OPTIONAL_FIELDS.filter((field) => !layout.hidden.includes(field.id)).map((field) => field.id),
    ...custom.map((field) => field.id),
  ], [layout.hidden, custom])

  return (
    <RecordFieldsEditor
      open={open}
      title="Edit Deal Fields"
      badge={pipelineName}
      sectionTitle="Deal Information"
      fields={fields}
      initialUsed={initialUsed}
      fieldTypes={DEAL_FIELD_TYPES}
      saving={pending}
      onOpenChange={onOpenChange}
      onSave={async (usedIds) => {
        const usedSet = new Set(usedIds)
        await onSave({
          hidden: [...OPTIONAL_IDS].filter((id) => !usedSet.has(id)),
          // Custom fields removed from the form are deleted from the layout
          custom: custom.filter((field) => usedSet.has(field.id)),
        })
      }}
      onCreateField={async (draft: RecordCustomFieldDraft) => {
        const id = crypto.randomUUID().slice(0, 8)
        const type = (["text", "number", "date"].includes(draft.type) ? draft.type : "text") as "text" | "number" | "date"
        setCustom((current) => [...current, { id, label: draft.label, type }])
        return id
      }}
      onEditField={async (id, draft) => {
        const type = (["text", "number", "date"].includes(draft.type) ? draft.type : "text") as "text" | "number" | "date"
        setCustom((current) => current.map((field) => (field.id === id ? { ...field, label: draft.label, type } : field)))
      }}
      validateField={(draft, editingId) => {
        const clash = [...DEAL_REQUIRED_FIELDS, ...DEAL_OPTIONAL_FIELDS].some((field) => field.label.toLowerCase() === draft.label.toLowerCase())
          || custom.some((field) => field.id !== editingId && field.label.toLowerCase() === draft.label.toLowerCase())
        return clash ? "A field with this label already exists" : ""
      }}
    />
  )
}
