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

import { cn } from "@/lib/utils"

export const sheetTable = {
  /** Scroll container that owns the rounded frame. */
  frame: "overflow-auto rounded-lg border bg-card",
  /** <table> — separate borders so 1px lines never double up. */
  table: "min-w-full border-separate border-spacing-0 text-sm",
  /** <thead> — sticky, opaque, above the rows. */
  thead: "sticky top-0 z-10 bg-card",
  /** Header cell (append alignment/width utilities per column). */
  th: "border-b border-r px-3 py-2 text-left font-medium last:border-r-0",
  /** Body cell. */
  td: "border-b border-r px-3 py-2 align-middle last:border-r-0",
  /** Body cell that hosts its own interactive content (p-0). */
  tdFlush: "border-b border-r p-0 align-middle last:border-r-0",
  /** <tr> row treatment. */
  row: "group transition-colors hover:bg-muted/40",
  rowSelected: "bg-muted/60",
  rowClickable: "cursor-pointer",
} as const

/** Convenience for composing a th/td class with per-column extras. */
export function sheetCell(base: string, extra?: string) {
  return cn(base, extra)
}
