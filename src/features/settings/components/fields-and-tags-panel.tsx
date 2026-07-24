'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { useCan } from '@/features/auth/hooks/use-can';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { TagManager } from './tag-manager';
import { EditFieldSheet, type EditFieldTarget } from './edit-field-sheet';
import { EditContactFieldsSheet } from '@/features/contacts/components/edit-contact-fields-sheet';
import {
  DealFieldsEditor,
  DEAL_OPTIONAL_FIELDS,
  DEAL_REQUIRED_FIELDS,
} from '@/features/pipelines/components/deal-fields-editor';
import {
  ModuleFieldsEditor,
  MODULE_FIELD_REGISTRY,
} from './module-fields-editor';
import {
  getDealFieldLayoutAction,
  saveDealFieldLayoutAction,
} from '@/features/pipelines/lib/actions';
import {
  getModuleFieldLayoutAction,
  saveModuleFieldLayoutAction,
} from '@/features/module-fields/lib/actions';
import {
  EMPTY_MODULE_FIELD_LAYOUT,
  type ModuleFieldLayout,
  type ModuleKey,
} from '@/features/module-fields/lib/validation';
import type { DealFieldLayout } from '@/features/pipelines/lib/validation';

const EMPTY_DEAL_FIELD_LAYOUT: DealFieldLayout = { hidden: [], custom: [] };
import { isReservedContactField } from '@/lib/data/contacts/validation';
import type { ContactField, ContactPreferences } from '@/lib/data/contacts/types';

const CUSTOM_FIELD_LIMIT = 10;

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? 'Request failed');
  return payload.data as T;
}

/* ------------------------------------------------------------------ */
/*  Presentational pieces (Bigin reference: bordered field pill rows,  */
/*  red accent = required, "(Unique)" suffix, green dot = custom)      */
/* ------------------------------------------------------------------ */

interface DisplayField {
  id: string;
  label: string;
  required?: boolean;
  unique?: boolean;
  custom?: boolean;
  /** Broad type for the Edit Field sheet (e.g. "Text"). */
  typeLabel?: string;
  /** Specific variant for the Edit Field sheet (e.g. "Single Line"). */
  subTypeLabel?: string;
  /** Whether the label can be renamed in the Edit Field sheet. */
  editable?: boolean;
  canToggleRequired?: boolean;
  canToggleUnique?: boolean;
}

function toEditTarget(field: DisplayField): EditFieldTarget {
  return {
    id: field.id,
    label: field.label,
    typeLabel: field.typeLabel ?? 'Text',
    subTypeLabel: field.subTypeLabel ?? 'Single Line',
    required: field.required === true,
    unique: field.unique === true,
    editable: field.editable === true,
    canToggleRequired: field.canToggleRequired,
    canToggleUnique: field.canToggleUnique,
  };
}

function FieldRow({
  field,
  onEdit,
}: {
  field: DisplayField;
  onEdit?: (field: DisplayField) => void;
}) {
  return (
    <div className="group/field relative flex min-h-10 items-center gap-1.5 overflow-hidden rounded-md border border-border bg-card px-3.5 py-2 text-sm transition-colors hover:border-primary/40">
      {field.required && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-destructive"
        />
      )}
      <span className="truncate text-foreground">{field.label}</span>
      {field.unique && (
        <span className="shrink-0 text-sm text-muted-foreground">(Unique)</span>
      )}
      {field.custom && (
        <span
          aria-hidden
          className="mb-1.5 size-1.5 shrink-0 self-center rounded-full bg-primary"
        />
      )}
      {field.custom && <span className="sr-only">Custom field</span>}
      {onEdit && (
        <button
          type="button"
          onClick={() => onEdit(field)}
          aria-label={`Edit ${field.label}`}
          className="absolute inset-y-0 right-0 hidden items-center bg-card pl-2 pr-3 text-muted-foreground hover:text-primary group-hover/field:flex"
        >
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-3.5"
          >
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </button>
      )}
    </div>
  );
}

function ModuleCard({
  title,
  sections,
  usedCustom,
  loading,
  canEdit,
  onCustomize,
  onEditField,
}: {
  title: string;
  sections: { title: string; fields: DisplayField[] }[];
  usedCustom: number;
  loading?: boolean;
  canEdit: boolean;
  onCustomize: () => void;
  onEditField?: (field: DisplayField) => void;
}) {
  return (
    <article className="flex h-full min-h-[440px] w-96 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="border-b border-border bg-muted/60 px-4 py-3.5">
        <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
      </header>
      <div className="app-scrollbar flex-1 space-y-5 overflow-y-auto px-4 pb-4 pt-4">
        {loading ? (
          <div className="space-y-2.5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          sections
            .filter((section) => section.fields.length > 0)
            .map((section) => (
              <section key={section.title} className="space-y-2.5">
                <h4 className="text-sm font-bold text-foreground">{section.title}</h4>
                <div className="space-y-2.5">
                  {section.fields.map((field) => (
                    <FieldRow
                      key={field.id}
                      field={field}
                      onEdit={canEdit ? onEditField : undefined}
                    />
                  ))}
                </div>
              </section>
            ))
        )}
      </div>
      <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-3.5">
        {canEdit ? (
          <button
            type="button"
            onClick={onCustomize}
            className="text-sm font-semibold text-primary hover:underline"
          >
            Customize Fields
          </button>
        ) : (
          <span className="text-sm text-muted-foreground">View only</span>
        )}
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-muted-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
          Used Custom Fields
          <span className="font-bold text-foreground">
            {'\u00A0'}:{'\u00A0'}
            {usedCustom}/{CUSTOM_FIELD_LIMIT}
          </span>
        </span>
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/*  Module cards (Contacts, Appointments, Catalog)                     */
/* ------------------------------------------------------------------ */

interface ContactWorkspacePayload {
  fields: ContactField[];
  preferences: ContactPreferences;
}

/** Broad + specific type labels for simple custom field types. */
const SIMPLE_TYPE_META: Record<string, { type: string; sub: string }> = {
  text: { type: 'Text', sub: 'Single Line' },
  number: { type: 'Number', sub: 'Number' },
  date: { type: 'Date', sub: 'Date' },
  email: { type: 'Text', sub: 'Email' },
  phone: { type: 'Text', sub: 'Phone' },
  url: { type: 'Text', sub: 'URL' },
  single_select: { type: 'Pick List', sub: 'Single Select' },
  multi_select: { type: 'Pick List', sub: 'Multi Select' },
  checkbox: { type: 'Checkbox', sub: 'Checkbox' },
  currency: { type: 'Number', sub: 'Currency' },
};

function moduleSections(module: ModuleKey, layout: ModuleFieldLayout) {
  const registry = MODULE_FIELD_REGISTRY[module];
  const hidden = new Set(layout.hidden);
  const standard = (f: { id: string; label: string; typeLabel?: string }, required: boolean): DisplayField => ({
    id: f.id,
    label: f.label,
    required,
    typeLabel: 'Text',
    subTypeLabel: f.typeLabel ?? 'Single Line',
    editable: false,
  });
  return [
    {
      title: registry.sectionTitle,
      fields: [
        ...registry.required.map((f) => standard(f, true)),
        ...registry.optional.filter((f) => !hidden.has(f.id)).map((f) => standard(f, false)),
      ],
    },
    {
      title: 'Additional Information',
      fields: layout.custom.map(
        (f): DisplayField => ({
          id: f.id,
          label: f.label,
          custom: true,
          typeLabel: SIMPLE_TYPE_META[f.type]?.type ?? 'Text',
          subTypeLabel: SIMPLE_TYPE_META[f.type]?.sub ?? 'Single Line',
          editable: true,
        }),
      ),
    },
  ];
}

function ModuleFieldsCard({
  module,
  title,
  canEdit,
}: {
  module: ModuleKey;
  title: string;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<DisplayField | null>(null);
  const { data, isLoading, mutate } = useSWR(`module-fields:${module}`, async () => {
    const result = await getModuleFieldLayoutAction(module);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  });

  const layout = data ?? EMPTY_MODULE_FIELD_LAYOUT;

  return (
    <>
      <ModuleCard
        title={title}
        sections={moduleSections(module, layout)}
        usedCustom={layout.custom.length}
        loading={isLoading}
        canEdit={canEdit}
        onCustomize={() => setOpen(true)}
        onEditField={setEditing}
      />
      {editing && (
        <EditFieldSheet
          key={editing.id}
          open
          module={title}
          saving={saving}
          field={toEditTarget(editing)}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          onSave={async ({ label }) => {
            setSaving(true);
            try {
              const next: ModuleFieldLayout = {
                ...layout,
                custom: layout.custom.map((f) =>
                  f.id === editing.id ? { ...f, label } : f,
                ),
              };
              const result = await saveModuleFieldLayoutAction(module, next);
              if (!result.ok) throw new Error(result.error);
              await mutate(result.data, { revalidate: false });
              toast.success('Field updated');
              setEditing(null);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Unable to save field');
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
      {open && (
        <ModuleFieldsEditor
          key={`${module}:${JSON.stringify(layout)}`}
          open={open}
          module={module}
          layout={layout}
          pending={saving}
          onOpenChange={setOpen}
          onSave={async (next) => {
            setSaving(true);
            try {
              const result = await saveModuleFieldLayoutAction(module, next);
              if (!result.ok) throw new Error(result.error);
              await mutate(result.data, { revalidate: false });
              toast.success('Fields updated');
              setOpen(false);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Unable to save fields');
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
    </>
  );
}

function ContactFieldsCard({ canEdit }: { canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DisplayField | null>(null);
  const [saving, setSaving] = useState(false);
  const { data, isLoading, mutate } = useSWR<ContactWorkspacePayload>(
    '/api/v1/workspace/contacts',
    fetchJson,
  );

  const fields = useMemo(() => data?.fields ?? [], [data]);
  const preferences = useMemo<ContactPreferences>(
    () =>
      data?.preferences ?? { visible: [], order: [], widths: {}, frozen: [] as string[] },
    [data],
  );

  const sections = useMemo(() => {
    const visible = new Set(preferences.visible);
    const ordered = [
      ...preferences.order.filter((id) => visible.has(id)),
      ...preferences.visible.filter((id) => !preferences.order.includes(id)),
    ];
    const byId = new Map(fields.map((field) => [field.id, field]));
    const shown = ordered
      .map((id) => byId.get(id))
      .filter((field): field is ContactField => field !== undefined);
    const isCustom = (field: ContactField) =>
      field.custom && !isReservedContactField(field.label);
    const meta = (field: ContactField) => ({
      typeLabel: SIMPLE_TYPE_META[field.type]?.type ?? 'Text',
      subTypeLabel: SIMPLE_TYPE_META[field.type]?.sub ?? 'Single Line',
    });
    return [
      {
        title: 'Contact Information',
        fields: shown
          .filter((field) => !isCustom(field))
          .map(
            (field): DisplayField => ({
              id: field.id,
              label: field.label,
              required: field.required,
              unique: field.unique,
              editable: false,
              ...meta(field),
            }),
          ),
      },
      {
        title: 'Additional Information',
        fields: shown
          .filter((field) => isCustom(field))
          .map(
            (field): DisplayField => ({
              id: field.id,
              label: field.label,
              custom: true,
              required: field.required,
              unique: field.unique,
              editable: true,
              canToggleRequired: true,
              canToggleUnique: true,
              ...meta(field),
            }),
          ),
      },
    ];
  }, [fields, preferences]);

  const usedCustom = useMemo(
    () =>
      fields.filter((field) => field.custom && !isReservedContactField(field.label))
        .length,
    [fields],
  );

  return (
    <>
      <ModuleCard
        title="Contacts"
        sections={sections}
        usedCustom={usedCustom}
        loading={isLoading}
        canEdit={canEdit}
        onCustomize={() => setOpen(true)}
        onEditField={setEditing}
      />
      {editing && (
        <EditFieldSheet
          key={editing.id}
          open
          module="Contacts"
          saving={saving}
          field={toEditTarget(editing)}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          onSave={async ({ label, required, unique }) => {
            setSaving(true);
            try {
              const source = fields.find((f) => f.id === editing.id);
              if (!source) throw new Error('Field not found');
              const response = await fetch('/api/v1/workspace/contacts', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  kind: 'field',
                  id: editing.id,
                  field: {
                    label,
                    type: source.type,
                    options: source.options ?? [],
                    required,
                    unique,
                  },
                }),
              });
              const payload = await response.json();
              if (!response.ok)
                throw new Error(payload.error?.message ?? 'Request failed');
              await mutate();
              toast.success('Field updated');
              setEditing(null);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Unable to save field');
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
      {open && data && (
        <EditContactFieldsSheet
          open={open}
          fields={fields}
          preferences={preferences}
          onOpenChange={setOpen}
          onSaved={() => mutate()}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Pipeline cards (one per pipeline, deal fields)                     */
/* ------------------------------------------------------------------ */

function PipelineFieldsCard({
  pipeline,
  canEdit,
}: {
  pipeline: { id: string; name: string };
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<DisplayField | null>(null);
  const { data, isLoading, mutate } = useSWR(`deal-fields:${pipeline.id}`, async () => {
    const result = await getDealFieldLayoutAction(pipeline.id);
    if (!result.ok) throw new Error(result.error ?? 'Unable to load layout');
    return result.data ?? EMPTY_DEAL_FIELD_LAYOUT;
  });

  const layout: DealFieldLayout = data ?? EMPTY_DEAL_FIELD_LAYOUT;
  const hidden = new Set(layout.hidden);

  const standard = (
    f: { id: string; label: string; typeLabel?: string },
    required: boolean,
  ): DisplayField => ({
    id: f.id,
    label: f.label,
    required,
    typeLabel: 'Text',
    subTypeLabel: f.typeLabel ?? 'Single Line',
    editable: false,
  });

  const sections = [
    {
      title: 'Deal Information',
      fields: [
        ...DEAL_REQUIRED_FIELDS.map((f) => standard(f, true)),
        ...DEAL_OPTIONAL_FIELDS.filter((f) => !hidden.has(f.id)).map((f) =>
          standard(f, false),
        ),
      ],
    },
    {
      title: 'Additional Information',
      fields: layout.custom.map(
        (f): DisplayField => ({
          id: f.id,
          label: f.label,
          custom: true,
          typeLabel: SIMPLE_TYPE_META[f.type]?.type ?? 'Text',
          subTypeLabel: SIMPLE_TYPE_META[f.type]?.sub ?? 'Single Line',
          editable: true,
        }),
      ),
    },
  ];

  return (
    <>
      <ModuleCard
        title={pipeline.name}
        sections={sections}
        usedCustom={layout.custom.length}
        loading={isLoading}
        canEdit={canEdit}
        onCustomize={() => setOpen(true)}
        onEditField={setEditing}
      />
      {editing && (
        <EditFieldSheet
          key={editing.id}
          open
          module={pipeline.name}
          saving={saving}
          field={toEditTarget(editing)}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          onSave={async ({ label }) => {
            setSaving(true);
            try {
              const next: DealFieldLayout = {
                ...layout,
                custom: layout.custom.map((f) =>
                  f.id === editing.id ? { ...f, label } : f,
                ),
              };
              const result = await saveDealFieldLayoutAction(pipeline.id, next);
              if (!result.ok) throw new Error(result.error ?? 'Unable to save field');
              await mutate(result.data ?? next, { revalidate: false });
              toast.success('Field updated');
              setEditing(null);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Unable to save field');
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
      {open && (
        <DealFieldsEditor
          key={`${pipeline.id}:${JSON.stringify(layout)}`}
          open={open}
          pipelineName={pipeline.name}
          layout={layout}
          pending={saving}
          onOpenChange={setOpen}
          onSave={async (next) => {
            setSaving(true);
            try {
              const result = await saveDealFieldLayoutAction(pipeline.id, next);
              if (!result.ok) throw new Error(result.error ?? 'Unable to save layout');
              await mutate(result.data ?? next, { revalidate: false });
              toast.success('Deal fields updated');
              setOpen(false);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Unable to save fields');
            } finally {
              setSaving(false);
            }
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

type PanelTab = 'modules' | 'pipelines' | 'tags';

const TABS: { key: PanelTab; label: string }[] = [
  { key: 'modules', label: 'Module Fields' },
  { key: 'pipelines', label: 'Pipeline Fields' },
  { key: 'tags', label: 'Tags' },
];

/**
 * "Fields & tags" section, redesigned after the Bigin Fields screen:
 * Module Fields and Pipeline Fields tabs render one card per module
 * with grouped field rows and a Customize Fields action that opens the
 * shared RecordFieldsEditor flavour for that module. Tags keep their
 * own tab. All customize surfaces reuse the same generic editor the
 * contact and deal flows already share.
 */
export function FieldsAndTagsPanel() {
  const t = useTranslations('Settings.tagsAndFields');
  const canEditSettings = useCan('edit-settings');
  const [tab, setTab] = useState<PanelTab>('modules');

  const { data: resources, isLoading: pipelinesLoading } = useSWR<{
    pipelines: { id: string; name: string }[];
  }>(tab === 'pipelines' ? '/api/v1/workspace/automation-resources' : null, fetchJson);

  return (
    <section className="animate-in fade-in-50 flex min-h-0 flex-1 flex-col gap-4 duration-200">
      <h2 className="sr-only">{t('title')}</h2>

      <div role="tablist" aria-label={t('title')} className="flex gap-6 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={cn(
              '-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors',
              tab === item.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'modules' && (
        <div className="app-scrollbar flex min-h-0 flex-1 items-stretch gap-4 overflow-x-auto pb-1">
          <ContactFieldsCard canEdit={canEditSettings} />
          <ModuleFieldsCard
            module="appointments"
            title="Appointments"
            canEdit={canEditSettings}
          />
          <ModuleFieldsCard module="catalog" title="Catalog" canEdit={canEditSettings} />
        </div>
      )}

      {tab === 'pipelines' &&
        (pipelinesLoading ? (
          <div className="flex gap-4">
            <Skeleton className="h-64 w-72" />
            <Skeleton className="h-64 w-72" />
          </div>
        ) : (resources?.pipelines?.length ?? 0) === 0 ? (
          <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
            No pipelines yet. Create a pipeline to customize its deal fields.
          </p>
        ) : (
          <div className="app-scrollbar flex min-h-0 flex-1 items-stretch gap-4 overflow-x-auto pb-1">
            {resources?.pipelines?.map((pipeline) => (
              <PipelineFieldsCard
                key={pipeline.id}
                pipeline={pipeline}
                canEdit={canEditSettings}
              />
            ))}
          </div>
        ))}

      {tab === 'tags' && (
        <div className="max-w-3xl">
          <TagManager />
        </div>
      )}
    </section>
  );
}
