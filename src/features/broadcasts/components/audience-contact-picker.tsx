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
 *
 * Scale: the result list is capped so a big database never renders a
 * thousand rows, but the picker still has to tell the truth about how
 * many contacts match ("Showing 40 of 128") and let the user take the
 * whole set in one action without scrolling a wall of rows. The
 * selection itself is also height-capped and scrolls, so choosing 100
 * people no longer buries the search box under 100 chips.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';
import { Loader2, Search, UserCheck, Users, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import {
  CheckRow,
  EmptyHint,
  InlineLoading,
  Notice,
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

interface SearchResult {
  rows: SearchRow[];
  /** Total contacts matching the term, before the display limit. */
  total: number;
}

/** How many matches the scrollable list renders. Deliberately small:
 *  the list is for eyeballing and refining, not for scrolling hundreds
 *  of rows — "Select all" handles the bulk case. */
const RESULT_LIMIT = 40;

/** Ceiling on a single "Select all" action. Past this the hand-picker
 *  is the wrong tool and the user is nudged toward tags / field. */
const SELECT_ALL_CAP = 500;

/**
 * PostgREST's `or=(...)` filter is a comma/parenthesis-delimited
 * grammar, so those characters in a search term would change the shape
 * of the query rather than be matched literally. `%` and `_` are ilike
 * wildcards. Strip all of them instead of trying to escape them.
 */
function sanitizeTerm(term: string): string {
  return term.replace(/[,()%_*\\"']/g, ' ').trim();
}

/** Applies the free-text term to a contacts query, if any. */
function withTermFilter<T>(query: T, term: string): T {
  const safe = sanitizeTerm(term);
  if (!safe) return query;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (query as any).or(
    [
      `name.ilike.%${safe}%`,
      `phone.ilike.%${safe}%`,
      `email.ilike.%${safe}%`,
      `company.ilike.%${safe}%`,
    ].join(',')
  );
}

/**
 * One round trip returns both the visible page and the true match
 * count: PostgREST reports the unpaginated total via `count: 'exact'`
 * even when the rows are `.limit()`-ed. That count is what lets the UI
 * say "40 of 128" and offer to select every one of them.
 */
async function searchContacts(term: string): Promise<SearchResult> {
  const supabase = createClient();
  const query = withTermFilter(
    supabase
      .from('contacts')
      .select('id, name, phone, email, company, whatsapp_opted_out', {
        count: 'exact',
      })
      .order('name', { ascending: true, nullsFirst: false })
      .limit(RESULT_LIMIT),
    term
  );

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SearchRow[];
  return { rows, total: count ?? rows.length };
}

/** Fetches every matching contact (up to the cap) for "Select all". */
async function fetchMatchingContacts(
  term: string,
  cap: number
): Promise<PickedContact[]> {
  const supabase = createClient();
  const query = withTermFilter(
    supabase
      .from('contacts')
      .select('id, name, phone')
      .order('name', { ascending: true, nullsFirst: false })
      .limit(cap),
    term
  );

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string | null,
    phone: r.phone as string,
  }));
}

interface Props {
  selected: PickedContact[];
  onChange: (contacts: PickedContact[]) => void;
}

export function AudienceContactPicker({ selected, onChange }: Props) {
  const t = useTranslations('Broadcasts.wizard.selectAudience');

  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selectingAll, setSelectingAll] = useState(false);
  const [selectAllError, setSelectAllError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounce so typing "ada" is one query, not three.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(id);
  }, [term]);

  const {
    data,
    isLoading,
    error,
  } = useSWR(['broadcast-audience-contacts', debounced] as const, ([, q]) =>
    searchContacts(q)
  );

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

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

  const unselectedRows = rows.filter((r) => !selectedIds.has(r.id));

  // How many matches are still outside the selection. This is the real
  // "Select all" target — the visible rows are just a window onto it.
  const matchesToAdd = Math.min(total, SELECT_ALL_CAP);
  const overCap = total > SELECT_ALL_CAP;

  async function selectAllMatching() {
    setSelectAllError(false);
    setSelectingAll(true);
    try {
      const all = await fetchMatchingContacts(debounced, SELECT_ALL_CAP);
      // Merge instead of replace: a previous search's picks survive a
      // second "Select all" on a different term.
      const merged = new Map(selected.map((c) => [c.id, c]));
      for (const c of all) if (!merged.has(c.id)) merged.set(c.id, c);
      onChange([...merged.values()]);
    } catch {
      setSelectAllError(true);
    } finally {
      setSelectingAll(false);
    }
  }

  const showSelectAll = total > 0 && (unselectedRows.length > 0 || overCap);

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
            below churns with each query. The list is height-capped and
            scrolls so a 100-contact selection stays a tidy block
            instead of a wall that shoves the search box off screen. */}
        {selected.length > 0 ? (
          <div className="border-border bg-muted/30 space-y-2 rounded-lg border p-2.5">
            <p className="text-muted-foreground text-xs font-medium">
              {t('selectedContacts', { count: selected.length })}
            </p>
            <div
              className={
                selected.length > 24
                  ? 'flex max-h-40 flex-wrap gap-1.5 overflow-y-auto pr-1 [scrollbar-width:thin]'
                  : 'flex flex-wrap gap-1.5'
              }
            >
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
            {selected.length > 24 ? (
              <p className="text-muted-foreground/70 text-[11px]">
                {t('selectionScrollHint')}
              </p>
            ) : null}
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
            : t('resultsCount', { count: total })}
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

        {rows.length > 0 ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs tabular-nums">
              {total > rows.length
                ? t('matchSummary', { shown: rows.length, total })
                : t('resultsCount', { count: total })}
            </p>
            {showSelectAll ? (
              <Button
                variant="outline"
                size="sm"
                onClick={selectAllMatching}
                disabled={selectingAll}
              >
                {selectingAll ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    {t('selectingAll')}
                  </>
                ) : (
                  <>
                    <Users className="size-3.5" />
                    {t('selectAllMatching', { count: matchesToAdd })}
                  </>
                )}
              </Button>
            ) : null}
          </div>
        ) : null}

        {overCap ? (
          <p className="text-muted-foreground/80 text-[11px] leading-relaxed">
            {t('selectAllCappedHint', { count: SELECT_ALL_CAP })}
          </p>
        ) : null}

        {selectAllError ? (
          <Notice tone="error">{t('errorLoadContacts')}</Notice>
        ) : null}
      </div>
    </WizardPanel>
  );
}
