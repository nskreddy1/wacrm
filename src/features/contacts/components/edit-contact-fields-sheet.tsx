"use client"

import { useMemo } from "react"
import { toast } from "sonner"
import { RecordFieldsEditor, type RecordCustomFieldDraft, type RecordEditorField } from "@/components/shared/record-fields-editor"
import type { ContactField, ContactPreferences, FieldType } from "@/lib/data/contacts/types"
import { isReservedContactField, validateFieldDefinition } from "@/lib/data/contacts/validation"

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Single Line",
  number: "Number",
  date: "Date",
  email: "Email",
  phone: "Phone",
  url: "URL",
  single_select: "Pick List",
  multi_select: "Multi Select",
  checkbox: "Checkbox",
  currency: "Currency",
}

async function request(method: string, body: unknown) {
  const response = await fetch("/api/v1/workspace/contacts", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error?.message ?? "Request failed")
  return payload.data
}

/**
 * Contact flavour of the generic RecordFieldsEditor. Custom fields persist
 * immediately through the contacts API; visibility and order persist as
 * workspace preferences when the editor is saved.
 */
export function EditContactFieldsSheet({ open, fields, preferences, onOpenChange, onSaved }: {
  open: boolean
  fields: ContactField[]
  preferences: ContactPreferences
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<unknown> | void
}) {
  const editorFields = useMemo<RecordEditorField[]>(() => fields.map((field) => {
    const customEditable = field.custom && !isReservedContactField(field.label)
    return {
      id: field.id,
      label: field.label,
      typeLabel: FIELD_TYPE_LABELS[field.type],
      removable: customEditable,
      editable: customEditable,
      countsTowardLimit: customEditable,
      required: field.required,
      unique: field.unique,
      draft: { label: field.label, type: field.type, options: field.options ?? [], required: field.required === true, unique: field.unique === true },
    }
  }), [fields])

  const initialUsed = useMemo(() => {
    const ids = new Set(fields.map((field) => field.id))
    const ordered = preferences.order.filter((id) => preferences.visible.includes(id) && ids.has(id))
    const missing = preferences.visible.filter((id) => !ordered.includes(id) && ids.has(id))
    return [...ordered, ...missing]
  }, [fields, preferences])

  function toDefinition(draft: RecordCustomFieldDraft, editingId?: string) {
    return { ...validateFieldDefinition({ label: draft.label, type: draft.type as FieldType, options: draft.options }, fields, editingId), required: draft.required, unique: draft.unique }
  }

  return (
    <RecordFieldsEditor
      open={open}
      title="Edit Contact Fields"
      badge="Contacts"
      sectionTitle="Contact Information"
      fields={editorFields}
      initialUsed={initialUsed}
      fieldTypes={FIELD_TYPE_LABELS}
      optionTypes={["single_select", "multi_select"]}
      showFieldFlags
      saving={false}
      onOpenChange={onOpenChange}
      onSave={async (usedIds) => {
        try {
          const order = [...usedIds, ...preferences.order.filter((id) => !usedIds.includes(id))]
          await request("PATCH", { kind: "preferences", preferences: { visible: usedIds, order } })
          toast.success("Contact fields updated")
          await onSaved()
          onOpenChange(false)
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Unable to save fields")
        }
      }}
      onCreateField={async (draft) => {
        const created = (await request("POST", { kind: "field", field: toDefinition(draft) })) as ContactField
        toast.success("Custom field created")
        await onSaved()
        return created?.id ?? null
      }}
      onEditField={async (id, draft) => {
        await request("PATCH", { kind: "field", id, field: toDefinition(draft, id) })
        toast.success("Custom field updated")
        await onSaved()
      }}
      validateField={(draft, editingId) => {
        try {
          validateFieldDefinition({ label: draft.label, type: draft.type as FieldType, options: draft.options }, fields, editingId)
          return ""
        } catch (error) {
          return error instanceof Error ? error.message : "Check the field details"
        }
      }}
    />
  )
}
