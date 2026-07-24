'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

export interface EditFieldTarget {
  id: string;
  label: string;
  /** Broad type shown in the "Field Type" row (e.g. "Text"). */
  typeLabel: string;
  /** Specific variant shown in the "Sub Type" row (e.g. "Single Line"). */
  subTypeLabel: string;
  required: boolean;
  unique: boolean;
  /** Custom fields can be renamed; standard fields are read-only. */
  editable: boolean;
  /** Whether the mandatory checkbox can be toggled. */
  canToggleRequired?: boolean;
  /** Whether the duplicate-values checkbox is shown/toggleable. */
  canToggleUnique?: boolean;
}

/**
 * Bigin-style "Edit Field" sheet (reference: Field Label / Field Type /
 * Sub Type rows plus Mandatory + duplicate checkboxes with a module
 * chip in the header). One shared surface for every module — contacts,
 * appointments, catalog and pipeline deals all pass their own save
 * handler; standard fields open read-only.
 */
export function EditFieldSheet({
  open,
  module,
  field,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  module: string;
  field: EditFieldTarget;
  saving?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (next: { label: string; required: boolean; unique: boolean }) => void;
}) {
  const [label, setLabel] = useState(field.label);
  const [required, setRequired] = useState(field.required);
  const [unique, setUnique] = useState(field.unique);

  const dirty =
    label.trim() !== field.label ||
    required !== field.required ||
    unique !== field.unique;
  const canSave =
    field.editable || field.canToggleRequired || field.canToggleUnique
      ? dirty && label.trim().length > 0
      : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-border border-b px-5 py-4">
          <SheetTitle className="flex items-center gap-2.5 text-lg">
            Edit Field
            <Badge variant="secondary" className="rounded-full font-normal">
              {module}
            </Badge>
          </SheetTitle>
          <SheetDescription className="sr-only">
            Edit the {field.label} field for {module}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-5">
          <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3">
            <span className="text-muted-foreground w-24 shrink-0 text-sm">
              Field Label
            </span>
            {field.editable ? (
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={60}
                className="bg-card h-8 flex-1"
                aria-label="Field label"
              />
            ) : (
              <span className="text-foreground truncate text-sm font-medium">
                {field.label}
              </span>
            )}
          </div>

          <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3.5">
            <span className="text-muted-foreground w-24 shrink-0 text-sm">
              Field Type
            </span>
            <span className="text-foreground text-sm font-medium">
              {field.typeLabel}
            </span>
          </div>

          <div className="border-border bg-muted/40 flex items-center gap-4 rounded-md border px-4 py-3.5">
            <span className="text-muted-foreground w-24 shrink-0 text-sm">
              Sub Type
            </span>
            <span className="text-foreground text-sm font-medium">
              {field.subTypeLabel}
            </span>
          </div>

          <label className="text-foreground flex items-center gap-2.5 pt-2 text-sm">
            <Checkbox
              checked={required}
              disabled={!field.canToggleRequired}
              onCheckedChange={(value) => setRequired(value === true)}
            />
            Mandatory Field
          </label>

          {(field.canToggleUnique || field.unique) && (
            <label className="text-foreground flex items-center gap-2.5 text-sm">
              <Checkbox
                checked={unique}
                disabled={!field.canToggleUnique}
                onCheckedChange={(value) => setUnique(value === true)}
              />
              Do not allow duplicate values
            </label>
          )}

          {!field.editable &&
            !field.canToggleRequired &&
            !field.canToggleUnique && (
              <p className="text-muted-foreground pt-2 text-xs">
                This is a standard field — its settings are managed by the
                system.
              </p>
            )}
        </div>

        <SheetFooter className="border-border flex-row justify-end gap-2 border-t px-5 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSave || saving}
            onClick={() => onSave({ label: label.trim(), required, unique })}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
