"use client"

// ============================================================
// Catalog item dialog — shared create/edit form for catalog
// items. Pass `item` to edit, or null to create.
// ============================================================

import { useEffect, useState } from "react"
import { Info, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { getCurrencySymbol } from "@/lib/currency"
import type { CatalogItem } from "@/lib/data/operations/types"
import { useAuth } from "@/hooks/use-auth"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ModuleCustomFieldsSection } from "@/components/shared/module-custom-fields-section"

export function CatalogItemDialog({
  open,
  onOpenChange,
  item,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing item to edit, or null to create a new one. */
  item: CatalogItem | null
  onSaved: () => void
}) {
  // Currency is a workspace-level setting (Settings → Deals), not a
  // per-item choice — every price in the account renders in one currency.
  const { defaultCurrency } = useAuth()

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("")
  const [price, setPrice] = useState("0")
  const [isActive, setIsActive] = useState(true)
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const isEdit = item !== null

  // Sync form state when the dialog opens for a different item.
  useEffect(() => {
    if (!open) return
    setName(item?.name ?? "")
    setDescription(item?.description ?? "")
    setCategory(item?.category ?? "")
    setPrice(item ? String(item.price) : "0")
    setIsActive(item?.isActive ?? true)
    setCustomValues(item?.customValues ?? {})
  }, [open, item])

  const parsedPrice = Number.parseFloat(price)
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice >= 0
  const canSubmit = name.trim().length > 0 && priceValid && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{isEdit ? "Edit item" : "New catalog item"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update this product or service."
              : "Add a product or service your team can schedule and sell."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto px-6 py-5">
          <fieldset className="flex flex-col gap-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Item</legend>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cat-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="cat-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Admission counseling"
                maxLength={160}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cat-category">Category</Label>
                <Input
                  id="cat-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  placeholder="e.g. Consulting"
                  maxLength={80}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cat-active">Availability</Label>
                <div className="flex h-9 items-center gap-2 rounded-md border border-border px-3">
                  <Switch id="cat-active" checked={isActive} onCheckedChange={setIsActive} />
                  <span className="text-sm text-muted-foreground">{isActive ? "Active" : "Archived"}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cat-description">Description</Label>
              <Textarea
                id="cat-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="What does this item include?"
                rows={2}
                maxLength={2000}
              />
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pricing</legend>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cat-price">
                Price ({defaultCurrency}) <span className="text-destructive">*</span>
              </Label>
              <div className="relative">
                <span
                  className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
                  aria-hidden="true"
                >
                  {getCurrencySymbol(defaultCurrency)}
                </span>
                <Input
                  id="cat-price"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className="pl-8"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  aria-invalid={!priceValid}
                />
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="size-3.5 shrink-0" aria-hidden="true" />
                Workspace currency is set in Settings and applies everywhere.
              </p>
            </div>
          </fieldset>

          <ModuleCustomFieldsSection
            module="catalog"
            values={customValues}
            onChange={setCustomValues}
            disabled={submitting}
          />
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {isEdit ? "Save changes" : "Create item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
