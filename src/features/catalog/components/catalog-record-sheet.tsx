"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { toast } from "sonner"

import { getCurrencySymbol } from "@/lib/currency"
import type { CatalogItem } from "@/lib/data/operations/types"
import { useAuth } from "@/features/auth/hooks/use-auth"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { RecordField, RecordSection, RecordSheet } from "@/components/shared/record-sheet"
import { ModuleFieldsEditor } from "@/features/module-fields/components/module-fields-editor"
import { getModuleFieldLayoutAction } from "@/features/module-fields/lib/actions"
import { EMPTY_MODULE_FIELD_LAYOUT } from "@/features/module-fields/lib/validation"
import type { RecordEditorField } from "@/components/shared/record-fields-editor"

// Standard fields pinned on every catalog item form (cannot be removed)
const CATALOG_REQUIRED_FIELDS: RecordEditorField[] = [
  { id: "name", label: "Name", typeLabel: "Single Line", required: true },
  { id: "price", label: "Price", typeLabel: "Currency", required: true },
]

// Standard fields that can be hidden via Customize Fields
const CATALOG_OPTIONAL_FIELDS: RecordEditorField[] = [
  { id: "category", label: "Category", typeLabel: "Single Line", removable: true },
  { id: "availability", label: "Availability", typeLabel: "Toggle", removable: true },
  { id: "description", label: "Description", typeLabel: "Multi-line (Large)", removable: true },
]

/**
 * "Create / Edit Catalog Item" sheet — same RecordSheet design as Create
 * Contact and Create Deal, including the shared Customize Fields editor.
 * Pass `item` to edit, or null to create. Keyed remount (per item) keeps the
 * form state initialization effect-free.
 */
export function CatalogRecordSheet({ open, item, onOpenChange, onSaved }: {
  open: boolean
  /** Existing item to edit, or null to create a new one. */
  item: CatalogItem | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  if (!open) return null
  return <CatalogRecordSheetForm key={item?.id ?? "new"} item={item} onOpenChange={onOpenChange} onSaved={onSaved} />
}

function CatalogRecordSheetForm({ item, onOpenChange, onSaved }: {
  item: CatalogItem | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  // Currency is a workspace-level setting (Settings → Deals), not a
  // per-item choice — every price in the account renders in one currency.
  const { defaultCurrency } = useAuth()

  const [name, setName] = useState(item?.name ?? "")
  const [description, setDescription] = useState(item?.description ?? "")
  const [category, setCategory] = useState(item?.category ?? "")
  const [price, setPrice] = useState(item ? String(item.price) : "0")
  const [isActive, setIsActive] = useState(item?.isActive ?? true)
  const [customValues, setCustomValues] = useState<Record<string, string>>(item?.customValues ?? {})
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [fieldsOpen, setFieldsOpen] = useState(false)

  const { data: layout, mutate: mutateLayout } = useSWR(
    ["module-field-layout", "catalog"],
    async () => {
      const result = await getModuleFieldLayoutAction("catalog")
      return result.ok ? result.data : EMPTY_MODULE_FIELD_LAYOUT
    },
  )
  const hidden = useMemo(() => new Set(layout?.hidden ?? []), [layout])

  const isEdit = item !== null
  const parsedPrice = Number.parseFloat(price)
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice >= 0

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim()) { setError("Enter an item name."); return }
    if (!priceValid) { setError("Enter a valid price."); return }
    if (submitting) return
    setSubmitting(true)
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        price: parsedPrice,
        // Always stamp the workspace currency: edits migrate legacy
        // rows to the global setting instead of preserving drift.
        currency: defaultCurrency,
        isActive,
        customValues,
      }
      const res = await fetch("/api/v1/workspace/catalog", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isEdit ? { id: item.id, ...payload } : payload),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        throw new Error(body?.error?.message ?? "Could not save the catalog item")
      }
      toast.success(isEdit ? "Item updated" : "Item created")
      onOpenChange(false)
      onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the catalog item")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <RecordSheet
        open
        title={isEdit ? "Edit Catalog Item" : "Create Catalog Item"}
        description={isEdit ? "Update this product or service" : "Add a product or service your team can schedule and sell"}
        saving={submitting}
        isCreate={!isEdit}
        onOpenChange={onOpenChange}
        onSubmit={handleSubmit}
        onCustomize={() => setFieldsOpen(true)}
      >
        <RecordSection id="catalog-information" title="Item Information">
          <RecordField label="Name" htmlFor="catalog-name" error={!name.trim() && error ? error : undefined}>
            <Input id="catalog-name" autoFocus value={name} maxLength={160} onChange={(event) => { setName(event.target.value); setError("") }} placeholder="e.g. Admission counseling" aria-invalid={!name.trim() && Boolean(error)} className="h-11" />
          </RecordField>
          {!hidden.has("category") && (
            <RecordField label="Category" htmlFor="catalog-category">
              <Input id="catalog-category" value={category} maxLength={80} onChange={(event) => setCategory(event.target.value)} placeholder="e.g. Consulting" className="h-11" />
            </RecordField>
          )}
          <RecordField label={`Price (${defaultCurrency})`} htmlFor="catalog-price" error={!priceValid && error ? error : undefined}>
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground" aria-hidden="true">{getCurrencySymbol(defaultCurrency)}</span>
              <Input id="catalog-price" type="number" min="0" step="0.01" inputMode="decimal" value={price} onChange={(event) => { setPrice(event.target.value); setError("") }} aria-invalid={!priceValid} className="h-11 pl-8" />
            </div>
          </RecordField>
          {!hidden.has("availability") && (
            <RecordField label="Availability" htmlFor="catalog-active">
              <div className="flex h-11 items-center gap-2.5 rounded-md border px-3">
                <Switch id="catalog-active" checked={isActive} onCheckedChange={setIsActive} />
                <span className="text-sm text-muted-foreground">{isActive ? "Active" : "Archived"}</span>
              </div>
            </RecordField>
          )}
          {!hidden.has("description") && (
            <RecordField label="Description" htmlFor="catalog-description">
              <Textarea id="catalog-description" value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} rows={2} placeholder="What does this item include?" className="min-h-11 resize-none" />
            </RecordField>
          )}
        </RecordSection>

        {(layout?.custom.length ?? 0) > 0 && (
          <RecordSection id="catalog-additional" title="Additional Information">
            {layout?.custom.map((field) => (
              <RecordField key={field.id} label={field.label} htmlFor={`catalog-custom-${field.id}`}>
                <Input
                  id={`catalog-custom-${field.id}`}
                  type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                  value={customValues[field.id] ?? ""}
                  onChange={(event) => setCustomValues((current) => ({ ...current, [field.id]: event.target.value }))}
                  className="h-11"
                />
              </RecordField>
            ))}
          </RecordSection>
        )}
      </RecordSheet>

      {fieldsOpen && layout && (
        <ModuleFieldsEditor
          open={fieldsOpen}
          module="catalog"
          title="Edit Catalog Fields"
          sectionTitle="Item Information"
          requiredFields={CATALOG_REQUIRED_FIELDS}
          optionalFields={CATALOG_OPTIONAL_FIELDS}
          layout={layout}
          onOpenChange={setFieldsOpen}
          onSaved={(next) => mutateLayout(next, { revalidate: false })}
        />
      )}
    </>
  )
}
