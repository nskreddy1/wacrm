"use client"

import { useMemo, useState } from "react"
import { RecordFieldsEditor, type RecordCustomFieldDraft, type RecordEditorField } from "@/components/shared/record-fields-editor"
import type { ModuleFieldLayout } from "@/features/module-fields/lib/validation"
import type { ModuleKey } from "@/features/module-fields/lib/validation"

/**
 * Standard-field registry for the non-pipeline modules. Same structure the
 * deal flavour uses, so Appointments and Catalog get the identical
 * Bigin-style Customize Fields surface via RecordFieldsEditor.
 */
export const MODULE_FIELD_REGISTRY: Record<
  ModuleKey,
  {
    title: string
    sectionTitle: string
    required: RecordEditorField[]
    optional: RecordEditorField[]
  }
> = {
  appointments: {
    title: "Edit Appointment Fields",
    sectionTitle: "Appointment Information",
    required: [
      { id: "title", label: "Title", typeLabel: "Single Line", required: true },
      { id: "contact", label: "Contact", typeLabel: "Lookup", required: true },
      { id: "starts_at", label: "Start Time", typeLabel: "Date/Time Picker", required: true },
    ],
    optional: [
      { id: "ends_at", label: "End Time", typeLabel: "Date/Time Picker", removable: true },
      { id: "location", label: "Location", typeLabel: "Single Line", removable: true },
      { id: "status", label: "Status", typeLabel: "Single Select", removable: true },
      { id: "catalog_item", label: "Catalog Item", typeLabel: "Lookup", removable: true },
      { id: "deal", label: "Related Deal", typeLabel: "Lookup", removable: true },
      { id: "assigned_to", label: "Host", typeLabel: "Lookup", removable: true },
      { id: "notes", label: "Notes", typeLabel: "Multi-line (Large)", removable: true },
    ],
  },
  catalog: {
    title: "Edit Catalog Fields",
    sectionTitle: "Catalog Item Information",
    required: [
      { id: "name", label: "Name", typeLabel: "Single Line", required: true },
      { id: "price", label: "Price", typeLabel: "Currency", required: true },
    ],
    optional: [
      { id: "category", label: "Category", typeLabel: "Single Line", removable: true },
      { id: "currency", label: "Currency", typeLabel: "Single Select", removable: true },
      { id: "is_active", label: "Active", typeLabel: "Checkbox", removable: true },
      { id: "description", label: "Description", typeLabel: "Multi-line (Large)", removable: true },
    ],
  },
}

const MODULE_FIELD_TYPES: Record<string, string> = { text: "Single Line", number: "Number", date: "Date Picker" }

/**
 * Module flavour of the generic RecordFieldsEditor — the exact component the
 * contact and deal Customize Fields flows already share. Layout persists via
 * the module-fields server actions (module_field_settings).
 */
export function ModuleFieldsEditor({ open, module, layout, pending, onOpenChange, onSave }: {
  open: boolean
  module: ModuleKey
  layout: ModuleFieldLayout
  pending: boolean
  onOpenChange: (open: boolean) => void
  onSave: (layout: ModuleFieldLayout) => Promise<void>
}) {
  const registry = MODULE_FIELD_REGISTRY[module]
  const [custom, setCustom] = useState(layout.custom)
  const optionalIds = useMemo(() => new Set(registry.optional.map((field) => field.id)), [registry])

  const fields = useMemo<RecordEditorField[]>(
    () => [
      ...registry.required,
      ...registry.optional,
      ...custom.map((field) => ({
        id: field.id,
        label: field.label,
        typeLabel: MODULE_FIELD_TYPES[field.type] ?? field.type,
        removable: true,
        editable: true,
        countsTowardLimit: true,
        draft: { label: field.label, type: field.type, options: [], required: false, unique: false },
      })),
    ],
    [registry, custom],
  )

  const initialUsed = useMemo(
    () => [
      ...registry.required.map((field) => field.id),
      ...registry.optional.filter((field) => !layout.hidden.includes(field.id)).map((field) => field.id),
      ...custom.map((field) => field.id),
    ],
    [registry, layout.hidden, custom],
  )

  return (
    <RecordFieldsEditor
      open={open}
      title={registry.title}
      sectionTitle={registry.sectionTitle}
      fields={fields}
      initialUsed={initialUsed}
      fieldTypes={MODULE_FIELD_TYPES}
      saving={pending}
      onOpenChange={onOpenChange}
      onSave={async (usedIds) => {
        const usedSet = new Set(usedIds)
        await onSave({
          hidden: [...optionalIds].filter((id) => !usedSet.has(id)),
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
        const clash =
          [...registry.required, ...registry.optional].some((field) => field.label.toLowerCase() === draft.label.toLowerCase()) ||
          custom.some((field) => field.id !== editingId && field.label.toLowerCase() === draft.label.toLowerCase())
        return clash ? "A field with this label already exists" : ""
      }}
    />
  )
}
