// ============================================================
// Shared sheet-table design system (Bigin-style spreadsheet look).
//
// Extracted from the Contacts sheet view so every module renders
// tables with identical DNA:
//
//   • border-separate + border-spacing-0 (crisp 1px grid lines,
//     no double borders)
//   • sticky bg-card header that stays put while rows scroll
//   • border-b + border-r cell borders (last column open-ended)
//   • identical row hover + selected tints
//
// Two consumption modes:
//
//   1. Class constants (`sheetTable.*`) — for advanced tables that
//      need bespoke markup (Contacts: inline editing, col resize,
//      selection). They keep their logic and import only the look.
//   2. <DataTable> in section-view.tsx — column-driven tables
//      (Settings Users/Profiles/Roles) build on these same
//      constants, so both directions stay in sync by construction.
// ============================================================

import { cn } from '@/lib/utils';

export const sheetTable = {
  /** Scroll container that owns the rounded frame. */
  frame: 'overflow-auto rounded-lg border bg-card',
  /** <table> — separate borders so 1px lines never double up. */
  table: 'min-w-full border-separate border-spacing-0 text-sm',
  /** <thead> — sticky, opaque, above the rows. */
  thead: 'sticky top-0 z-10 bg-card',
  /** Header cell (append alignment/width utilities per column). */
  th: 'border-b border-r px-3 py-2 text-left font-medium last:border-r-0',
  /** Body cell. */
  td: 'border-b border-r px-3 py-2 align-middle last:border-r-0',
  /** Body cell that hosts its own interactive content (p-0). */
  tdFlush: 'border-b border-r p-0 align-middle last:border-r-0',
  /**
   * Flexible slack column, rendered immediately before the trailing
   * actions column.
   *
   * `table` is `min-w-full` with the default `table-layout: auto`, where a
   * cell's `width` is only a hint: on a wide viewport the browser hands all
   * surplus width to the cells, and the narrow trailing actions column took
   * the largest share — the stretched empty bordered header cell on the
   * right. A `w-full` cell outranks every hint, so the slack collects here
   * instead and the real columns keep the widths they asked for.
   *
   * Borderless and `aria-hidden`: it is layout, not data.
   */
  spacer: 'w-full border-b p-0',

  /**
   * Leading gutter cell — the spreadsheet row number that becomes the
   * selection checkbox.
   *
   * Previously this column rendered a bare checkbox, which read as an
   * unexplained empty cell before the first real column whenever nothing
   * was selected. Carrying the row number gives that space a job at rest
   * and matches Bigin / Airtable / Notion behaviour.
   */
  gutter: 'border-b border-r px-2 py-2 align-middle',
  /** Stacks number and checkbox in one spot so the swap never shifts layout. */
  gutterStack: 'relative flex h-5 items-center justify-center',
  gutterNumber:
    'text-muted-foreground text-xs tabular-nums transition-opacity group-hover/row:opacity-0 group-focus-within/row:opacity-0 group-data-[selected=true]/row:opacity-0',
  gutterCheckbox:
    'absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-[selected=true]/row:opacity-100',

  /**
   * <tr> row treatment. Carries both the bare `group` (for existing
   * consumers) and the named `group/row` the gutter variants target, so
   * nested groups inside a row can't hijack the number/checkbox swap.
   */
  row: 'group group/row transition-colors hover:bg-muted/40',
  rowSelected: 'bg-muted/60',
  rowClickable: 'cursor-pointer',
} as const;

/** Convenience for composing a th/td class with per-column extras. */
export function sheetCell(base: string, extra?: string) {
  return cn(base, extra);
}
