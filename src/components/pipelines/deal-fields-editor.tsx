"use client"

import { RecordFieldsEditor, type RecordFieldDef } from "@/components/shared/record-fields-editor"
import type { DealFieldLayout } from "@/lib/pipelines/validation"

// Standard fields that can be hidden from the deal form (required ones excluded)
const OPTIONAL_FIELDS: RecordFieldDef[] = [
  { id: "company", label: "Company Name", kind: "Single Line" },
  { id: "contact", label: "Contact Name", kind: "Lookup" },
  { id: "due", label: "Closing Date", kind: "Date Picker" },
  { id: "source", label: "Source", kind: "Single Line" },
  { id: "salesDetails", label: "Sales Details", kind: "Section" },
  { id: "catalog", label: "Associated Products", kind: "Line Items" },
  { id: "description", label: "Description", kind: "Multi-line (Large)" },
]

const REQUIRED_FIELDS: RecordFieldDef[] = [
  { id: "title", label: "Deal Name", kind: "Single Line" },
  { id: "value", label: "Amount", kind: "Currency" },
  { id: "stage", label: "Sub-Pipeline & Stage", kind: "Single Select" },
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
  return (
    <RecordFieldsEditor
      open={open}
      title="Edit Deal Fields"
      badge={pipelineName}
      sectionTitle="Deal Information"
      requiredFields={REQUIRED_FIELDS}
      optionalFields={OPTIONAL_FIELDS}
      layout={layout}
      pending={pending}
      onOpenChange={onOpenChange}
      onSave={onSave}
    />
  )
}
