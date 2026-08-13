# ADR-003 Implementation Plan — Record UX Primitive, Catalog Hardening, Docs Contract

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the four accepted decisions of ADR-003: a shared `RecordTitleButton` primitive adopted on every record-list surface, a shared row-selection helper extracted from contacts and adopted by catalog (bulk actions), test coverage for the catalog data path and AI tools, and the `/api/v1` documentation split.

**Architecture:** Reusability-first. Two new shared units (`RecordTitleButton` in `src/components/shared/`, pure selection helpers + thin hook in `src/hooks/`) replace per-module re-implementations. Existing code is refactored to consume them; no behavior changes except the two ADR-mandated fixes (appointment titles become clickable, catalog gains bulk selection). Data-layer logic stays where AGENTS.md puts it (`src/lib/data/operations/`) and gains tests instead of relocation.

**Tech Stack:** Next.js 16 / React 19, Tailwind v4 tokens, Vitest (node environment — **no testing-library**, so tests target pure logic only; UI is verified via typecheck + browser), Supabase (untouched — no migrations in this plan).

## Global Constraints

- pnpm only. Verification gate for every task: `pnpm typecheck && pnpm lint && pnpm test` all pass.
- No new dependencies. No schema migrations (ADR-003 defers all schema work behind triggers).
- Follow AGENTS.md: feature code in `src/features/<domain>/`, shared UI in `src/components/shared/`, generic hooks in `src/hooks/`, repositories in `src/lib/data/`.
- Design tokens only (`text-primary`, `ring-ring`, etc.) — never raw colors.
- `/api/v1` request/response shapes are a stability contract: additive changes only. This plan changes none.
- Commits: one per task, `Co-authored-by: v0 <it+v0agent@vercel.com>` trailer.
- UI tasks: verify in the browser with agent-browser (login: admin@gmail.com / admin, viewport 1033x632, dark).

---

### Task 1: `RecordTitleButton` shared primitive

**Files:**
- Create: `src/components/shared/record-title-button.tsx`

**Interfaces:**
- Produces: `RecordTitleButton({ onOpen, children, className }: { onOpen: () => void; children: React.ReactNode; className?: string })` — named export. Tasks 2–5 import it as `import { RecordTitleButton } from '@/components/shared/record-title-button';`

- [ ] **Step 1: Write the component**

```tsx
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Canonical "click the record title to open it" affordance (ADR-003 D1).
 *
 * Every record-list surface (Contacts, Pipelines, Catalog, Appointments)
 * renders its record title through this button so hover + keyboard focus
 * behavior stays identical everywhere. Wrap it in the surface's own
 * heading element (h2/h3) to keep heading semantics.
 *
 * Do NOT use this inside a dnd-kit draggable that spreads {...listeners}
 * over the same region, and do not nest it inside a whole-card button —
 * whole-card click targets are only permitted when the card contains no
 * other interactive controls (ADR-003 D1, Broadcasts variant).
 */
export function RecordTitleButton({
  onOpen,
  children,
  className,
}: {
  onOpen: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'hover:text-primary focus-visible:ring-ring max-w-full truncate rounded text-left font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none',
        className
      )}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: clean. (No unit test — node-env Vitest cannot render components; the four adoption tasks are its verification.)

- [ ] **Step 3: Commit**

```bash
git add src/components/shared/record-title-button.tsx
git commit -m "feat(shared): RecordTitleButton — canonical record-open affordance (ADR-003 D1)"
```

---

### Task 2: Adopt in Catalog (replaces inline button from commit bcc0336)

**Files:**
- Modify: `src/features/catalog/components/catalog-workspace.tsx` (~line 365–380)

**Interfaces:**
- Consumes: `RecordTitleButton` from Task 1. Existing `openEdit(item: CatalogItem)` in the same file stays unchanged.

- [ ] **Step 1: Replace the inline title button**

Current code (added by commit `bcc0336`, keep the comment, swap the button):

```tsx
<h2 className="truncate text-sm">
  <button
    type="button"
    onClick={() => openEdit(item)}
    className="text-foreground hover:text-primary focus-visible:ring-ring max-w-full truncate rounded font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
  >
    {item.name}
  </button>
</h2>
```

becomes:

```tsx
<h2 className="truncate text-sm">
  <RecordTitleButton onOpen={() => openEdit(item)} className="text-foreground">
    {item.name}
  </RecordTitleButton>
</h2>
```

Add the import alongside the other `@/components/shared/` imports:

```tsx
import { RecordTitleButton } from '@/components/shared/record-title-button';
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Browser: /catalog → click item name → "Edit Catalog Item" sheet opens; Tab to the name → visible focus ring.

- [ ] **Step 3: Commit**

```bash
git add src/features/catalog/components/catalog-workspace.tsx
git commit -m "refactor(catalog): adopt RecordTitleButton for item titles"
```

---

### Task 3: Adopt in Contacts (adds the missing focus ring)

**Files:**
- Modify: `src/features/contacts/components/contact-workspace.tsx` (~line 818–823)

**Interfaces:**
- Consumes: `RecordTitleButton` from Task 1. Existing `setContactSheet({ mode: 'view', contact })` stays unchanged.

- [ ] **Step 1: Replace the bare title button**

Current code (note: no type="button", no focus ring — both fixed by the primitive):

```tsx
<button
  className="hover:text-primary truncate font-semibold"
  onClick={() => setContactSheet({ mode: 'view', contact })}
>
  {valueText(contact.values.name)}
</button>
```

becomes:

```tsx
<RecordTitleButton
  onOpen={() => setContactSheet({ mode: 'view', contact })}
>
  {valueText(contact.values.name)}
</RecordTitleButton>
```

Add the import: `import { RecordTitleButton } from '@/components/shared/record-title-button';`

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Browser: /contacts → click a contact name → record sheet opens; Tab → visible focus ring (this is new).

- [ ] **Step 3: Commit**

```bash
git add src/features/contacts/components/contact-workspace.tsx
git commit -m "refactor(contacts): adopt RecordTitleButton — adds missing keyboard focus ring"
```

---

### Task 4: Adopt in Pipelines (list-view deal title only)

**Files:**
- Modify: `src/features/pipelines/components/pipeline-workspace.tsx` (list-view deal title button near line 1325; find it via `grep -n "hover:text-primary" src/features/pipelines/components/pipeline-workspace.tsx`)

**Interfaces:**
- Consumes: `RecordTitleButton` from Task 1. Existing `onOpen(deal)` callback stays unchanged.

**Scope guard:** The BOARD card title (~line 1153, inside the dnd-kit draggable that spreads `{...listeners}`) is explicitly OUT of scope per the primitive's doc comment and ADR-003 — leave it as-is with a code comment. Only the LIST view row title changes.

- [ ] **Step 1: Replace the list-view title button**

The list-view `<td>` contains a plain button with `hover:text-primary ... truncate text-left font-semibold` classes calling `onOpen(deal)`. Replace it:

```tsx
<RecordTitleButton onOpen={() => onOpen(deal)}>
  {deal.title}
</RecordTitleButton>
```

Add the import: `import { RecordTitleButton } from '@/components/shared/record-title-button';`

- [ ] **Step 2: Annotate the board-card exception**

Above the board card's title button (~line 1153), add:

```tsx
{/* Deliberately NOT RecordTitleButton: this card is a dnd-kit draggable
    and spreads {...listeners}; see ADR-003 D1 exception. */}
```

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm lint`
Browser: /pipelines → List view → click deal title → deal sheet opens; Tab → focus ring. Board view: drag still works.

- [ ] **Step 4: Commit**

```bash
git add src/features/pipelines/components/pipeline-workspace.tsx
git commit -m "refactor(pipelines): adopt RecordTitleButton in list view; annotate board-card exception"
```

---

### Task 5: Appointments — make the title open the record (the real outlier)

**Files:**
- Modify: `src/features/appointments/components/appointment-workspace.tsx` (title `<h3>` at ~line 546)

**Interfaces:**
- Consumes: `RecordTitleButton` from Task 1. Existing `setEditing(item)` (state declared line 178, already used by the pencil at line 617) is the open action — reuse it, do not add new state.

- [ ] **Step 1: Wrap the title in RecordTitleButton**

Current:

```tsx
<h3 className="text-foreground truncate text-sm font-semibold">
  {item.title}
</h3>
```

becomes:

```tsx
<h3 className="truncate text-sm">
  <RecordTitleButton
    onOpen={() => setEditing(item)}
    className="text-foreground"
  >
    {item.title}
  </RecordTitleButton>
</h3>
```

Add the import: `import { RecordTitleButton } from '@/components/shared/record-title-button';`

Keep the pencil button (line ~611) — it stays as a secondary affordance, consistent with Catalog keeping its dropdown Edit.

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm lint`
Browser: /appointments → click an appointment title → edit sheet opens (same one the pencil opens); pencil still works.

- [ ] **Step 3: Commit**

```bash
git add src/features/appointments/components/appointment-workspace.tsx
git commit -m "fix(appointments): titles open the record via RecordTitleButton (ADR-003 D1)"
```

---

### Task 6: Pure selection helpers (TDD) + `useRowSelection` hook

**Files:**
- Create: `src/hooks/use-row-selection.ts`
- Test: `src/hooks/row-selection.test.ts` (tests the pure helpers — node-env safe)

**Interfaces:**
- Produces (pure, exported for tests and the hook):
  - `toggleId(set: ReadonlySet<string>, id: string): Set<string>`
  - `toggleAll(set: ReadonlySet<string>, ids: string[]): Set<string>` — if every id is present, returns a set without them; otherwise returns a set with all of them added
  - `areAllSelected(set: ReadonlySet<string>, ids: string[]): boolean` — false for empty `ids`
- Produces (hook): `useRowSelection(ids: string[])` returning `{ selected: Set<string>; allSelected: boolean; toggle(id: string): void; toggleAllRows(): void; clear(): void }`
- Task 7 consumes the hook in catalog. A later (out-of-plan) refactor can adopt it in contacts.

- [ ] **Step 1: Write the failing tests**

```ts
// src/hooks/row-selection.test.ts
import { describe, expect, it } from 'vitest';

import { areAllSelected, toggleAll, toggleId } from './use-row-selection';

describe('toggleId', () => {
  it('adds an absent id without mutating the input', () => {
    const input = new Set(['a']);
    const next = toggleId(input, 'b');
    expect([...next].sort()).toEqual(['a', 'b']);
    expect(input.has('b')).toBe(false);
  });

  it('removes a present id', () => {
    expect(toggleId(new Set(['a', 'b']), 'a').has('a')).toBe(false);
  });
});

describe('toggleAll', () => {
  it('selects all when some are missing', () => {
    const next = toggleAll(new Set(['a']), ['a', 'b', 'c']);
    expect(next.size).toBe(3);
  });

  it('deselects all when every id is present', () => {
    const next = toggleAll(new Set(['a', 'b', 'x']), ['a', 'b']);
    expect([...next]).toEqual(['x']); // unrelated selections survive
  });
});

describe('areAllSelected', () => {
  it('is false for an empty id list', () => {
    expect(areAllSelected(new Set(['a']), [])).toBe(false);
  });

  it('is true only when every id is selected', () => {
    expect(areAllSelected(new Set(['a', 'b']), ['a', 'b'])).toBe(true);
    expect(areAllSelected(new Set(['a']), ['a', 'b'])).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm exec vitest run src/hooks/row-selection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/hooks/use-row-selection.ts
import { useCallback, useState } from 'react';

// Pure helpers — exported for unit tests (node env, no renderer needed).

export function toggleId(set: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

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

export function areAllSelected(
  set: ReadonlySet<string>,
  ids: string[]
): boolean {
  return ids.length > 0 && ids.every((id) => set.has(id));
}

/**
 * Shared multi-select state for record lists (ADR-003 D2). Extracted from
 * the pattern in contact-workspace.tsx so Catalog (and future modules)
 * do not re-implement it.
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
```

- [ ] **Step 4: Run tests to verify pass, then full gate**

Run: `pnpm exec vitest run src/hooks/row-selection.test.ts` → PASS, then `pnpm typecheck && pnpm lint && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-row-selection.ts src/hooks/row-selection.test.ts
git commit -m "feat(hooks): useRowSelection + pure selection helpers with tests (ADR-003 D2)"
```

---

### Task 7: Catalog bulk selection UI (backend already supports it)

**Files:**
- Modify: `src/features/catalog/components/catalog-workspace.tsx`

**Interfaces:**
- Consumes: `useRowSelection` from Task 6; existing `DELETE /api/v1/workspace/catalog` with body `{ ids: string[] }` (already implemented and admin-gated by RLS — see `src/app/api/v1/workspace/catalog/route.ts`); existing `Checkbox` from `@/components/ui/checkbox`; existing SWR `mutate` in the component.
- Model: the contacts bulk bar (`contact-workspace.tsx` lines 596–612) — copy its structure, not its code verbatim.

- [ ] **Step 1: Wire selection state**

In the workspace component, after the filtered list is computed (it is the
`filtered` useMemo at line ~119):

```tsx
const selectableIds = useMemo(
  () => filtered.map((item) => item.id),
  [filtered]
);
const { selected, allSelected, toggle, toggleAllRows, clear } =
  useRowSelection(selectableIds);
```

(The `useMemo` keeps the `ids` array reference stable so the hook's
`toggleAllRows` callback is not rebuilt every render.)

- [ ] **Step 2: Add a per-card Checkbox**

Inside each item card, before the icon block, mirroring contacts' row checkbox:

```tsx
<Checkbox
  checked={selected.has(item.id)}
  onCheckedChange={() => toggle(item.id)}
  aria-label={`Select ${item.name}`}
/>
```

Add a "select all" Checkbox in the toolbar row with `checked={allSelected}` / `onCheckedChange={toggleAllRows}` and `aria-label="Select all items"`.

- [ ] **Step 3: Add the bulk bar**

Rendered only when `selected.size > 0`, structured like contacts' bar (lines 596–612): count on the left, destructive "Delete selected" button on the right that opens the EXISTING delete `AlertDialog` flow, posting `{ ids: [...selected] }` to the existing DELETE endpoint, then `clear()` and `mutate()`.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Browser: /catalog → select the item → bulk bar appears with "1 selected" → Delete selected → confirm dialog → item gone → recreate an item via New Item so the workspace is not left empty.

- [ ] **Step 5: Commit**

```bash
git add src/features/catalog/components/catalog-workspace.tsx
git commit -m "feat(catalog): bulk selection UI over existing bulk-delete API (ADR-003 D2)"
```

---

### Task 8: Catalog data-path tests (validation + AI tool scoping)

**Files:**
- Test (create): `src/lib/data/operations/validation.test.ts`
- Test (extend): `src/features/assistant/lib/tool-registration.test.ts` (exists — add behavior tests beside it or extend)

**Interfaces:**
- Consumes: `catalogItemCreateSchema`, `catalogItemUpdateSchema`, `idListSchema` from `src/lib/data/operations/validation.ts`; `buildAssistantTools(ctx)` from `src/features/assistant/lib/tools.ts` (ctx carries `accountId`, `userId`, and the Supabase client — stub the client with a chainable object).

- [ ] **Step 1: Write failing validation tests**

```ts
// src/lib/data/operations/validation.test.ts
import { describe, expect, it } from 'vitest';

import {
  catalogItemCreateSchema,
  catalogItemUpdateSchema,
  idListSchema,
} from './validation';

describe('catalogItemCreateSchema', () => {
  it('applies defaults: price 0, currency USD, active', () => {
    const parsed = catalogItemCreateSchema.parse({ name: 'Consult' });
    expect(parsed.price).toBe(0);
    expect(parsed.currency).toBe('USD');
    expect(parsed.isActive).toBe(true);
  });

  it('uppercases currency and rejects negative price', () => {
    expect(
      catalogItemCreateSchema.parse({ name: 'x', currency: 'inr' }).currency
    ).toBe('INR');
    expect(
      catalogItemCreateSchema.safeParse({ name: 'x', price: -1 }).success
    ).toBe(false);
  });

  it('rejects a name over 160 chars and an empty name', () => {
    expect(
      catalogItemCreateSchema.safeParse({ name: 'a'.repeat(161) }).success
    ).toBe(false);
    expect(catalogItemCreateSchema.safeParse({ name: '' }).success).toBe(
      false
    );
  });
});

describe('catalogItemUpdateSchema', () => {
  it('requires a uuid id and allows partial fields', () => {
    expect(
      catalogItemUpdateSchema.safeParse({ id: 'not-a-uuid' }).success
    ).toBe(false);
    expect(
      catalogItemUpdateSchema.safeParse({
        id: '00000000-0000-4000-8000-000000000000',
        price: 250,
      }).success
    ).toBe(true);
  });
});

describe('idListSchema', () => {
  it('rejects an empty id list', () => {
    expect(idListSchema.safeParse({ ids: [] }).success).toBe(false);
  });
});
```

Note: if a default/limit assertion fails, read `validation.ts` and match the test to ACTUAL behavior — these tests pin existing behavior, they do not change it. If actual behavior looks wrong (e.g. empty ids accepted), flag it in the commit message rather than silently changing the schema.

- [ ] **Step 2: Run, adjust to actual behavior, get green**

Run: `pnpm exec vitest run src/lib/data/operations/validation.test.ts`

- [ ] **Step 3: Add AI-tool scoping tests**

Extend the existing `tool-registration.test.ts` (or a sibling `catalog-tools.test.ts`) with a chainable Supabase stub asserting that `list_catalog_items.execute()` filters by the ctx account:

```ts
function chainStub(result: { data: unknown; error: null }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'eq', 'ilike', 'order']) {
    chain[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return chain;
    };
  }
  chain.limit = (...args: unknown[]) => {
    calls.push(['limit', args]);
    return Promise.resolve(result);
  };
  return { chain, calls };
}

it('list_catalog_items scopes to the ctx account', async () => {
  const { chain, calls } = chainStub({ data: [], error: null });
  const tools = buildAssistantTools({
    accountId: 'acct-1',
    userId: 'user-1',
    supabase: chain,
  } as never);
  await tools.list_catalog_items.execute!(
    { include_inactive: false, limit: 20 },
    {} as never
  );
  expect(calls).toContainEqual(['from', ['catalog_items']]);
  expect(calls).toContainEqual(['eq', ['account_id', 'acct-1']]);
});
```

Adjust the ctx shape to match `AssistantContext` in `src/features/assistant/lib/tools.ts` (read lines 20–60 first — the client property name may be `db` or `supabase`).

- [ ] **Step 4: Full gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`

```bash
git add src/lib/data/operations/validation.test.ts src/features/assistant/lib/tool-registration.test.ts
git commit -m "test(catalog): pin validation schema behavior and AI tool account scoping (ADR-003 D2)"
```

---

### Task 9: Docs — `/api/v1` auth-regime split + ADR-001 annotation

**Files:**
- Modify: `docs/public-api.md`
- Modify: `docs/adr/001-workspace-modules.md`

**Interfaces:** none — documentation only. Additive; no route moves (ADR-003 D3 defers relocation behind its trigger).

- [ ] **Step 1: Add the auth-regime section to public-api.md**

Near the top (after the intro/auth section), add:

```markdown
## Route namespaces and auth regimes

`/api/v1` currently hosts two different auth regimes:

| Namespace | Auth | Contract status |
| --- | --- | --- |
| `/api/v1/contacts`, `/api/v1/messages`, ... (routes documented below) | `Authorization: Bearer <API key>` via `requireApiKey` | **Public, stable** — additive changes only |
| `/api/v1/workspace/*` (catalog, appointments, tasks, ...) | Session cookie via `getCurrentAccount` | **Internal BFF** — consumed by the web UI only; NOT part of the public API; may change without notice |

New session-authenticated UI endpoints MUST go under `/api/v1/workspace/`
(or a future `/api/internal/`), never in the key-authenticated namespace.
Relocation of `workspace/*` out of `/api/v1` is deferred per ADR-003 D3
until the first external-developer or versioning trigger fires.
```

- [ ] **Step 2: Annotate ADR-001**

In `docs/adr/001-workspace-modules.md`, find the claim that all `/api/v1` routes funnel through `requireApiKey` (search: `grep -n "requireApiKey" docs/adr/001-workspace-modules.md`) and append directly below it:

```markdown
> **Annotation (2026-08-13, ADR-003):** No longer accurate. The
> `/api/v1/workspace/*` routes added with the workspace modules are
> session-authenticated BFF endpoints, not API-key routes. See
> "Route namespaces and auth regimes" in `docs/public-api.md`.
```

- [ ] **Step 3: Verify and commit**

Run: `pnpm format:check` (docs are prettier-checked) — fix with `pnpm format` if needed.

```bash
git add docs/public-api.md docs/adr/001-workspace-modules.md
git commit -m "docs(api): document /api/v1 dual auth regimes; annotate stale ADR-001 claim (ADR-003 D3)"
```

---

### Task 10: Final verification sweep

**Files:** none created — verification only.

- [ ] **Step 1: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: all pass (build required for release-bound work per AGENTS.md).

- [ ] **Step 2: Browser regression pass**

One agent-browser session, viewport 1033x632 dark, login admin@gmail.com/admin:
1. /contacts — click name → sheet; Tab → ring
2. /pipelines List — click deal title → sheet; Board — drag still works
3. /catalog — click name → edit sheet; select item → bulk bar → cancel
4. /appointments — click title → edit sheet; pencil still works
5. Screenshot each to /tmp/agent-browser/adr003-<page>.png

- [ ] **Step 3: Confirm no dropped selections regression in contacts**

Contacts was NOT refactored to `useRowSelection` in this plan (deliberate — avoid touching its working bulk flow while extracting the pattern). Verify its select-all + bulk delete bar still behaves.

- [ ] **Step 4: Commit anything the sweep fixed; otherwise done**

---

## Explicitly OUT of scope (per ADR-003 triggers — do not build)

- Catalog schema fields (SKU, image, duration, tax, currency default) — each waits for its trigger
- `companies` table and `company_norm` generated column — deferred at current data volume
- Relocating `/api/v1/workspace/*` routes — documented instead
- Refactoring contacts onto `useRowSelection` — future cleanup, listed in ADR-003 consequences
- Board-card title in pipelines — dnd-kit exception, annotated in code
