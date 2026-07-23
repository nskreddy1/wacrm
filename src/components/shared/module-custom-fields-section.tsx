'use client';

// ============================================================
// ModuleCustomFieldsSection — reusable "Additional Information"
// block for create/edit dialogs (Appointments, Catalog, ...).
//
// Reads the account's custom field layout for the module from
// the generic module-fields store and renders one input per
// field. Values are controlled by the parent via a simple
// Record<string, string> keyed by field id — the same shape
// persisted to the row's custom_values jsonb column.
// ============================================================

import useSWR from 'swr';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getModuleFieldLayoutAction } from '@/lib/module-fields/actions';
import {
  EMPTY_MODULE_FIELD_LAYOUT,
  type ModuleKey,
} from '@/lib/module-fields/validation';

const INPUT_TYPE: Record<string, string> = {
  text: 'text',
  number: 'number',
  date: 'date',
};

export function ModuleCustomFieldsSection({
  module,
  values,
  onChange,
  disabled,
}: {
  module: ModuleKey;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const { data } = useSWR(`module-fields:${module}`, async () => {
    const result = await getModuleFieldLayoutAction(module);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  });

  const layout = data ?? EMPTY_MODULE_FIELD_LAYOUT;
  if (layout.custom.length === 0) return null;

  return (
    <fieldset className="space-y-3 border-t border-border pt-3">
      <legend className="sr-only">Additional information</legend>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Additional Information
      </p>
      {layout.custom.map((field) => (
        <div key={field.id} className="space-y-1.5">
          <Label htmlFor={`custom-${module}-${field.id}`}>{field.label}</Label>
          <Input
            id={`custom-${module}-${field.id}`}
            type={INPUT_TYPE[field.type] ?? 'text'}
            value={values[field.id] ?? ''}
            disabled={disabled}
            maxLength={500}
            onChange={(event) =>
              onChange({ ...values, [field.id]: event.target.value })
            }
          />
        </div>
      ))}
    </fieldset>
  );
}
