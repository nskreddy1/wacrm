# Unify Automations Page into Flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the Automations list page into the Flows page (keeping the Flows card-grid design), redirect `/automations` to `/flows`, and show a single "Flows" nav entry — with classic automation rules rendered as cards alongside flows.

**Architecture:** UI-only merge (Phase 1 of 2). Backends stay separate: flows keep `/api/flows`, automations keep `/api/automations`. The unified `/flows` page fetches both in parallel, merges them into one grid sorted by `updated_at`, and offers filter tabs (All / Flows / Classic rules). Deep automation routes (`/automations/new`, `/automations/[id]/edit`, `/automations/[id]/logs`) remain untouched — only the `/automations` list page becomes a redirect. Phase 2 (data migration of automations into the flows engine) is out of scope and gets its own spec/plan later.

**Tech Stack:** Next.js App Router (`src/app/(dashboard)`), React client components, shadcn/ui, next-intl (single locale `messages/en.json`), Vitest, pnpm.

## Global Constraints

- Package manager is **pnpm** (`pnpm-lock.yaml` is authoritative; ignore `package-lock.json`).
- Commands: `pnpm typecheck`, `pnpm test`, `pnpm lint`.
- Work on branch `unify-automations-page`. Never push to `main`.
- The unified page is named **Flows** and keeps the existing Flows visual design (card grid, status badges, Beta chip).
- Do NOT modify: `/api/automations/*` routes, `/api/flows/*` routes, the automation builder (`src/components/automations/automation-builder.tsx`), the flow editor, or `src/lib/automations/engine.ts`.
- Do NOT delete `src/app/(dashboard)/automations/[id]/edit`, `.../[id]/logs`, or `.../new` — they stay reachable.
- Single locale file: `messages/en.json`. All user-facing copy goes through `next-intl` keys.
- JSX apostrophes must be escaped (`&apos;` or string expressions).
- Escape user-visible `<`, `>`, `{`, `}` in JSX by wrapping in string expressions.

---

## File Structure

| File                                            | Action  | Responsibility                                                                     |
| ----------------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `src/components/flows/unified-items.ts`         | Create  | Pure merge/filter/sort logic for mixed flow + automation lists (unit-tested)       |
| `src/components/flows/unified-items.test.ts`    | Create  | Vitest coverage for merge/filter logic                                             |
| `src/components/flows/automation-rule-card.tsx` | Create  | Flows-design card for a classic automation (toggle, edit, logs, duplicate, delete) |
| `src/app/(dashboard)/flows/page.tsx`            | Modify  | Unified list page: fetch both APIs, filter tabs, mixed grid                        |
| `src/app/(dashboard)/automations/page.tsx`      | Replace | Server-side `redirect("/flows")`                                                   |
| `src/lib/navigation/config.ts`                  | Modify  | Remove the separate "Automations" nav entry (line 62)                              |
| `messages/en.json`                              | Modify  | New `Flows.list` keys for classic-rule cards, filters, toasts                      |

Existing helpers reused (do not duplicate): `triggerMeta`, `formatRelative` from `src/lib/automations/trigger-meta.ts`; `Automation` type from `@/types`; `GatedButton`, `Switch`, `DropdownMenu`, `Dialog`, `Badge` from `src/components/ui`.

---

### Task 1: Pure merge/filter logic (`unified-items.ts`)

**Files:**

- Create: `src/components/flows/unified-items.ts`
- Test: `src/components/flows/unified-items.test.ts`

**Interfaces:**

- Consumes: `Automation` from `@/types`.
- Produces: `FlowRow`, `UnifiedItem`, `UnifiedFilter`, `mergeUnifiedItems(flows, automations): UnifiedItem[]`, `filterUnifiedItems(items, filter): UnifiedItem[]`. Task 3 imports all of these; Task 2 imports nothing from here.

- [ ] **Step 1: Write the failing test**

Create `src/components/flows/unified-items.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Automation } from '@/types';
import {
  filterUnifiedItems,
  mergeUnifiedItems,
  type FlowRow,
} from './unified-items';

function flow(overrides: Partial<FlowRow> = {}): FlowRow {
  return {
    id: 'flow-1',
    name: 'Flow',
    description: null,
    status: 'active',
    trigger_type: 'keyword',
    trigger_config: { keywords: ['hi'] },
    execution_count: 3,
    last_executed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  };
}

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    account_id: 'acct-1',
    user_id: 'user-1',
    name: 'Rule',
    trigger_type: 'keyword_match',
    trigger_config: {},
    is_active: true,
    execution_count: 5,
    last_executed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-03T00:00:00Z',
    ...overrides,
  } as Automation;
}

describe('mergeUnifiedItems', () => {
  it('interleaves flows and automations sorted by updated_at desc', () => {
    const items = mergeUnifiedItems(
      [flow({ id: 'f1', updated_at: '2026-01-02T00:00:00Z' })],
      [
        automation({ id: 'a1', updated_at: '2026-01-03T00:00:00Z' }),
        automation({ id: 'a2', updated_at: '2026-01-01T00:00:00Z' }),
      ]
    );
    expect(
      items.map((i) => (i.kind === 'flow' ? i.flow.id : i.automation.id))
    ).toEqual(['a1', 'f1', 'a2']);
  });

  it('returns empty array for no input', () => {
    expect(mergeUnifiedItems([], [])).toEqual([]);
  });

  it('tolerates invalid dates by sorting them last', () => {
    const items = mergeUnifiedItems(
      [flow({ id: 'f1', updated_at: 'not-a-date' })],
      [automation({ id: 'a1', updated_at: '2026-01-01T00:00:00Z' })]
    );
    expect(items[0].kind).toBe('automation');
  });
});

describe('filterUnifiedItems', () => {
  const items = mergeUnifiedItems([flow()], [automation()]);

  it("'all' returns everything", () => {
    expect(filterUnifiedItems(items, 'all')).toHaveLength(2);
  });

  it("'flows' returns only flows", () => {
    const out = filterUnifiedItems(items, 'flows');
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('flow');
  });

  it("'rules' returns only automations", () => {
    const out = filterUnifiedItems(items, 'rules');
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('automation');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/components/flows/unified-items.test.ts`
Expected: FAIL — cannot resolve `./unified-items`.

- [ ] **Step 3: Write the implementation**

Create `src/components/flows/unified-items.ts`:

```ts
import type { Automation } from '@/types';

/**
 * FlowRow was previously a private interface inside
 * src/app/(dashboard)/flows/page.tsx. It now lives here so the page,
 * cards, and tests share one definition. Task 3 updates the page to
 * import it from this module.
 */
export interface FlowRow {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  trigger_type: 'keyword' | 'first_inbound_message' | 'manual';
  trigger_config: { keywords?: string[] } | Record<string, unknown>;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type UnifiedItem =
  | { kind: 'flow'; flow: FlowRow }
  | { kind: 'automation'; automation: Automation };

export type UnifiedFilter = 'all' | 'flows' | 'rules';

function sortTime(iso: string | null | undefined): number {
  if (!iso) return Number.NEGATIVE_INFINITY;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** Merge flows and classic automations into one list, newest updated first. */
export function mergeUnifiedItems(
  flows: FlowRow[],
  automations: Automation[]
): UnifiedItem[] {
  const items: UnifiedItem[] = [
    ...flows.map((flow): UnifiedItem => ({ kind: 'flow', flow })),
    ...automations.map((automation): UnifiedItem => ({
      kind: 'automation',
      automation,
    })),
  ];
  return items.sort((a, b) => {
    const ta = sortTime(
      a.kind === 'flow' ? a.flow.updated_at : a.automation.updated_at
    );
    const tb = sortTime(
      b.kind === 'flow' ? b.flow.updated_at : b.automation.updated_at
    );
    return tb - ta;
  });
}

export function filterUnifiedItems(
  items: UnifiedItem[],
  filter: UnifiedFilter
): UnifiedItem[] {
  if (filter === 'flows') return items.filter((i) => i.kind === 'flow');
  if (filter === 'rules') return items.filter((i) => i.kind === 'automation');
  return items;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/components/flows/unified-items.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/flows/unified-items.ts src/components/flows/unified-items.test.ts
git commit -m "feat(flows): add unified flow/automation merge and filter helpers"
```

---

### Task 2: i18n keys + `AutomationRuleCard` component

**Files:**

- Modify: `messages/en.json` (inside the existing `Flows.list` object)
- Create: `src/components/flows/automation-rule-card.tsx`

**Interfaces:**

- Consumes: `Automation` from `@/types`; `triggerMeta`, `formatRelative` from `@/lib/automations/trigger-meta`.
- Produces: `AutomationRuleCard` React component with props `{ automation: Automation; onToggle: (next: boolean) => void; onEdit: () => void; onLogs: () => void; onDuplicate: () => void; onDelete: () => void; t: ReturnType<typeof useTranslations> }`. Task 3 renders it.

- [ ] **Step 1: Add translation keys**

In `messages/en.json`, add these keys inside the existing `Flows.list` object (keep all existing keys; add after `"triggerManual"`):

```json
"classicRule": "Classic rule",
"statusPaused": "Paused",
"filterAll": "All",
"filterFlows": "Flows",
"filterRules": "Classic rules",
"lastRunLabel": "Last run {time}",
"activateRule": "Activate rule",
"deactivateRule": "Pause rule",
"viewLogs": "View logs",
"duplicate": "Duplicate",
"ruleActivated": "Rule activated",
"rulePaused": "Rule paused",
"ruleUpdateError": "Could not update rule",
"ruleDuplicated": "Rule duplicated",
"ruleDuplicateError": "Could not duplicate rule",
"ruleDeleted": "Rule deleted",
"ruleDeleteError": "Could not delete rule",
"deleteRuleTitle": "Delete rule?",
"deleteRuleDesc": "This permanently deletes \"{name}\" and its history. This cannot be undone.",
"startClassic": "Prefer a simple trigger-action rule?",
"createClassic": "Create classic automation"
```

- [ ] **Step 2: Create the card component**

Create `src/components/flows/automation-rule-card.tsx`. It follows the exact visual grammar of `FlowCard` in `src/app/(dashboard)/flows/page.tsx` (rounded-lg bordered card, icon+name header, status Badge, meta row, bottom action row) — use that component as the style exemplar:

```tsx
'use client';

import {
  Zap,
  MoreVertical,
  Pencil,
  Copy,
  FileText,
  Trash2,
  PlayCircle,
  PauseCircle,
} from 'lucide-react';
import type { useTranslations } from 'next-intl';

import type { Automation } from '@/types';
import { triggerMeta, formatRelative } from '@/lib/automations/trigger-meta';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/**
 * Card for a classic automation rule, rendered inside the unified
 * Flows grid. Matches the FlowCard visual design; the "Classic rule"
 * chip and Zap icon distinguish it from canvas flows.
 */
export function AutomationRuleCard({
  automation,
  onToggle,
  onEdit,
  onLogs,
  onDuplicate,
  onDelete,
  t,
}: {
  automation: Automation;
  onToggle: (next: boolean) => void;
  onEdit: () => void;
  onLogs: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const meta = triggerMeta(automation.trigger_type);
  const StatusIcon = automation.is_active ? PlayCircle : PauseCircle;

  return (
    <div className="border-border bg-card hover:border-border flex flex-col rounded-lg border p-4 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Zap className="text-primary h-4 w-4 shrink-0" />
          <h3 className="text-foreground truncate text-sm font-semibold">
            {automation.name}
          </h3>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'shrink-0 gap-1 text-[10px]',
            automation.is_active
              ? 'border-emerald-600/40 bg-emerald-500/10 text-emerald-300'
              : 'border-border bg-muted text-muted-foreground'
          )}
        >
          <StatusIcon className="h-3 w-3" />
          {automation.is_active ? t('statusActive') : t('statusPaused')}
        </Badge>
      </div>

      <p className="text-muted-foreground mt-2 line-clamp-2 text-xs">
        {automation.description || meta.label}
      </p>

      <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className={cn(
            'inline-flex items-center rounded-full border px-2 py-0.5 font-medium',
            meta.pillClass
          )}
        >
          {meta.label}
        </span>
        <span className="border-border bg-muted/50 inline-flex items-center rounded-full border px-2 py-0.5 font-medium">
          {t('classicRule')}
        </span>
        <span className="tabular-nums">
          {t('runCount', { count: automation.execution_count })}
        </span>
        <span aria-hidden>·</span>
        <span>
          {t('lastRunLabel', {
            time: formatRelative(automation.last_executed_at),
          })}
        </span>
      </div>

      <div className="border-border mt-4 flex items-center justify-between gap-2 border-t pt-3">
        <Switch
          checked={automation.is_active}
          onCheckedChange={(v) => onToggle(!!v)}
          aria-label={
            automation.is_active ? t('deactivateRule') : t('activateRule')
          }
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Open menu"
            className="text-muted-foreground hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors"
          >
            <MoreVertical className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              {t('edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDuplicate}>
              <Copy className="h-4 w-4" />
              {t('duplicate')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onLogs}>
              <FileText className="h-4 w-4" />
              {t('viewLogs')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
              {t('delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
```

Note: the `DropdownMenuTrigger` classes (including `data-[popup-open]:bg-muted`) are copied verbatim from the existing automations page — this repo's dropdown uses that attribute, do not "fix" it to `data-[state=open]`.

- [ ] **Step 3: Verify types compile**

Run: `pnpm typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add messages/en.json src/components/flows/automation-rule-card.tsx
git commit -m "feat(flows): add classic automation rule card and i18n keys"
```

---

### Task 3: Unified Flows page

**Files:**

- Modify: `src/app/(dashboard)/flows/page.tsx`

**Interfaces:**

- Consumes: `mergeUnifiedItems`, `filterUnifiedItems`, `FlowRow`, `UnifiedItem`, `UnifiedFilter` from `@/components/flows/unified-items`; `AutomationRuleCard` from `@/components/flows/automation-rule-card`; `Automation` from `@/types`.
- Produces: the unified `/flows` page. No other task consumes it.

- [ ] **Step 1: Apply the page changes**

Modify `src/app/(dashboard)/flows/page.tsx`. Keep everything not mentioned below exactly as-is (create dialog, templates, `EmptyState`, `FlowCard`, `describeTrigger`, permission gating, Beta chip). Changes:

1. **Delete the local `FlowRow` interface** and import it instead. Add imports:

```tsx
import type { Automation } from '@/types';
import {
  mergeUnifiedItems,
  filterUnifiedItems,
  type FlowRow,
  type UnifiedFilter,
} from '@/components/flows/unified-items';
import { AutomationRuleCard } from '@/components/flows/automation-rule-card';
```

2. **Add state** next to the existing `flows` state:

```tsx
const [automations, setAutomations] = useState<Automation[]>([]);
const [filter, setFilter] = useState<UnifiedFilter>('all');
const [pendingRuleDelete, setPendingRuleDelete] = useState<Automation | null>(
  null
);
const [deletingRule, setDeletingRule] = useState(false);
```

3. **Fetch automations in the same effect.** Extend the existing `Promise.all` from two to three requests, tolerating an automations failure the same way templates are tolerated (flows remain the primary content):

```tsx
const [flowsRes, tmplRes, autoRes] = await Promise.all([
  fetch('/api/flows'),
  fetch('/api/flows/templates'),
  fetch('/api/automations', { cache: 'no-store' }),
]);
```

and after the templates handling, inside the same try block:

```tsx
if (autoRes.ok) {
  const autoJson = (await autoRes.json()) as { automations: Automation[] };
  if (!cancelled) setAutomations(autoJson.automations ?? []);
}
```

4. **Add automation handlers** (ported from the old automations page — same endpoints, optimistic toggle with rollback):

```tsx
async function toggleRule(a: Automation, next: boolean) {
  setAutomations((prev) =>
    prev.map((x) => (x.id === a.id ? { ...x, is_active: next } : x))
  );
  const res = await fetch(`/api/automations/${a.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ is_active: next }),
  });
  if (!res.ok) {
    setAutomations((prev) =>
      prev.map((x) => (x.id === a.id ? { ...x, is_active: !next } : x))
    );
    const body = await res.json().catch(() => ({}));
    toast.error(body?.error ?? t('ruleUpdateError'));
    return;
  }
  toast.success(next ? t('ruleActivated') : t('rulePaused'));
}

async function duplicateRule(a: Automation) {
  const res = await fetch(`/api/automations/${a.id}/duplicate`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    toast.error(body?.error ?? t('ruleDuplicateError'));
    return;
  }
  const listRes = await fetch('/api/automations', { cache: 'no-store' });
  if (listRes.ok) {
    const json = (await listRes.json()) as { automations: Automation[] };
    setAutomations(json.automations ?? []);
  }
  toast.success(t('ruleDuplicated'));
}

async function confirmRuleDelete() {
  if (!pendingRuleDelete) return;
  setDeletingRule(true);
  const res = await fetch(`/api/automations/${pendingRuleDelete.id}`, {
    method: 'DELETE',
  });
  setDeletingRule(false);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    toast.error(body?.error ?? t('ruleDeleteError'));
    return;
  }
  setAutomations((prev) => prev.filter((x) => x.id !== pendingRuleDelete.id));
  setPendingRuleDelete(null);
  toast.success(t('ruleDeleted'));
}
```

5. **Replace the grid block.** Compute the merged list before the return:

```tsx
const items = filterUnifiedItems(mergeUnifiedItems(flows, automations), filter);
const isEmpty = flows.length === 0 && automations.length === 0;
```

Replace the current `{flows.length === 0 ? <EmptyState .../> : <div className="grid ...">}` block with:

```tsx
{
  !isEmpty && (
    <div
      role="tablist"
      aria-label={t('filterAll')}
      className="border-border bg-muted/40 flex w-fit items-center gap-1 rounded-lg border p-1"
    >
      {(
        [
          ['all', t('filterAll')],
          ['flows', t('filterFlows')],
          ['rules', t('filterRules')],
        ] as [UnifiedFilter, string][]
      ).map(([value, label]) => (
        <button
          key={value}
          role="tab"
          aria-selected={filter === value}
          onClick={() => setFilter(value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
            filter === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

{
  isEmpty ? (
    <EmptyState
      onCreate={() => setCreateOpen(true)}
      canCreate={canCreate}
      t={t}
    />
  ) : (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) =>
        item.kind === 'flow' ? (
          <FlowCard
            key={`flow-${item.flow.id}`}
            flow={item.flow}
            onEdit={() => router.push(`/flows/${item.flow.id}`)}
            onDelete={() => handleDelete(item.flow)}
            t={t}
          />
        ) : (
          <AutomationRuleCard
            key={`auto-${item.automation.id}`}
            automation={item.automation}
            onToggle={(next) => toggleRule(item.automation, next)}
            onEdit={() =>
              router.push(`/automations/${item.automation.id}/edit`)
            }
            onLogs={() =>
              router.push(`/automations/${item.automation.id}/logs`)
            }
            onDuplicate={() => duplicateRule(item.automation)}
            onDelete={() => setPendingRuleDelete(item.automation)}
            t={t}
          />
        )
      )}
    </div>
  );
}
```

6. **Add classic-automation entry point in the create dialog.** Inside `DialogContent`, after the "start blank" section (`<div className="space-y-2 border-t border-border pt-4">...</div>`), add:

```tsx
<div className="border-border flex items-center justify-between gap-2 border-t pt-4">
  <p className="text-muted-foreground text-xs">{t('startClassic')}</p>
  <Button
    variant="outline"
    size="sm"
    onClick={() => router.push('/automations/new')}
    disabled={creating}
  >
    <Zap className="h-4 w-4" />
    {t('createClassic')}
  </Button>
</div>
```

Add `Zap` to the existing `lucide-react` import.

7. **Add the rule delete confirmation dialog** as a sibling of the existing create `Dialog` (flows keep their `window.confirm`; rules use the richer dialog ported from the automations page):

```tsx
<Dialog
  open={!!pendingRuleDelete}
  onOpenChange={(v) => !v && setPendingRuleDelete(null)}
>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>{t('deleteRuleTitle')}</DialogTitle>
      <DialogDescription>
        {t('deleteRuleDesc', { name: pendingRuleDelete?.name ?? '' })}
      </DialogDescription>
    </DialogHeader>
    <DialogFooter>
      <Button
        variant="ghost"
        onClick={() => setPendingRuleDelete(null)}
        disabled={deletingRule}
      >
        {t('cancel')}
      </Button>
      <Button
        variant="destructive"
        onClick={confirmRuleDelete}
        disabled={deletingRule}
      >
        {deletingRule ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
        {t('delete')}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 2: Verify**

Run: `pnpm typecheck && pnpm test`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(dashboard)/flows/page.tsx"
git commit -m "feat(flows): render classic automations in unified flows grid with filters"
```

---

### Task 4: Redirect `/automations` and single nav entry

**Files:**

- Replace: `src/app/(dashboard)/automations/page.tsx`
- Modify: `src/lib/navigation/config.ts:62-63`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `/automations` (list only) permanently lands on `/flows`. Existing code that pushes to `routes.app.automations` after saving an automation keeps working via this redirect — do NOT change `src/lib/routing/routes.ts`.

- [ ] **Step 1: Replace the automations list page with a redirect**

Replace the entire contents of `src/app/(dashboard)/automations/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';

/**
 * The Automations list was unified into the Flows page
 * (see docs/superpowers/plans/2026-07-18-unify-automations-into-flows.md).
 * Deep routes (/automations/new, /automations/[id]/edit,
 * /automations/[id]/logs) remain active — only the list moved.
 */
export default function AutomationsPage() {
  redirect('/flows');
}
```

- [ ] **Step 2: Remove the Automations nav entry**

In `src/lib/navigation/config.ts`, delete line 62 (the `automations` entry) so only the `flows` entry remains:

```ts
// DELETE this line:
{ key: "automations", href: "/automations", label: "Automations", shortLabel: "Rules", icon: "workflow", minRole: "agent" },
// KEEP this line:
{ key: "flows", href: "/flows", label: "Flows", shortLabel: "Flows", icon: "git-fork", minRole: "agent" },
```

Then search for any other consumer of the removed nav key: `grep -rn '"automations"' src/components src/lib --include="*.ts*"` — if anything references the nav item by `key === "automations"` (e.g. active-state logic or tests), update or remove those references in this step.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck && pnpm test && pnpm lint`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/automations/page.tsx" src/lib/navigation/config.ts
git commit -m "feat(nav): redirect /automations to unified /flows page"
```

---

### Task 5: Browser verification

**Files:** none (verification only).

- [ ] **Step 1: Verify the unified page in the browser**

With the dev server running, use agent-browser (dark mode, ~1208x457 viewport) to verify:

1. `/flows` loads; header shows "Flows" + Beta chip; both flow cards and classic-rule cards render in one grid.
2. Filter tabs work: "All" shows both kinds, "Flows" hides rule cards, "Classic rules" hides flow cards.
3. A rule card's switch toggles active/paused with a toast; the card badge updates.
4. Rule card menu → Edit navigates to `/automations/{id}/edit`; Logs navigates to `/automations/{id}/logs`.
5. "New flow" dialog shows templates, blank creation, and the "Create classic automation" button which navigates to `/automations/new`.
6. Visiting `/automations` redirects to `/flows`.
7. Nav sidebar shows a single "Flows" entry (no "Automations").
8. Take a screenshot to confirm no layout breakage.

Expected: all eight checks pass. If any fail, fix within the relevant task's files before committing.

- [ ] **Step 2: Final commit (if fixes were needed)**

```bash
git add -A && git commit -m "fix(flows): polish unified flows page after browser verification"
```

---

## Out of Scope (Phase 2 — separate plan later)

- Migrating automation rows into the flows engine/tables.
- Retiring `/api/automations`, the automation builder, and `automations` DB tables.
- Removing the redirect and deep `/automations/*` routes.
- Renaming `Automations.*` i18n namespaces.
