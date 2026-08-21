'use client';

/**
 * Hand-picked audience — the "just these people" case.
 *
 * The audience step could previously only describe a *rule* (everyone,
 * a tag, a field match) or bypass the CRM entirely with a CSV. Sending
 * to three named contacts meant inventing a throwaway tag on each of
 * them or exporting a spreadsheet of numbers you already had rows for,
 * which is why this picker exists.
 *
 * Selection is stored as contact ids plus a tiny display snapshot, so
 * the chips keep naming who is in the audience after the search box has
 * moved on to a different query, and the review step never has to
 * refetch to say "3 contacts".
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { Search, UserCheck, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  CheckRow,
  EmptyHint,
  InlineLoading,
  RemovableChip,
  WizardPanel,
  controlClass,
} from './wizard-ui';

/** Display snapshot of a picked contact, persisted with the draft. */
export interface PickedContact {
  id: string;
  name?: string | null;
  phone: string;
}

interface SearchRow extends PickedContact {
  email?: string | null;
  company?: string | null;
  whatsapp_opted_out?: boolean | null;
}

/** How many matches one search shows. Deliberately small: the picker is
 *  for a handful of people — larger audiences belong to tags or fields. */
const RESULT_LIMIT = 40;

/**
 * PostgREST's `or=(...)` filter is a comma/parenthesis-delimited
 * grammar, so those characters in a search term would change the shape
 * of the query rather than be matched literally. `%` and `_` are ilike
 * wildcards. Strip all of them instead of trying to escape them.
 */
function sanitizeTerm(term: string): string {
  return term.replace(/[,()%_*\\"']/g, ' ').trim();
}

async function searchContacts(term: string): Promise<SearchRow[]> {
  const supabase = createClient();
  let query = supabase
    .from('contacts')
    .select('id, name, phone, email, company, whatsapp_opted_out')
    .order('name', { ascending: true, nullsFirst: false })
    .limit(RESULT_LIMIT);

  const safe = sanitizeTerm(term);
  if (safe) {
    query = query.or(
      [
        `name.ilike.%${safe}%`,
        `phone.ilike.%${safe}%`,
        `email.ilike.%${safe}%`,
        `company.ilike.%${safe}%`,
      ].join(',')
    );
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as SearchRow[];
}

interface Props {
  selected: PickedContact[];
  onChange: (contacts: PickedContact[]) => void;
}

export function AudienceContactPicker({ selected, onChange }: Props) {
  const t = useTranslations('Broadcasts.wizard.selectAudience');

  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce so typing "ada" is one query, not three.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(id);
  }, [term]);

  const {
    data: results,
    isLoading,
    error,
  } = useSWR(['broadcast-audience-contacts', debounced] as const, ([, q]) =>
    searchContacts(q)
  );

  const selectedIds = useMemo(
    () => new Set(selected.map((c) => c.id)),
    [selected]
  );

  function toggle(row: SearchRow) {
    onChange(
      selectedIds.has(row.id)
        ? selected.filter((c) => c.id !== row.id)
        : [...selected, { id: row.id, name: row.name, phone: row.phone }]
    );
  }

  const rows = results ?? [];
  const unselectedRows = rows.filter((r) => !selectedIds.has(r.id));

  function addAllResults() {
    onChange([
      ...selected,
      ...unselectedRows.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
      })),
    ]);
  }

  return (
    <WizardPanel
      icon={UserCheck}
      tone="accent"
      title={t('pickContacts')}
      description={t('pickContactsDesc')}
      action={
        selected.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            <X className="size-4" />
            {t('clearSelection')}
          </Button>
        ) : null
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <input
            ref={inputRef}
            id="audience-contact-search"
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t('searchContacts')}
            aria-label={t('searchContacts')}
            aria-describedby="audience-contact-results-status"
            className={`${controlClass} pl-8`}
          />
        </div>

        {/* Chips first: what is already in the audience outranks what
            you might add next, and they stay put while the result list
            below churns with each query. */}
        {selected.length > 0 ? (
          <div className="border-border bg-muted/30 space-y-2 rounded-lg border p-2.5">
            <p className="text-muted-foreground text-xs font-medium">
              {t('selectedContacts', { count: selected.length })}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {selected.map((contact) => {
                const label = contact.name?.trim() || contact.phone;
                return (
                  <RemovableChip
                    key={contact.id}
                    label={label}
                    detail={contact.name?.trim() ? contact.phone : undefined}
                    removeLabel={t('removeContact', { name: label })}
                    onRemove={() =>
                      onChange(selected.filter((c) => c.id !== contact.id))
                    }
                  />
                );
              })}
            </div>
          </div>
        ) : null}

        {/* One polite live region for the whole result set — a per-row
            announcement on every keystroke would be unusable. */}
        <p
          id="audience-contact-results-status"
          role="status"
          aria-live="polite"
          className="sr-only"
        >
          {isLoading
            ? t('loadingContacts')
            : t('resultsCount', { count: rows.length })}
        </p>

        <div className="max-h-72 overflow-y-auto">
          {isLoading ? (
            <InlineLoading label={t('loadingContacts')} />
          ) : error ? (
            <EmptyHint>{t('errorLoadContacts')}</EmptyHint>
          ) : rows.length === 0 ? (
            <EmptyHint>
              {debounced ? t('noContactsMatch') : t('noContactsYet')}
            </EmptyHint>
          ) : (
            <div className="space-y-0.5">
              {rows.map((row) => {
                const optedOut = Boolean(row.whatsapp_opted_out);
                return (
                  <CheckRow
                    key={row.id}
                    checked={selectedIds.has(row.id)}
                    onToggle={() => toggle(row)}
                    title={row.name?.trim() || row.phone}
                    subtitle={
                      [row.name?.trim() ? row.phone : null, row.company]
                        .filter(Boolean)
                        .join(' · ') || undefined
                    }
                    badge={
                      optedOut ? (
                        <span className="text-muted-foreground border-border rounded-full border px-2 py-0.5 text-[10px] font-medium">
                          {t('optedOut')}
                        </span>
                      ) : null
                    }
                  />
                );
              })}
            </div>
          )}
        </div>

        {unselectedRows.length > 0 ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              {rows.length === RESULT_LIMIT
                ? t('resultsCapped', { count: RESULT_LIMIT })
                : t('resultsCount', { count: rows.length })}
            </p>
            <Button variant="outline" size="sm" onClick={addAllResults}>
              {t('addAllResults', { count: unselectedRows.length })}
            </Button>
          </div>
        ) : null}
      </div>
    </WizardPanel>
  );
}
