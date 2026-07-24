'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { createClient } from '@/lib/supabase/client';
import { CustomField, Tag } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Users,
  Tags,
  Filter,
  Upload,
  Loader2,
  ArrowRight,
  ArrowLeft,
  X,
  Database,
  AlertTriangle,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

type AudienceType = 'all' | 'tags' | 'custom_field' | 'csv' | 'external';
type CustomFieldOperator = 'is' | 'is_not' | 'contains';

interface CustomFieldFilter {
  fieldId: string;
  operator: CustomFieldOperator;
  value: string;
}

interface AudienceConfig {
  type: AudienceType;
  tagIds?: string[];
  customField?: CustomFieldFilter;
  csvContacts?: { phone: string; name?: string }[];
  excludeTagIds?: string[];
  externalSourceId?: string;
  externalSourceName?: string;
  externalCount?: number;
  externalParamMap?: Record<string, string>;
}

/** Shape returned by GET /api/external-sources (no secrets). */
interface ExternalSourceRow {
  id: string;
  name: string;
  type: 'rest' | 'postgres' | 'google_sheet';
  field_map: { phone: string; name?: string; params?: Record<string, string> };
  last_tested_at: string | null;
  last_row_count: number | null;
}

const SOURCE_TYPE_LABELS: Record<ExternalSourceRow['type'], string> = {
  rest: 'REST API',
  postgres: 'Postgres',
  google_sheet: 'Google Sheet',
};

/**
 * Pure audience-size estimator for query-backed audience types
 * ('all' | 'tags' | 'custom_field'). External and CSV audiences are
 * resolved synchronously by the caller and never reach this function.
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
    audience.type === 'custom_field' &&
    audience.customField?.fieldId &&
    audience.customField.value
  ) {
    const { fieldId, operator, value } = audience.customField;
    let q = supabase
      .from('contact_custom_values')
      .select('contact_id')
      .eq('custom_field_id', fieldId);
    if (operator === 'is') q = q.eq('value', value);
    else if (operator === 'is_not') q = q.neq('value', value);
    else q = q.ilike('value', `%${value}%`);
    const { data } = await q;
    baseIds = new Set((data ?? []).map((r) => r.contact_id));
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

  const OPERATOR_OPTIONS = useMemo<
    { value: CustomFieldOperator; label: string }[]
  >(
    () => [
      { value: 'is', label: t('selectAudience.operatorIs') },
      { value: 'is_not', label: t('selectAudience.operatorIsNot') },
      { value: 'contains', label: t('selectAudience.operatorContains') },
    ],
    [t]
  );

  const audienceOptions = useMemo<
    {
      type: AudienceType;
      label: string;
      description: string;
      icon: typeof Users;
    }[]
  >(
    () => [
      {
        type: 'all',
        label: t('selectAudience.method.all'),
        description: t('selectAudience.allDescLoading'),
        icon: Users,
      },
      {
        type: 'tags',
        label: t('selectAudience.method.tags'),
        description: t('selectAudience.tagDesc'),
        icon: Tags,
      },
      {
        type: 'custom_field',
        label: t('selectAudience.method.customField'),
        description: t('selectAudience.customFieldDesc'),
        icon: Filter,
      },
      {
        type: 'csv',
        label: t('selectAudience.method.csv'),
        description: t('selectAudience.csvDesc'),
        icon: Upload,
      },
      {
        type: 'external',
        label: t('selectAudience.method.external'),
        description: t('selectAudience.externalDesc'),
        icon: Database,
      },
    ],
    [t]
  );
  const [tags, setTags] = useState<Tag[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingTags, setLoadingTags] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);
  const [sources, setSources] = useState<ExternalSourceRow[] | null>(null);
  const [loadingSources, setLoadingSources] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewCapped, setPreviewCapped] = useState(false);
  const [previewInvalid, setPreviewInvalid] = useState(0);

  // Tags are used both by the primary "Filter by Tags" audience type
  // AND by the exclude-list below — so always load once on mount.
  useEffect(() => {
    async function fetchTags() {
      setLoadingTags(true);
      try {
        const supabase = createClient();
        const { data } = await supabase.from('tags').select('*').order('name');
        setTags(data ?? []);
      } finally {
        setLoadingTags(false);
      }
    }
    fetchTags();
  }, []);

  // Lazy-load custom fields only when that audience type is active.
  useEffect(() => {
    if (audience.type !== 'custom_field') return;
    async function fetchFields() {
      setLoadingFields(true);
      try {
        const supabase = createClient();
        const { data } = await supabase
          .from('custom_fields')
          .select('*')
          .order('field_name');
        setCustomFields(data ?? []);
      } finally {
        setLoadingFields(false);
      }
    }
    fetchFields();
  }, [audience.type]);

  // Lazy-load external sources only when that audience type is active.
  useEffect(() => {
    if (audience.type !== 'external' || sources !== null) return;
    let cancelled = false;
    (async () => {
      setLoadingSources(true);
      try {
        const res = await fetch('/api/external-sources');
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          setSources(
            res.ok ? ((data.sources ?? []) as ExternalSourceRow[]) : []
          );
        }
      } catch {
        if (!cancelled) setSources([]);
      } finally {
        if (!cancelled) setLoadingSources(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audience.type, sources]);

  /**
   * Runs the source's fetcher server-side and stores the resulting
   * count on the audience config so step 4 (and the summary card)
   * can show the estimate without refetching.
   */
  const runSourcePreview = useCallback(
    async (sourceId: string, next: AudienceConfig) => {
      setPreviewing(true);
      setPreviewError(null);
      setPreviewCapped(false);
      setPreviewInvalid(0);
      try {
        const res = await fetch(`/api/external-sources/${sourceId}/preview`, {
          method: 'POST',
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setPreviewError(
            (data.error as string) || t('selectAudience.errorSourcePreview')
          );
          onUpdate({ ...next, externalCount: undefined });
          return;
        }
        setPreviewCapped(Boolean(data.capped));
        setPreviewInvalid(Number(data.invalid) || 0);
        onUpdate({ ...next, externalCount: Number(data.count) || 0 });
      } catch {
        setPreviewError(t('selectAudience.errorSourcePreview'));
        onUpdate({ ...next, externalCount: undefined });
      } finally {
        setPreviewing(false);
      }
    },
    [onUpdate, t]
  );

  function selectExternalSource(sourceId: string) {
    const source = sources?.find((s) => s.id === sourceId);
    if (!source) return;
    const next: AudienceConfig = {
      ...audience,
      externalSourceId: source.id,
      externalSourceName: source.name,
      externalParamMap: source.field_map?.params,
      externalCount: undefined,
    };
    onUpdate(next);
    void runSourcePreview(source.id, next);
  }

  // Estimated audience size. SWR owns the async count: the serialized
  // audience config is the cache key, so edits re-key the query and
  // stale in-flight responses can never clobber a newer estimate.
  // External/CSV/partial audiences resolve synchronously (key = null).
  const syncCount =
    audience.type === 'external'
      ? (audience.externalCount ?? null)
      : audience.type === 'csv'
        ? (audience.csvContacts?.length ?? null)
        : null;
  const needsQuery =
    audience.type === 'all' ||
    (audience.type === 'tags' && (audience.tagIds?.length ?? 0) > 0) ||
    (audience.type === 'custom_field' &&
      Boolean(audience.customField?.fieldId && audience.customField.value));
  const { data: queriedCount, isLoading: loadingCount } = useSWR(
    needsQuery
      ? ([
          'broadcast-estimated-count',
          JSON.stringify({
            type: audience.type,
            tagIds: audience.tagIds,
            customField: audience.customField,
            excludeTagIds: audience.excludeTagIds,
          }),
        ] as const)
      : null,
    () => estimateAudienceCount(audience),
    { keepPreviousData: true }
  );
  const estimatedCount = needsQuery ? (queriedCount ?? null) : syncCount;

  function toggleTag(tagId: string) {
    const current = audience.tagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, tagIds: updated });
  }

  function toggleExcludeTag(tagId: string) {
    const current = audience.excludeTagIds ?? [];
    const updated = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    onUpdate({ ...audience, excludeTagIds: updated });
  }

  function updateCustomField(patch: Partial<CustomFieldFilter>) {
    const prev = audience.customField ?? {
      fieldId: '',
      operator: 'is' as CustomFieldOperator,
      value: '',
    };
    onUpdate({ ...audience, customField: { ...prev, ...patch } });
  }

  const isValid =
    audience.type === 'all' ||
    (audience.type === 'tags' &&
      audience.tagIds &&
      audience.tagIds.length > 0) ||
    (audience.type === 'custom_field' &&
      !!audience.customField?.fieldId &&
      audience.customField.value.length > 0) ||
    (audience.type === 'csv' &&
      audience.csvContacts &&
      audience.csvContacts.length > 0) ||
    (audience.type === 'external' &&
      !!audience.externalSourceId &&
      (audience.externalCount ?? 0) > 0 &&
      !previewCapped &&
      !previewError &&
      !previewing);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t('selectAudience.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('selectAudience.subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {audienceOptions.map(
          (option: {
            type: AudienceType;
            label: string;
            description: string;
            icon: typeof Users;
          }) => {
            const isSelected = audience.type === option.type;
            const Icon = option.icon;
            return (
              <button
                key={option.type}
                onClick={() =>
                  onUpdate({
                    ...audience,
                    type: option.type,
                    // Wipe shape fields from other types to avoid stale
                    // config leaking across selections.
                    tagIds:
                      option.type === 'tags' ? audience.tagIds : undefined,
                    customField:
                      option.type === 'custom_field'
                        ? audience.customField
                        : undefined,
                    csvContacts:
                      option.type === 'csv' ? audience.csvContacts : undefined,
                    externalSourceId:
                      option.type === 'external'
                        ? audience.externalSourceId
                        : undefined,
                    externalSourceName:
                      option.type === 'external'
                        ? audience.externalSourceName
                        : undefined,
                    externalCount:
                      option.type === 'external'
                        ? audience.externalCount
                        : undefined,
                    externalParamMap:
                      option.type === 'external'
                        ? audience.externalParamMap
                        : undefined,
                  })
                }
                className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${
                  isSelected
                    ? 'border-primary bg-primary/5 ring-primary/30 ring-1'
                    : 'border-border bg-card/50 hover:border-border'
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    isSelected
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-foreground text-sm font-medium">
                    {option.label}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {option.description}
                  </p>
                </div>
              </button>
            );
          }
        )}
      </div>

      {audience.type === 'tags' && (
        <div className="border-border bg-card/50 rounded-xl border p-4">
          <p className="text-foreground mb-3 text-sm font-medium">
            {t('selectAudience.selectTags')}
          </p>
          {loadingTags ? (
            <Loader2 className="text-primary h-5 w-5 animate-spin" />
          ) : tags.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.noTagsFound')}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => {
                const isSelected = audience.tagIds?.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : 'border-border bg-muted text-muted-foreground hover:border-border'
                    }`}
                  >
                    <span
                      className="mr-1.5 h-2 w-2 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {audience.type === 'custom_field' && (
        <div className="border-border bg-card/50 space-y-3 rounded-xl border p-4">
          <p className="text-foreground text-sm font-medium">
            {t('selectAudience.method.customField')}
          </p>
          {loadingFields ? (
            <Loader2 className="text-primary h-5 w-5 animate-spin" />
          ) : customFields.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.errorLoadFields')}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_minmax(0,1fr)]">
              <select
                value={audience.customField?.fieldId ?? ''}
                onChange={(e) => updateCustomField({ fieldId: e.target.value })}
                className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
              >
                <option value="">{t('selectAudience.selectField')}</option>
                {customFields.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.field_name}
                  </option>
                ))}
              </select>
              <select
                value={audience.customField?.operator ?? 'is'}
                onChange={(e) =>
                  updateCustomField({
                    operator: e.target.value as CustomFieldOperator,
                  })
                }
                className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
              >
                {OPERATOR_OPTIONS.map(
                  (op: { value: CustomFieldOperator; label: string }) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  )
                )}
              </select>
              <input
                type="text"
                value={audience.customField?.value ?? ''}
                onChange={(e) => updateCustomField({ value: e.target.value })}
                placeholder={t('selectAudience.valuePlaceholder')}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-primary h-9 rounded-lg border px-2.5 text-sm outline-none focus:ring-1"
              />
            </div>
          )}
        </div>
      )}

      {audience.type === 'external' && (
        <div className="border-border bg-card/50 space-y-3 rounded-xl border p-4">
          <p className="text-foreground text-sm font-medium">
            {t('selectAudience.selectSource')}
          </p>
          {loadingSources ? (
            <Loader2 className="text-primary h-5 w-5 animate-spin" />
          ) : !sources || sources.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('selectAudience.noSourcesFound')}
            </p>
          ) : (
            <>
              <select
                value={audience.externalSourceId ?? ''}
                onChange={(e) => selectExternalSource(e.target.value)}
                disabled={previewing}
                className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1 sm:max-w-md"
              >
                <option value="">
                  {t('selectAudience.selectSourcePlaceholder')}
                </option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({SOURCE_TYPE_LABELS[s.type]})
                  </option>
                ))}
              </select>

              {previewing && (
                <div className="flex items-center gap-2">
                  <Loader2 className="text-primary h-4 w-4 animate-spin" />
                  <span className="text-muted-foreground text-xs">
                    {t('selectAudience.sourceTesting')}
                  </span>
                </div>
              )}

              {!previewing && previewError && (
                <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                  <p className="text-xs leading-5 text-red-300">
                    {previewError}
                  </p>
                </div>
              )}

              {!previewing && !previewError && previewCapped && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <p className="text-xs leading-5 text-amber-300">
                    {t('selectAudience.sourceCapped')}
                  </p>
                </div>
              )}

              {!previewing &&
                !previewError &&
                !previewCapped &&
                audience.externalSourceId &&
                audience.externalCount !== undefined && (
                  <p className="text-muted-foreground text-xs">
                    {t('selectAudience.sourcePreviewCount', {
                      count: audience.externalCount,
                    })}
                    {previewInvalid > 0 && (
                      <span className="text-amber-300">
                        {' '}
                        {t('selectAudience.sourceInvalidRows', {
                          count: previewInvalid,
                        })}
                      </span>
                    )}
                  </p>
                )}
            </>
          )}
        </div>
      )}

      {/* Exclude list — applies regardless of audience type */}
      <div className="border-border bg-card/50 rounded-xl border p-4">
        <div className="mb-3 flex items-center gap-2">
          <X className="h-4 w-4 text-red-400" />
          <p className="text-foreground text-sm font-medium">
            {t('selectAudience.excludeTags')}
          </p>
        </div>
        {tags.length === 0 ? (
          <p className="text-muted-foreground text-xs">
            {t('selectAudience.noTagsFound')}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => {
              const isExcluded = audience.excludeTagIds?.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => toggleExcludeTag(tag.id)}
                  className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-all ${
                    isExcluded
                      ? 'border-red-500/30 bg-red-500/10 text-red-300'
                      : 'border-border bg-muted text-muted-foreground hover:border-border'
                  }`}
                >
                  <span
                    className="mr-1.5 h-2 w-2 rounded-full"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Audience Summary */}
      <div className="border-border bg-card/50 rounded-xl border p-4">
        <p className="text-foreground mb-2 text-sm font-medium">
          Audience Summary
        </p>
        {loadingCount ? (
          <div className="flex items-center gap-2">
            <Loader2 className="text-primary h-4 w-4 animate-spin" />
            <span className="text-muted-foreground text-xs">Calculating…</span>
          </div>
        ) : estimatedCount !== null ? (
          <div className="flex items-center gap-2">
            <Users className="text-primary h-4 w-4" />
            <span className="text-foreground text-sm">
              {estimatedCount.toLocaleString()}
            </span>
            <span className="text-muted-foreground text-xs">
              estimated recipients
            </span>
          </div>
        ) : (
          <p className="text-muted-foreground text-xs">
            Select an audience type to see the estimate.
          </p>
        )}
      </div>

      <div className="border-border flex items-center justify-between border-t pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={!isValid}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
