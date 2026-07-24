'use client';

import { useMemo, useState } from 'react';
import {
  RecordFieldsEditor,
  type RecordCustomFieldDraft,
  type RecordEditorField,
} from '@/components/shared/record-fields-editor';
import { saveModuleFieldLayoutAction } from '@/features/module-fields/lib/actions';
import type {
  ModuleFieldLayout,
  ModuleKey,
} from '@/features/module-fields/lib/validation';

const MODULE_FIELD_TYPES: Record<string, string> = {
  text: 'Single Line',
  number: 'Number',
  date: 'Date Picker',
};

/**
 * Generic "Customize Fields" editor for non-pipeline modules (Appointments,
 * Catalog, and any future module). One reusable flavour of the shared
 * RecordFieldsEditor: callers only declare their standard fields — layout
 * fetch/persist always goes through module_field_settings, so every module
 * gets the same Bigin-style editing surface with zero duplicated logic.
 */
export function ModuleFieldsEditor({
  open,
  module: moduleKey,
  title,
  badge,
  sectionTitle,
  requiredFields,
  optionalFields,
  layout,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  module: ModuleKey;
  title: string;
  badge?: string;
  sectionTitle: string;
  /** Standard fields pinned on the form (cannot be removed) */
  requiredFields: RecordEditorField[];
  /** Standard fields that can be hidden via layout.hidden */
  optionalFields: RecordEditorField[];
  layout: ModuleFieldLayout;
  onOpenChange: (open: boolean) => void;
  /** Called with the persisted layout after a successful save */
  onSaved: (layout: ModuleFieldLayout) => void;
}) {
  const [custom, setCustom] = useState(layout.custom);
  const [pending, setPending] = useState(false);
  const optionalIds = useMemo(
    () => new Set(optionalFields.map((field) => field.id)),
    [optionalFields]
  );

  const fields = useMemo<RecordEditorField[]>(
    () => [
      ...requiredFields,
      ...optionalFields,
      ...custom.map((field) => ({
        id: field.id,
        label: field.label,
        typeLabel: MODULE_FIELD_TYPES[field.type] ?? field.type,
        removable: true,
        editable: true,
        countsTowardLimit: true,
        draft: {
          label: field.label,
          type: field.type,
          options: [],
          required: false,
          unique: false,
        },
      })),
    ],
    [requiredFields, optionalFields, custom]
  );

  const initialUsed = useMemo(
    () => [
      ...requiredFields.map((field) => field.id),
      ...optionalFields
        .filter((field) => !layout.hidden.includes(field.id))
        .map((field) => field.id),
      ...custom.map((field) => field.id),
    ],
    [requiredFields, optionalFields, layout.hidden, custom]
  );

  return (
    <RecordFieldsEditor
      open={open}
      title={title}
      badge={badge}
      sectionTitle={sectionTitle}
      fields={fields}
      initialUsed={initialUsed}
      fieldTypes={MODULE_FIELD_TYPES}
      saving={pending}
      onOpenChange={onOpenChange}
      onSave={async (usedIds) => {
        const usedSet = new Set(usedIds);
        setPending(true);
        try {
          const next: ModuleFieldLayout = {
            hidden: [...optionalIds].filter((id) => !usedSet.has(id)),
            // Custom fields removed from the form are deleted from the layout
            custom: custom.filter((field) => usedSet.has(field.id)),
          };
          const result = await saveModuleFieldLayoutAction(moduleKey, next);
          if (result.ok) {
            onSaved(result.data);
            onOpenChange(false);
          }
        } finally {
          setPending(false);
        }
      }}
      onCreateField={async (draft: RecordCustomFieldDraft) => {
        const id = crypto.randomUUID().slice(0, 8);
        const type = (
          ['text', 'number', 'date'].includes(draft.type) ? draft.type : 'text'
        ) as 'text' | 'number' | 'date';
        setCustom((current) => [...current, { id, label: draft.label, type }]);
        return id;
      }}
      onEditField={async (id, draft) => {
        const type = (
          ['text', 'number', 'date'].includes(draft.type) ? draft.type : 'text'
        ) as 'text' | 'number' | 'date';
        setCustom((current) =>
          current.map((field) =>
            field.id === id ? { ...field, label: draft.label, type } : field
          )
        );
      }}
      validateField={(draft, editingId) => {
        const clash =
          [...requiredFields, ...optionalFields].some(
            (field) => field.label.toLowerCase() === draft.label.toLowerCase()
          ) ||
          custom.some(
            (field) =>
              field.id !== editingId &&
              field.label.toLowerCase() === draft.label.toLowerCase()
          );
        return clash ? 'A field with this label already exists' : '';
      }}
    />
  );
}
