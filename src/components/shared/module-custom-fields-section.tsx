'use client';

// ============================================================
// ModuleCustomFieldsSection — reusable "Additional Information"
// field list for record sheets (Appointments, Catalog, ...).
//
// Reads the account's custom field layout for the module from
// the generic module-fields store and renders one row per field
// using the same label-grid DNA as the Contact record sheet
// (sm:grid-cols-[9rem_minmax(0,1fr)], right-aligned labels,
// h-11 inputs) so every module's create/edit surface matches.
//
// Values are controlled by the parent via a simple
// Record<string, string> keyed by field id — the same shape
// persisted to the row's custom_values jsonb column.
// ============================================================

import useSWR from 'swr';

import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { getModuleFieldLayoutAction } from '@/features/module-fields/lib/actions';
import {
  EMPTY_MODULE_FIELD_LAYOUT,
  type ModuleKey,
} from '@/features/module-fields/lib/validation';

const INPUT_TYPE: Record<string, string> = {
  text: 'text',
  number: 'number',
  date: 'date',
};

/** SWR hook shared with the record sheets so they can hide the section when empty. */
export function useModuleFieldLayout(module: ModuleKey) {
  const { data } = useSWR(`module-fields:${module}`, async () => {
    const result = await getModuleFieldLayoutAction(module);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  });
  return data ?? EMPTY_MODULE_FIELD_LAYOUT;
}

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
  const layout = useModuleFieldLayout(module);

  if (layout.custom.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No custom fields have been configured.
      </p>
    );
  }

  return (
    <>
      {layout.custom.map((field) => {
        const inputId = `custom-${module}-${field.id}`;
        return (
          <Field
            key={field.id}
            className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4"
          >
            <FieldLabel htmlFor={inputId} className="sm:w-36 sm:justify-end">
              {field.label}
            </FieldLabel>
            <Input
              id={inputId}
              type={INPUT_TYPE[field.type] ?? 'text'}
              value={values[field.id] ?? ''}
              disabled={disabled}
              maxLength={500}
              className="h-11 flex-1"
              onChange={(event) =>
                onChange({ ...values, [field.id]: event.target.value })
              }
            />
          </Field>
        );
      })}
    </>
  );
}
