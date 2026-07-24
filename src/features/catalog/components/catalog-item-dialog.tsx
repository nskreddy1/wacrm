'use client';

// ============================================================
// Catalog item dialog — shared create/edit form for catalog
// items. Pass `item` to edit, or null to create.
// ============================================================

import { useState } from 'react';
import { Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { getCurrencySymbol } from '@/lib/currency';
import type { CatalogItem } from '@/lib/data/operations/types';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ModuleCustomFieldsSection } from '@/components/shared/module-custom-fields-section';

export function CatalogItemDialog({
  open,
  onOpenChange,
  item,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing item to edit, or null to create a new one. */
  item: CatalogItem | null;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Key-based remount: the form initializes its state from `item`
          in useState initializers and remounts fresh per item/open cycle,
          replacing the previous "sync state on open" effect. */}
      {open && (
        <CatalogItemForm
          key={item?.id ?? 'new'}
          item={item}
          onOpenChange={onOpenChange}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  );
}

function CatalogItemForm({
  item,
  onOpenChange,
  onSaved,
}: {
  item: CatalogItem | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  // Currency is a workspace-level setting (Settings → Deals), not a
  // per-item choice — every price in the account renders in one currency.
  const { defaultCurrency } = useAuth();

  const [name, setName] = useState(item?.name ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [price, setPrice] = useState(item ? String(item.price) : '0');
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [customValues, setCustomValues] = useState<Record<string, string>>(
    item?.customValues ?? {}
  );
  const [submitting, setSubmitting] = useState(false);

  const isEdit = item !== null;

  const parsedPrice = Number.parseFloat(price);
  const priceValid = Number.isFinite(parsedPrice) && parsedPrice >= 0;
  const canSubmit = name.trim().length > 0 && priceValid && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
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
      };
      const res = await fetch('/api/v1/workspace/catalog', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: item.id, ...payload } : payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          body?.error?.message ?? 'Could not save the catalog item'
        );
      }
      toast.success(isEdit ? 'Item updated' : 'Item created');
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not save the catalog item'
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogContent className="gap-0 p-0 sm:max-w-lg">
      <DialogHeader className="border-border border-b px-6 py-4">
        <DialogTitle>{isEdit ? 'Edit item' : 'New catalog item'}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? 'Update this product or service.'
            : 'Add a product or service your team can schedule and sell.'}
        </DialogDescription>
      </DialogHeader>

      <div className="flex max-h-[65vh] flex-col gap-5 overflow-y-auto px-6 py-5">
        <fieldset className="flex flex-col gap-3">
          <legend className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Item
          </legend>
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
              <div className="border-border flex h-9 items-center gap-2 rounded-md border px-3">
                <Switch
                  id="cat-active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                />
                <span className="text-muted-foreground text-sm">
                  {isActive ? 'Active' : 'Archived'}
                </span>
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
          <legend className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Pricing
          </legend>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cat-price">
              Price ({defaultCurrency}){' '}
              <span className="text-destructive">*</span>
            </Label>
            <div className="relative">
              <span
                className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm"
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
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
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

      <DialogFooter className="border-border border-t px-6 py-4">
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {submitting && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
          {isEdit ? 'Save changes' : 'Create item'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
