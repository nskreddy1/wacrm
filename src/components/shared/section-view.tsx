'use client';

// ============================================================
// Generic section-view primitives (Bigin-style), reusable across
// Settings, Contacts, Pipelines … anywhere a module needs:
//
//   <SectionTabs>    — underlined top tab strip (Users | Profiles | …)
//   <FilterChips>    — pill filter strip with counts (Active 1 | Invited)
//   <SectionToolbar> — right-aligned search + primary action row
//   <DataTable>      — column-driven table with header + empty state
//
// All of them are controlled, presentation-only components: state
// (active tab/chip, search text, rows) lives with the caller, so the
// same primitives serve any record type.
// ============================================================

import { useId, type ReactNode } from 'react';
import { Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { sheetTable } from '@/components/shared/sheet-table';
import { cn } from '@/lib/utils';

/* ----------------------------------------------------------------
 * SectionTabs — underlined tab strip across the top of a module.
 * ---------------------------------------------------------------- */
export interface SectionTab {
  id: string;
  label: string;
  /** Optional trailing hint, e.g. a count. */
  badge?: ReactNode;
}

export function SectionTabs({
  tabs,
  active,
  onSelect,
  className,
}: {
  tabs: SectionTab[];
  active: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Section tabs"
      className={cn('flex items-center gap-6 border-b', className)}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-0.5 pt-1 pb-2.5 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            )}
          >
            {tab.label}
            {tab.badge != null ? (
              <span className="text-muted-foreground text-xs">{tab.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------
 * FilterChips — pill strip for status filters, with live counts.
 * ---------------------------------------------------------------- */
export interface FilterChip {
  id: string;
  label: string;
  count?: number;
}

export function FilterChips({
  chips,
  active,
  onSelect,
  className,
}: {
  chips: FilterChip[];
  active: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Filters"
      className={cn(
        'inline-flex items-center gap-1 rounded-full border p-1',
        className
      )}
    >
      {chips.map((chip) => {
        const isActive = chip.id === active;
        return (
          <button
            key={chip.id}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(chip.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary-soft text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {chip.label}
            {chip.count != null ? (
              <span
                className={cn(
                  'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs',
                  isActive
                    ? 'bg-primary/15 text-primary'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {chip.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------
 * SectionToolbar — chips on the left, search + action on the right.
 * ---------------------------------------------------------------- */
export function SectionToolbar({
  left,
  search,
  onSearchChange,
  searchPlaceholder = 'Search',
  action,
  className,
}: {
  left?: ReactNode;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  action?: ReactNode;
  className?: string;
}) {
  const searchId = useId();
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div className="min-w-0">{left}</div>
      <div className="flex shrink-0 items-center gap-2">
        {onSearchChange ? (
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              id={searchId}
              value={search ?? ''}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="w-56 pl-9"
            />
          </div>
        ) : null}
        {action}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------
 * DataTable — column-driven, works for any row type.
 * ---------------------------------------------------------------- */
export interface DataTableColumn<Row> {
  id: string;
  header: ReactNode;
  /** Renders the cell for a row. */
  cell: (row: Row) => ReactNode;
  /** Tailwind width/alignment classes for both th and td. */
  className?: string;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  empty,
  onRowClick,
  className,
}: {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  /** Rendered centered when there are no rows. */
  empty?: ReactNode;
  onRowClick?: (row: Row) => void;
  className?: string;
}) {
  return (
    <div className={cn(sheetTable.frame, className)}>
      <table className={cn(sheetTable.table, 'w-full min-w-[640px]')}>
        <thead className={sheetTable.thead}>
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={cn(sheetTable.th, column.className)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="text-muted-foreground px-4 py-10 text-center"
              >
                {empty ?? 'No records found.'}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  sheetTable.row,
                  onRowClick && sheetTable.rowClickable
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(sheetTable.td, 'py-3', column.className)}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
