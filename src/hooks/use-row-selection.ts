import { useCallback, useState } from 'react';

// ============================================================
// Shared multi-select state for record lists (ADR-003 D2).
//
// The state transitions live in pure functions below so they can be
// unit-tested in Vitest's node environment (this repo has no DOM
// renderer for hooks). The hook itself is thin useState glue.
// ============================================================

/** Returns a new set with `id` added if absent, removed if present. */
export function toggleId(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/**
 * Select-all toggle over `ids`: if every id is already selected they are all
 * removed, otherwise they are all added. Selections outside `ids` (rows hidden
 * by the current filter) are deliberately preserved.
 */
export function toggleAll(
  set: ReadonlySet<string>,
  ids: string[]
): Set<string> {
  const next = new Set(set);
  const all = ids.length > 0 && ids.every((id) => next.has(id));
  for (const id of ids) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** True only when `ids` is non-empty and every id is selected. */
export function areAllSelected(
  set: ReadonlySet<string>,
  ids: string[]
): boolean {
  return ids.length > 0 && ids.every((id) => set.has(id));
}

/**
 * Multi-select state for a record list. Pass the ids currently visible after
 * filtering; `toggleAllRows` and `allSelected` are scoped to those.
 *
 * Memoize the `ids` array at the call site — it is a dependency of
 * `toggleAllRows`.
 */
export function useRowSelection(ids: string[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback(
    (id: string) => setSelected((current) => toggleId(current, id)),
    []
  );
  const toggleAllRows = useCallback(
    () => setSelected((current) => toggleAll(current, ids)),
    [ids]
  );
  const clear = useCallback(() => setSelected(new Set()), []);

  return {
    selected,
    allSelected: areAllSelected(selected, ids),
    toggle,
    toggleAllRows,
    clear,
  };
}
