'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { createClient } from '@/lib/supabase/client';
import { parseContactCsv } from '@/features/contacts/lib/parse-contact-csv';
import { Tag } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Users,
  Tags,
  Filter,
  Upload,
  FileSpreadsheet,
  Trash2,
  UserMinus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  controlClass,
  EmptyHint,
  FieldLabel,
  InlineLoading,
  Notice,
  OptionCard,
  OptionGrid,
  StepFooter,
  StepHeading,
  TagPill,
  WizardPanel,
} from './wizard-ui';

/**
 * Audience methods.
 *
 * `custom_field` was removed: it filtered `contact_custom_values`,
 * which meant the audience could only be built from fields the user
 * had separately defined in Settings — and the panel silently showed
 * "Failed to load custom fields" for every workspace that had none,
 * which is most of them. Filtering the contact record itself covers
 * the same intent with data that always exists.
 *
 * `external` is retained in the union (stored drafts and the send
 * pipeline still understand it) but is not offered in the UI for now.
 */
export type AudienceType = 'all' | 'tags' | 'field' | 'csv' | 'external';

type FieldOperator = 'is' | 'is_not' | 'contains';

/** Columns on `contacts` that are meaningful to segment on. */
const CONTACT_FIELDS = [
  { value: 'name', labelKey: 'name' },
  { value: 'email', labelKey: 'email' },
  { value: 'phone', labelKey: 'phone' },
  { value: 'company', labelKey: 'company' },
  { value: 'source', labelKey: 'source' },
  { value: 'campaign', labelKey: 'campaign' },
] as const;

type ContactFieldKey = (typeof CONTACT_FIELDS)[number]['value'];

const CONTACT_FIELD_KEYS = new Set<string>(CONTACT_FIELDS.map((f) => f.value));

export interface FieldFilter {
  field: ContactFieldKey | '';
  operator: FieldOperator;
  value: string;
}

export interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  /** Contact-column filter used by `type === 'field'`. */
  fieldFilter?: FieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  /** Original filename, kept so the CSV panel can name what is loaded. */
  csvFileName?: string;
  excludeTagIds?: string[];
  /** External-source audience — plumbing kept, UI currently hidden. */
  externalSourceId?: string;
  externalSourceName?: string;
  externalCount?: number;
  externalParamMap?: Record<string, string>;
}

/** A configured field filter is one with both a column and a value. */
function isFieldFilterComplete(
  filter: FieldFilter | undefined
): filter is FieldFilter & { field: ContactFieldKey } {
  return Boolean(
    filter &&
      filter.field &&
      CONTACT_FIELD_KEYS.has(filter.field) &&
      filter.value.trim().length > 0
  );
}

/**
 * Pure audience-size estimator for query-backed audience types
 * ('all' | 'tags' | 'field'). CSV audiences are resolved synchronously
 * by the caller and never reach this function.
 */
async function estimateAudienceCount(
  audience: AudienceConfig
): Promise<number | null> {
  const supabase = createClient();

  // Base query — produces the superset before exclude is applied.
  let baseIds: Set<string> | null = null; // null means "all contacts"

  if (
    audience.type === 'tags' &&
    audience.tagIds &&
    audience.tagIds.length > 0
  ) {
    const { data } = await supabase
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', audience.tagIds);
    baseIds = new Set((data ?? []).map((r) => r.contact_id));
  } else if (
    audience.type === 'field' &&
    isFieldFilterComplete(audience.fieldFilter)
  ) {
    const { field, operator, value } = audience.fieldFilter;
    let q = supabase.from('contacts').select('id');
    if (operator === 'is') q = q.eq(field, value.trim());
    else if (operator === 'is_not') q = q.neq(field, value.trim());
    else q = q.ilike(field, `%${value.trim()}%`);
    const { data } = await q;
    baseIds = new Set((data ?? []).map((r) => r.id));
  } else if (audience.type !== 'all') {
    // Partially-configured audience — wait for the user to finish.
    return null;
  }

  // Apply exclude tags
  let excludeSet: Set<string> | null = null;
  if (audience.excludeTagIds && audience.excludeTagIds.length > 0) {
    const { data: excludeRows } = await supabase
      .from('contact_tags')
      .select('contact_id')
      .in('tag_id', audience.excludeTagIds);
    excludeSet = new Set((excludeRows ?? []).map((r) => r.contact_id));
  }

  if (baseIds) {
    return [...baseIds].filter((id) => !excludeSet?.has(id)).length;
  }
  // "All" — fetch the total, then subtract exclude set if any.
  const { count } = await supabase
    .from('contacts')
    .select('*', { count: 'exact', head: true });
  const total = count ?? 0;
  return excludeSet ? Math.max(0, total - excludeSet.size) : total;
}

interface Step2Props {
  audience: AudienceConfig;
  onUpdate: (audience: AudienceConfig) => void;
  onNext: () => void;
  onBack: () => void;
}

export function Step2SelectAudience({
  audience,
  onUpdate,
  onNext,
  onBack,
}: Step2Props) {
  const t = useTranslations('Broadcasts.wizard');

  const [tags, setTags] = useState<Tag[]>([]);
  const [loadingTags, setLoadingTags] = useState(true);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [csvParsing, setCsvParsing] = useState(false);
  const [csvSkipped, setCsvSkipped] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const OPERATOR_OPTIONS = useMemo<
    { value: FieldOperator; label: string }[]
  >(
    () => [
      { value: 'is', label: t('selectAudience.operatorIs') },
      { value: 'is_not', label: t('selectAudience.operatorIsNot') },
      { value: 'contains', label: t('selectAudience.operatorContains') },
    ],
    [t]
  );

  const audienceOptions = useMemo(
    () => [
      {
        type: 'all' as const,
        label: t('selectAudience.method.all'),
        description: t('selectAudience.allDescLoading'),
        icon: Users,
      },
      {
        type: 'tags' as const,
        label: t('selectAudience.method.tags'),
        description: t('selectAudience.tagDesc'),
        icon: Tags,
      },
      {
        type: 'field' as const,
        label: t('selectAudience.method.field'),
        description: t('selectAudience.fieldDesc'),
        icon: Filter,
      },
      {
        type: 'csv' as const,
        label: t('selectAudience.method.csv'),
        description: t('selectAudience.csvDesc'),
        icon: Upload,
      },
      // External source is intentionally not offered right now. The
      // connector plumbing (/api/external-sources, resolveExternal-
      // Audience) is untouched, so re-adding the card is the only
      // change needed to bring it back.
    ],
    [t]
  );

  // Tags feed both the "Filter by Tags" method AND the exclude list
  // below, so they always load once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        if (!cancelled) setTags(data ?? []);
      } finally {
        if (!cancelled) setLoadingTags(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Estimated audience size. SWR owns the async count: the serialized
  // audience config is the cache key, so edits re-key the query and
  // stale in-flight responses can never clobber a newer estimate.
  const needsQuery =
    audience.type === 'all' ||
    (audience.type === 'tags' && (audience.tagIds?.length ?? 0) > 0) ||
    (audience.type === 'field' && isFieldFilterComplete(audience.fieldFilter));
  const { data: queriedCount, isLoading: loadingCount } = useSWR(
    needsQuery
      ? ([
          'broadcast-estimated-count',
          JSON.stringify({
            type: audience.type,
            tagIds: audience.tagIds,
            fieldFilter: audience.fieldFilter,
            excludeTagIds: audience.excludeTagIds,
          }),
        ] as const)
      : null,
    () => estimateAudienceCount(audience),
    { keepPreviousData: true }
  );
  const estimatedCount = needsQuery
    ? (queriedCount ?? null)
    : audience.type === 'csv'
      ? (audience.csvContacts?.length ?? null)
      : null;

  function selectType(type: AudienceType) {
    // Wipe shape fields owned by other types so stale config can never
    // leak across selections (a tag-filtered audience that still
    // carried csvContacts used to send to both sets).
    onUpdate({
      ...audience,
      type,
      tagIds: type === 'tags' ? audience.tagIds : undefined,
      fieldFilter: type === 'field' ? audience.fieldFilter : undefined,
      csvContacts: type === 'csv' ? audience.csvContacts : undefined,
      csvFileName: type === 'csv' ? audience.csvFileName : undefined,
    });
    if (type !== 'csv') {
      setCsvError(null);
      setCsvSkipped(0);
    }
  }

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    onUpdate({
      ...audience,
      tagIds: current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId],
    });
  }

  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    onUpdate({
      ...audience,
      excludeTagIds: current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId],
    });
  }

  function updateFieldFilter(patch: Partial<FieldFilter>) {
    const prev: FieldFilter = audience.fieldFilter ?? {
      field: '',
      operator: 'is',
      value: '',
    };
    onUpdate({ ...audience, fieldFilter: { ...prev, ...patch } });
  }

  /* ---------------------------------------------------------------- */
  /* CSV upload                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Reads and parses a picked CSV.
   *
   * The `csv` audience method was previously selectable but rendered
   * no panel at all — there was no file input anywhere in this step,
   * so `csvContacts` stayed undefined, `isValid` stayed false, and
   * Next was permanently disabled. This is that missing panel; it
   * reuses the same tested parser as the contacts import modal so
   * header handling cannot drift between the two entry points.
   */
  async function handleFile(file: File | undefined) {
    if (!file) return;

    setCsvError(null);
    setCsvSkipped(0);

    const looksLikeCsv =
      file.type === 'text/csv' ||
      file.type === 'application/vnd.ms-excel' ||
      file.type === 'text/plain' ||
      file.name.toLowerCase().endsWith('.csv');
    if (!looksLikeCsv) {
      setCsvError(t('selectAudience.errorCsvType'));
      return;
    }

    setCsvParsing(true);
    try {
      const text = await file.text();
      const { rows } = parseContactCsv(text);

      if (rows.length === 0) {
        // parseContactCsv returns an empty set both for "no phone
        // header" and "header but no data rows" — distinguish them so
        // the message names the actual problem.
        const header = text.trim().split(/\r?\n/)[0] ?? '';
        const hasPhoneColumn = header
          .split(',')
          .map((h) => h.trim().toLowerCase().replace(/["']/g, ''))
          .includes('phone');
        setCsvError(
          hasPhoneColumn
            ? t('selectAudience.errorCsvEmpty')
            : t('selectAudience.errorCsvMissingPhone')
        );
        onUpdate({ ...audience, csvContacts: undefined, csvFileName: undefined });
        return;
      }

      // De-duplicate by phone — pasted exports routinely repeat rows,
      // and a duplicate here is a second message to the same person.
      const byPhone = new Map<string, { phone: string; name?: string }>();
      for (const row of rows) {
        if (!byPhone.has(row.phone)) {
          byPhone.set(row.phone, { phone: row.phone, name: row.name });
        }
      }

      setCsvSkipped(rows.length - byPhone.size);
      onUpdate({
        ...audience,
        type: 'csv',
        csvContacts: [...byPhone.values()],
        csvFileName: file.name,
      });
    } catch {
      setCsvError(t('selectAudience.errorCsvParse'));
    } finally {
      setCsvParsing(false);
      // Allow re-picking the same filename after a correction.
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function clearCsv() {
    setCsvError(null);
    setCsvSkipped(0);
    onUpdate({ ...audience, csvContacts: undefined, csvFileName: undefined });
  }

  /* ---------------------------------------------------------------- */

  const isValid =
    audience.type === 'all' ||
    (audience.type === 'tags' && (audience.tagIds?.length ?? 0) > 0) ||
    (audience.type === 'field' && isFieldFilterComplete(audience.fieldFilter)) ||
    (audience.type === 'csv' && (audience.csvContacts?.length ?? 0) > 0);

  const blockingHint = isValid
    ? null
    : audience.type === 'tags'
      ? t('selectAudience.hintPickTag')
      : audience.type === 'field'
        ? t('selectAudience.hintCompleteFilter')
        : audience.type === 'csv'
          ? t('selectAudience.hintUploadCsv')
          : null;

  return (
    <div className="space-y-6">
      <StepHeading
        title={t('selectAudience.title')}
        description={t('selectAudience.subtitle')}
      />

      <OptionGrid label={t('selectAudience.title')}>
        {audienceOptions.map((option) => (
          <OptionCard
            key={option.type}
            icon={option.icon}
            label={option.label}
            description={option.description}
            selected={audience.type === option.type}
            onSelect={() => selectType(option.type)}
          />
        ))}
      </OptionGrid>

      {audience.type === 'tags' && (
        <WizardPanel
          icon={Tags}
          tone="accent"
          title={t('selectAudience.selectTags')}
          description={t('selectAudience.selectTagsDesc')}
        >
          {loadingTags ? (
            <InlineLoading label={t('selectAudience.loadingTags')} />
          ) : tags.length === 0 ? (
            <EmptyHint>{t('selectAudience.noTagsFound')}</EmptyHint>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <TagPill
                  key={tag.id}
                  name={tag.name}
                  color={tag.color}
                  selected={Boolean(audience.tagIds?.includes(tag.id))}
                  onClick={() => toggleTag(tag.id)}
                />
              ))}
            </div>
          )}
        </WizardPanel>
      )}

      {audience.type === 'field' && (
        <WizardPanel
          icon={Filter}
          tone="accent"
          title={t('selectAudience.method.field')}
          description={t('selectAudience.fieldPanelDesc')}
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_150px_minmax(0,1fr)]">
            <div>
              <FieldLabel htmlFor="audience-field">
                {t('selectAudience.field')}
              </FieldLabel>
              <select
                id="audience-field"
                value={audience.fieldFilter?.field ?? ''}
                onChange={(e) =>
                  updateFieldFilter({
                    field: e.target.value as ContactFieldKey | '',
                  })
                }
                className={controlClass}
              >
                <option value="">{t('selectAudience.selectField')}</option>
                {CONTACT_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {t(`selectAudience.fieldMap.${f.labelKey}`)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel htmlFor="audience-operator">
                {t('selectAudience.operator')}
              </FieldLabel>
              <select
                id="audience-operator"
                value={audience.fieldFilter?.operator ?? 'is'}
                onChange={(e) =>
                  updateFieldFilter({
                    operator: e.target.value as FieldOperator,
                  })
                }
                className={controlClass}
              >
                {OPERATOR_OPTIONS.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <FieldLabel htmlFor="audience-value">
                {t('selectAudience.value')}
              </FieldLabel>
              <input
                id="audience-value"
                type="text"
                value={audience.fieldFilter?.value ?? ''}
                onChange={(e) => updateFieldFilter({ value: e.target.value })}
                placeholder={t('selectAudience.valuePlaceholder')}
                className={controlClass}
              />
            </div>
          </div>
        </WizardPanel>
      )}

      {audience.type === 'csv' && (
        <WizardPanel
          icon={Upload}
          tone="accent"
          title={t('selectAudience.uploadCsv')}
          description={t('selectAudience.csvFormatDesc')}
          action={
            audience.csvContacts?.length ? (
              <Button variant="ghost" size="sm" onClick={clearCsv}>
                <Trash2 className="size-4" />
                {t('selectAudience.csvRemove')}
              </Button>
            ) : null
          }
        >
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              id="audience-csv"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />

            {audience.csvContacts?.length ? (
              <div className="border-border bg-muted/40 flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <FileSpreadsheet className="text-primary size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">
                    {audience.csvFileName ?? 'contacts.csv'}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t('selectAudience.csvContactsFound', {
                      count: audience.csvContacts.length,
                    })}
                    {csvSkipped > 0
                      ? ` · ${t('selectAudience.csvDuplicatesSkipped', {
                          count: csvSkipped,
                        })}`
                      : ''}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('selectAudience.csvReplace')}
                </Button>
              </div>
            ) : (
              // Drop target doubles as the click target so the control
              // works with a pointer, a keyboard, and a dragged file.
              <label
                htmlFor="audience-csv"
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void handleFile(e.dataTransfer.files?.[0]);
                }}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors duration-150 ${
                  dragging
                    ? 'border-primary bg-primary/5'
                    : 'border-border bg-muted/30 hover:border-muted-foreground/40'
                }`}
              >
                {csvParsing ? (
                  <InlineLoading label={t('selectAudience.csvParsing')} />
                ) : (
                  <>
                    <Upload className="text-muted-foreground size-5" />
                    <span className="text-foreground text-sm font-medium">
                      {t('selectAudience.csvDropTitle')}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t('selectAudience.csvDropHint')}
                    </span>
                  </>
                )}
              </label>
            )}

            {csvError ? <Notice tone="error">{csvError}</Notice> : null}

            <p className="text-muted-foreground font-mono text-xs">
              phone,name,email,company,tags
            </p>
          </div>
        </WizardPanel>
      )}

      {/* Exclude list — applies regardless of audience type. */}
      <WizardPanel
        icon={UserMinus}
        title={t('selectAudience.excludeTags')}
        description={t('selectAudience.excludeTagsDesc')}
      >
        {loadingTags ? (
          <InlineLoading label={t('selectAudience.loadingTags')} />
        ) : tags.length === 0 ? (
          <EmptyHint>{t('selectAudience.noTagsFound')}</EmptyHint>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <TagPill
                key={tag.id}
                name={tag.name}
                color={tag.color}
                tone="danger"
                selected={Boolean(audience.excludeTagIds?.includes(tag.id))}
                onClick={() => toggleExcludeTag(tag.id)}
              />
            ))}
          </div>
        )}
      </WizardPanel>

      <WizardPanel
        icon={Users}
        tone="accent"
        title={t('selectAudience.summaryTitle')}
        action={
          loadingCount ? (
            <InlineLoading label={t('selectAudience.calculating')} />
          ) : estimatedCount !== null ? (
            <p className="text-foreground text-sm font-medium">
              {t('selectAudience.estimatedRecipients', {
                count: estimatedCount,
              })}
            </p>
          ) : (
            <EmptyHint>{t('selectAudience.summaryEmpty')}</EmptyHint>
          )
        }
      />

      <StepFooter
        backLabel={t('back')}
        onBack={onBack}
        hint={blockingHint}
        nextLabel={t('next')}
        onNext={onNext}
        nextDisabled={!isValid}
      />
    </div>
  );
}
