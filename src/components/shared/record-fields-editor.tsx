'use client';

import { useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  GripVertical,
  Info,
  Loader2,
  Pencil,
  Plus,
  Search,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * Generic "Edit X Fields" editor, extracted from the contact Edit Fields
 * design so every module (contacts, deals, companies, products, activities…)
 * shares the same Bigin-style surface:
 *   - left column: ordered, draggable "used" fields
 *   - right rail: searchable "unused" fields + "+ Custom Field"
 *   - stacked slide-in panel to create / edit a custom field
 *   - footer with the custom-field usage counter
 *
 * Persistence is delegated to the caller via callbacks, so any backend
 * (contacts API, deal layouts, future modules) can plug in.
 */

export type RecordEditorField = {
  id: string;
  label: string;
  /** Human readable kind, e.g. "Single Line", "Lookup", "Currency" */
  typeLabel: string;
  /** Removable fields can be moved to the Unused rail (standard required fields are not) */
  removable?: boolean;
  /** Editable fields show the pencil action and open the custom field panel */
  editable?: boolean;
  /** Counts toward the custom-field limit shown in the footer */
  countsTowardLimit?: boolean;
  required?: boolean;
  unique?: boolean;
  /** Current definition used to prefill the edit panel */
  draft?: RecordCustomFieldDraft;
};

export type RecordCustomFieldDraft = {
  label: string;
  type: string;
  options: string[];
  required: boolean;
  unique: boolean;
};

export function RecordFieldsEditor({
  open,
  title,
  badge,
  sectionTitle,
  fields,
  initialUsed,
  fieldTypes,
  optionTypes = [],
  showFieldFlags = false,
  maxCustom = 10,
  saving,
  onOpenChange,
  onSave,
  onCreateField,
  onEditField,
  validateField,
}: {
  open: boolean;
  title: string;
  badge?: string;
  sectionTitle: string;
  /** Every field available on this record type (used + unused) */
  fields: RecordEditorField[];
  /** Ordered ids of the fields currently shown on the record form */
  initialUsed: string[];
  /** Type key -> label offered when creating a custom field */
  fieldTypes: Record<string, string>;
  /** Type keys that require an options list (pick lists) */
  optionTypes?: string[];
  /** Show "Mandatory" / "No duplicates" checkboxes in the panel */
  showFieldFlags?: boolean;
  maxCustom?: number;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  /** Persist the ordered used field ids */
  onSave: (usedIds: string[]) => Promise<void>;
  /** Create a custom field; return its id to append it to the used list, or null on failure */
  onCreateField?: (draft: RecordCustomFieldDraft) => Promise<string | null>;
  /** Update an existing custom field */
  onEditField?: (id: string, draft: RecordCustomFieldDraft) => Promise<void>;
  /** Return an error message to block the panel save, or empty string when valid */
  validateField?: (draft: RecordCustomFieldDraft, editingId?: string) => string;
}) {
  const [used, setUsed] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [search, setSearch] = useState('');
  const [persisting, setPersisting] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  // Stacked panel state: create a new custom field or edit an existing one
  const [panel, setPanel] = useState<
    { mode: 'create' } | { mode: 'edit'; fieldId: string } | null
  >(null);
  const [label, setLabel] = useState('');
  const [type, setType] = useState(Object.keys(fieldTypes)[0] ?? 'text');
  const [options, setOptions] = useState('');
  const [mandatory, setMandatory] = useState(false);
  const [noDuplicates, setNoDuplicates] = useState(false);
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);

  const fieldById = useMemo(
    () => new Map(fields.map((field) => [field.id, field])),
    [fields]
  );

  if (open && !initialized) {
    setUsed(initialUsed.filter((id) => fieldById.has(id)));
    setInitialized(true);
  }
  if (!open && initialized) {
    setInitialized(false);
    setPanel(null);
    setSearch('');
  }

  const unused = useMemo(
    () =>
      fields.filter(
        (field) =>
          !used.includes(field.id) &&
          field.label
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase())
      ),
    [fields, used, search]
  );
  const usedCustomCount = used.filter(
    (id) => fieldById.get(id)?.countsTowardLimit
  ).length;

  function openPanel(
    target: { mode: 'create' } | { mode: 'edit'; fieldId: string }
  ) {
    const editing =
      target.mode === 'edit' ? fieldById.get(target.fieldId)?.draft : null;
    setLabel(editing?.label ?? '');
    setType(editing?.type ?? Object.keys(fieldTypes)[0] ?? 'text');
    setOptions(editing?.options?.join(', ') ?? '');
    setMandatory(editing?.required === true);
    setNoDuplicates(editing?.unique === true);
    setFormError('');
    setPanel(target);
  }

  function moveField(sourceId: string, targetId: string) {
    setUsed((current) => {
      const next = current.filter((id) => id !== sourceId);
      const index = next.indexOf(targetId);
      next.splice(index < 0 ? next.length : index, 0, sourceId);
      return next;
    });
  }

  async function save() {
    setPersisting(true);
    try {
      await onSave(used);
    } finally {
      setPersisting(false);
    }
  }

  async function saveField(addAnother: boolean) {
    const editingId = panel?.mode === 'edit' ? panel.fieldId : undefined;
    const draft: RecordCustomFieldDraft = {
      label: label.trim(),
      type,
      options: options
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      required: mandatory,
      unique: noDuplicates,
    };
    if (!draft.label) {
      setFormError('Enter a field label');
      return;
    }
    const validationError = validateField?.(draft, editingId) ?? '';
    if (validationError) {
      setFormError(validationError);
      return;
    }
    if (!editingId && usedCustomCount >= maxCustom) {
      setFormError(`You can use up to ${maxCustom} custom fields.`);
      return;
    }
    setCreating(true);
    try {
      if (editingId && onEditField) {
        await onEditField(editingId, draft);
        setPanel(null);
      } else if (onCreateField) {
        const createdId = await onCreateField(draft);
        if (createdId)
          setUsed((current) =>
            current.includes(createdId) ? current : [...current, createdId]
          );
        setLabel('');
        setOptions('');
        setMandatory(false);
        setNoDuplicates(false);
        if (!addAnother) setPanel(null);
      }
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Unable to save field'
      );
    } finally {
      setCreating(false);
    }
  }

  const busy = saving || persisting;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="bg-background w-full gap-0 overflow-hidden p-0 data-[side=right]:sm:w-[min(1080px,78vw)] data-[side=right]:sm:max-w-none"
      >
        <div className="relative flex min-h-0 flex-1 flex-col">
          <SheetHeader className="flex-row items-center gap-3 border-b px-8 py-4 text-left">
            <SheetTitle className="text-xl font-semibold tracking-tight">
              {title}
            </SheetTitle>
            {badge ? (
              <span className="bg-primary/10 text-primary rounded-full px-3 py-1 text-sm font-medium">
                {badge}
              </span>
            ) : null}
            <SheetDescription className="sr-only">
              Choose, reorder, and create the fields shown on these records
            </SheetDescription>
          </SheetHeader>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1.4fr_1fr]">
            {/* Used fields */}
            <ScrollArea className="min-h-0 border-r">
              <div className="flex flex-col gap-4 px-8 py-6">
                <h2 className="text-lg font-semibold">{sectionTitle}</h2>
                <ul className="flex flex-col gap-2">
                  {used.map((id) => {
                    const field = fieldById.get(id);
                    if (!field) return null;
                    return (
                      <li
                        key={id}
                        draggable
                        onDragStart={() => setDragId(id)}
                        onDragEnd={() => setDragId(null)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (dragId && dragId !== id) moveField(dragId, id);
                          setDragId(null);
                        }}
                        className={`group flex items-center gap-2 ${dragId === id ? 'opacity-50' : ''}`}
                      >
                        <GripVertical
                          className="text-muted-foreground/60 group-hover:text-muted-foreground size-4 shrink-0 cursor-grab"
                          aria-hidden="true"
                        />
                        <div className="bg-card flex h-11 flex-1 items-center justify-between rounded-lg border px-3">
                          <span className="text-sm font-medium">
                            {field.label}
                            {field.required ? (
                              <span
                                aria-hidden="true"
                                className="text-destructive ml-0.5"
                              >
                                *
                              </span>
                            ) : null}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {field.typeLabel}
                            {field.unique ? '  (Unique)' : ''}
                          </span>
                        </div>
                        {field.removable || field.editable ? (
                          <span className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            {field.editable && onEditField ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground"
                                aria-label={`Edit ${field.label}`}
                                onClick={() =>
                                  openPanel({ mode: 'edit', fieldId: id })
                                }
                              >
                                <Pencil className="size-3.5" />
                              </Button>
                            ) : null}
                            {field.removable ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground"
                                aria-label={`Remove ${field.label}`}
                                onClick={() =>
                                  setUsed((current) =>
                                    current.filter((item) => item !== id)
                                  )
                                }
                              >
                                <span
                                  aria-hidden="true"
                                  className="bg-destructive/15 text-destructive flex size-4 items-center justify-center rounded-full"
                                >
                                  −
                                </span>
                              </Button>
                            ) : null}
                          </span>
                        ) : (
                          <span className="w-16" aria-hidden="true" />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </ScrollArea>

            {/* Unused fields rail */}
            <ScrollArea className="bg-muted/20 min-h-0">
              <div className="flex flex-col gap-4 px-6 py-6">
                {onCreateField ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="border-primary/40 text-primary hover:bg-primary/5 hover:text-primary self-start rounded-full"
                    onClick={() => openPanel({ mode: 'create' })}
                  >
                    <Plus data-icon="inline-start" /> Custom Field
                  </Button>
                ) : null}
                <div className="flex flex-col gap-3">
                  <h3 className="font-semibold">Unused Fields</h3>
                  <div className="relative">
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search"
                      className="h-10 pr-9"
                      aria-label="Search unused fields"
                    />
                    <Search className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2" />
                  </div>
                  <ul className="flex flex-col gap-2">
                    {unused.length === 0 ? (
                      <li className="text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
                        No unused fields
                      </li>
                    ) : (
                      unused.map((field) => (
                        <li key={field.id}>
                          <button
                            type="button"
                            onClick={() =>
                              setUsed((current) => [...current, field.id])
                            }
                            className="bg-card hover:border-primary/40 hover:bg-primary/5 flex h-11 w-full items-center gap-2 rounded-lg border px-3 text-left transition-colors"
                          >
                            <GripVertical
                              className="text-muted-foreground/60 size-4 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="flex-1 truncate text-sm font-medium">
                              {field.label}
                            </span>
                            <span className="text-muted-foreground text-xs">
                              {field.typeLabel}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </div>
            </ScrollArea>
          </div>

          <SheetFooter className="bg-background flex-row items-center justify-between border-t px-8 py-3">
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className="bg-primary size-2 rounded-full"
              />
              Used Custom Fields:{' '}
              <span className="text-foreground font-semibold">
                {usedCustomCount}/{maxCustom}
              </span>
            </p>
            <div className="ml-auto flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-full px-6"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-full px-6"
                onClick={save}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : null}
                Save
              </Button>
            </div>
          </SheetFooter>

          {/* Stacked Create / Edit Custom Field panel */}
          <div
            aria-hidden={!panel}
            className={`bg-background absolute inset-y-0 right-0 z-10 flex w-full flex-col shadow-2xl transition-transform duration-300 ease-out sm:w-[min(560px,90%)] sm:border-l ${panel ? 'translate-x-0' : 'pointer-events-none translate-x-full'}`}
          >
            <div className="flex items-center gap-3 border-b px-8 py-4">
              <h2 className="text-xl font-semibold tracking-tight">
                {panel?.mode === 'edit'
                  ? 'Edit Custom Field'
                  : 'Create Custom Field'}
              </h2>
              {badge ? (
                <span className="bg-primary/10 text-primary rounded-full px-3 py-1 text-sm font-medium">
                  {badge}
                </span>
              ) : null}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-4 px-8 py-6">
              <div className="focus-within:border-primary grid grid-cols-[7rem_1fr] items-center gap-4 rounded-lg border px-4 py-3">
                <label
                  htmlFor="new-field-label"
                  className="text-sm font-medium"
                >
                  Field Label
                </label>
                <Input
                  id="new-field-label"
                  value={label}
                  maxLength={80}
                  onChange={(event) => {
                    setLabel(event.target.value);
                    setFormError('');
                  }}
                  placeholder="Enter Field Label"
                  className="border-0 p-0 shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="grid grid-cols-[7rem_1fr] items-center gap-4 rounded-lg border px-4 py-3">
                <span id="new-field-type-label" className="text-sm font-medium">
                  Field Type
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        aria-labelledby="new-field-type-label"
                        className="flex w-full items-center justify-between text-left text-sm"
                      />
                    }
                  >
                    <span>{fieldTypes[type] ?? type}</span>
                    <ChevronDown className="text-muted-foreground size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {Object.entries(fieldTypes).map(([key, typeLabel]) => (
                      <DropdownMenuItem
                        key={key}
                        onClick={() => {
                          setType(key);
                          setFormError('');
                        }}
                      >
                        <span className="flex-1">{typeLabel}</span>
                        {key === type ? (
                          <Check className="text-primary size-4" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {optionTypes.includes(type) ? (
                <div className="focus-within:border-primary grid grid-cols-[7rem_1fr] items-center gap-4 rounded-lg border px-4 py-3">
                  <label
                    htmlFor="new-field-options"
                    className="text-sm font-medium"
                  >
                    Options
                  </label>
                  <Input
                    id="new-field-options"
                    value={options}
                    onChange={(event) => {
                      setOptions(event.target.value);
                      setFormError('');
                    }}
                    placeholder="Lead, Qualified, Customer"
                    className="border-0 p-0 shadow-none focus-visible:ring-0"
                  />
                </div>
              ) : null}
              {showFieldFlags ? (
                <div className="flex flex-col gap-3 pt-1">
                  <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={mandatory}
                      onChange={(event) => setMandatory(event.target.checked)}
                      className="accent-primary size-4"
                    />
                    Mandatory Field
                  </label>
                  <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={noDuplicates}
                      onChange={(event) =>
                        setNoDuplicates(event.target.checked)
                      }
                      className="accent-primary size-4"
                    />
                    Do not allow duplicate values
                    <span title="Two records cannot share the same value for this field">
                      <Info
                        className="text-muted-foreground size-3.5"
                        aria-hidden="true"
                      />
                    </span>
                  </label>
                </div>
              ) : null}
              {formError ? (
                <p
                  role="alert"
                  className="border-destructive/30 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
                >
                  {formError}
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t px-8 py-3">
              <Button
                type="button"
                variant="outline"
                className="rounded-full px-6"
                onClick={() => {
                  setPanel(null);
                  setFormError('');
                }}
                disabled={creating}
              >
                Cancel
              </Button>
              {panel?.mode !== 'edit' ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-primary/40 text-primary hover:bg-primary/5 hover:text-primary rounded-full px-6"
                  onClick={() => saveField(true)}
                  disabled={creating || !label.trim()}
                >
                  Save &amp; New
                </Button>
              ) : null}
              <Button
                type="button"
                className="rounded-full px-6"
                onClick={() => saveField(false)}
                disabled={creating || !label.trim()}
              >
                {creating ? (
                  <Loader2 data-icon="inline-start" className="animate-spin" />
                ) : null}
                Save
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
