# Unified Automation Editor Implementation Plan

> **For implementation:** Execute this plan task-by-task with review checkpoints. Keep the existing automation and flow APIs unchanged, and run the listed focused test before each task-level commit.

**Goal:** Replace the separate rule and conversation-flow editing experiences with one production-complete node-canvas shell backed by a normalized in-memory document and compatibility adapters.

**Architecture:** Add a pure editor domain layer (`document`, adapters, validation, reducer/history), then compose one React Flow shell around mode-specific node metadata and configuration panels. Existing rule and flow payloads remain the persistence boundary; route wrappers load their current data, adapt it into the editor document, and pass mode-specific save/status handlers into the shared shell.

**Tech stack:** Next.js 16 App Router, React 19, TypeScript, `@xyflow/react`, Tailwind CSS 4, shadcn/base-ui components, next-intl, Vitest.

**Design reference:** `docs/superpowers/specs/2026-07-18-unified-automation-editor-design.md`

---

## Task 1: Define the normalized editor domain

**Files:**
- Create: `src/components/automation-editor/document.ts`
- Create: `src/components/automation-editor/document.test.ts`

**Step 1: Write the failing document helper tests**

Cover:

- `createEditorId()` returns a non-empty client id.
- `cloneNode()` creates a new id, removes `sourceRef`, offsets position, and deep-clones config.
- `removeNodeAndEdges()` removes the node and every attached edge in one result.
- `isEditableTarget()` returns true for input, textarea, select, and contenteditable targets so global shortcuts do not delete or save while users are typing.

Use minimal fixtures shaped as:

```ts
const node: AutomationEditorNode = {
  id: "message-1",
  kind: "send_message",
  position: { x: 100, y: 160 },
  config: { text: "Hello" },
  sourceRef: "server-step-id",
}
```

**Step 2: Run the focused test and verify failure**

Run:

```bash
pnpm test -- src/components/automation-editor/document.test.ts
```

Expected: FAIL because `document.ts` does not exist.

**Step 3: Implement the document types and pure helpers**

Define:

```ts
export type AutomationEditorMode = "rule" | "flow"
export type AutomationEditorSaveState = "saved" | "unsaved" | "saving" | "error"

export interface AutomationEditorDocument {
  id?: string
  mode: AutomationEditorMode
  name: string
  description: string
  status: "draft" | "active" | "inactive" | "archived"
  trigger: AutomationEditorTrigger
  nodes: AutomationEditorNode[]
  edges: AutomationEditorEdge[]
  revision: number
}
```

Keep the domain file framework-free. Use `structuredClone` where available only through a small deterministic helper so tests work in Node.

**Step 4: Run the focused test and typecheck**

```bash
pnpm test -- src/components/automation-editor/document.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/automation-editor/document.ts src/components/automation-editor/document.test.ts
git commit -m "feat: add automation editor document model"
```

---

## Task 2: Add rule and flow compatibility adapters

**Files:**
- Create: `src/components/automation-editor/adapters/rule-adapter.ts`
- Create: `src/components/automation-editor/adapters/rule-adapter.test.ts`
- Create: `src/components/automation-editor/adapters/flow-adapter.ts`
- Create: `src/components/automation-editor/adapters/flow-adapter.test.ts`
- Modify: `src/components/automations/automation-builder.tsx`

**Step 1: Write failing round-trip adapter tests**

Rule fixtures must include:

- a linear message sequence;
- a condition with `yes` and `no` descendants;
- an unknown key inside `step_config`;
- stable server ids from `ServerStepNode`.

Flow fixtures must include:

- persisted positions;
- start/message/condition/end nodes;
- single-target `next_node_key` edges;
- condition `true_next` and `false_next` handles;
- button/list branch targets;
- unknown config keys.

Assert that load → normalized document → save preserves every runtime field and ordering required by the existing endpoints.

**Step 2: Run focused tests and verify failure**

```bash
pnpm test -- src/components/automation-editor/adapters/rule-adapter.test.ts src/components/automation-editor/adapters/flow-adapter.test.ts
```

Expected: FAIL because adapters do not exist.

**Step 3: Extract exported rule payload types without changing behavior**

Move or export the existing `ApiStep` shape and retain `BuilderInitial`, `BuilderStep`, `ServerStepNode`, `toApiSteps`, and `fromServerSteps` compatibility until the old UI is removed. Do not alter the existing save endpoint shape.

**Step 4: Implement rule adapter**

Add:

```ts
export function ruleAutomationToDocument(initial: BuilderInitial): AutomationEditorDocument
export function documentToRulePayload(document: AutomationEditorDocument): RuleAutomationSavePayload
```

Represent rule order with edges. Map condition branches through `sourceHandle: "yes" | "no"`. Reject disconnected, multiply-parented, cyclic, or otherwise non-serializable rule graphs with a typed adapter error rather than silently dropping nodes.

**Step 5: Implement flow adapter**

Add:

```ts
export function flowToDocument(flow: FlowRow, nodes: FlowNodeRow[]): AutomationEditorDocument
export function documentToFlowPayload(document: AutomationEditorDocument): FlowUpdatePayload
```

Generate edges from existing config references. On serialization, rebuild `next_node_key`, `true_next`, `false_next`, and interactive branch target fields while preserving unrelated config keys.

**Step 6: Run tests and typecheck**

```bash
pnpm test -- src/components/automation-editor/adapters/rule-adapter.test.ts src/components/automation-editor/adapters/flow-adapter.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 7: Commit**

```bash
git add src/components/automation-editor/adapters src/components/automations/automation-builder.tsx
git commit -m "feat: add automation editor compatibility adapters"
```

---

## Task 3: Add mode-aware validation and graph constraints

**Files:**
- Create: `src/components/automation-editor/validation.ts`
- Create: `src/components/automation-editor/validation.test.ts`
- Modify: `src/lib/automations/validate.ts`
- Modify: `src/lib/flows/validate.ts`

**Step 1: Write failing validation tests**

Cover shared invariants:

- exactly one trigger/start representation;
- unique node and edge ids;
- no dangling edge endpoints;
- unreachable node warnings;
- protected start node;
- missing required config surfaced with node and field identity.

Cover rule constraints:

- one inbound edge per non-trigger node;
- only condition handles can branch;
- condition handles allow at most one target each;
- cycles and disconnected graph shapes are blocking errors.

Cover flow constraints by asserting parity with `validateFlowForActivation()` for current fixtures.

**Step 2: Run focused tests and verify failure**

```bash
pnpm test -- src/components/automation-editor/validation.test.ts
```

Expected: FAIL because validation module does not exist.

**Step 3: Implement normalized validation**

Define:

```ts
export interface EditorValidationIssue {
  id: string
  severity: "error" | "warning"
  scope: "document" | "trigger" | "node" | "edge"
  nodeId?: string
  edgeId?: string
  field?: string
  message: string
}

export function validateEditorDocument(document: AutomationEditorDocument): EditorValidationIssue[]
export function canConnect(document: AutomationEditorDocument, connection: EditorConnection): ConnectionVerdict
```

Reuse current rule and flow validators for runtime-specific field checks. Normalize their output rather than duplicating Meta and engine limits.

**Step 4: Run relevant tests**

```bash
pnpm test -- src/components/automation-editor/validation.test.ts src/lib/automations/validate.test.ts src/lib/flows/validate.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/automation-editor/validation.ts src/components/automation-editor/validation.test.ts src/lib/automations/validate.ts src/lib/flows/validate.ts
git commit -m "feat: validate unified automation documents"
```

---

## Task 4: Implement reducer, history, and save revision semantics

**Files:**
- Create: `src/components/automation-editor/editor-reducer.ts`
- Create: `src/components/automation-editor/editor-reducer.test.ts`
- Create: `src/components/automation-editor/use-editor-controller.ts`
- Create: `src/components/automation-editor/use-editor-controller.test.ts`

**Step 1: Write failing reducer tests**

Test commands for:

- update metadata and trigger;
- add, move, configure, duplicate, connect, and delete node;
- select/clear selection without history entries;
- undo and redo structural commands;
- clear redo after a new command;
- coalesce repeated config edits sharing a coalescing key;
- keep viewport and selection out of document history;
- increment document revision only for authored changes.

**Step 2: Run focused test and verify failure**

```bash
pnpm test -- src/components/automation-editor/editor-reducer.test.ts
```

Expected: FAIL.

**Step 3: Implement reducer and bounded history**

Use explicit actions rather than arbitrary state setters:

```ts
type EditorAction =
  | { type: "node/add"; node: AutomationEditorNode; edge?: AutomationEditorEdge }
  | { type: "node/configure"; nodeId: string; patch: Record<string, unknown>; coalesceKey?: string }
  | { type: "node/move"; nodeId: string; position: XYPosition }
  | { type: "node/duplicate"; nodeId: string }
  | { type: "node/delete"; nodeId: string }
  | { type: "edge/connect"; edge: AutomationEditorEdge }
  | { type: "history/undo" }
  | { type: "history/redo" }
```

Cap history at 100 authored entries. Store document snapshots, not React Flow instances.

**Step 4: Write and implement controller save-race tests**

Use fake timers and a deferred promise to verify:

- debounce requests only the latest revision;
- an older response cannot mark a newer revision saved;
- save failure retains document and history;
- retry saves the current revision;
- new documents do not autosave before creation assigns an id.

The hook accepts an injected async `onSave(document, signal)` callback so behavior is testable and route-specific.

**Step 5: Run tests and typecheck**

```bash
pnpm test -- src/components/automation-editor/editor-reducer.test.ts src/components/automation-editor/use-editor-controller.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 6: Commit**

```bash
git add src/components/automation-editor/editor-reducer.ts src/components/automation-editor/editor-reducer.test.ts src/components/automation-editor/use-editor-controller.ts src/components/automation-editor/use-editor-controller.test.ts
git commit -m "feat: add editor history and autosave controller"
```

---

## Task 5: Extract shared node metadata and configuration panels

**Files:**
- Create: `src/components/automation-editor/modes.ts`
- Create: `src/components/automation-editor/rule-node-config.tsx`
- Create: `src/components/automation-editor/flow-node-config.tsx`
- Modify: `src/components/automations/automation-builder.tsx`
- Modify: `src/components/flows/forms/node-config-form.tsx`
- Modify: `src/components/flows/shared.tsx`

**Step 1: Define the mode registry contract**

```ts
export interface AutomationEditorModeDefinition {
  mode: AutomationEditorMode
  nodeKinds: string[]
  getNodeMeta(kind: string): EditorNodeMeta
  createNode(kind: string): AutomationEditorNode
  renderNodeConfig(props: EditorNodeConfigProps): ReactNode
}
```

Keep labels localized at render time. Metadata exposes category, icon, summary, ports, terminal state, and whether the node can be duplicated/deleted.

**Step 2: Extract rule configuration UI**

Move `StepConfig`, `previewFor`, and the minimum resource-backed field components needed by the inspector into `rule-node-config.tsx`. Preserve `ResourcesProvider` behavior and current WhatsApp interactive builder integration. Update the old builder to import the extracted component so extraction can be verified before replacement.

**Step 3: Wrap flow configuration UI**

Keep `NodeConfigForm` as the source of truth. Add a thin adapter component translating normalized node props to `BuilderNode` and config patches.

**Step 4: Add mode registry tests where logic is pure**

Assert every existing rule and flow node kind has metadata and a valid default config. Do not snapshot large React trees.

**Step 5: Run focused and existing tests**

```bash
pnpm test -- src/components/flows/shared.test.ts src/components/flows/flow-editor-state.test.ts src/components/automation-editor
pnpm typecheck
```

Expected: PASS with no behavior change in existing pages.

**Step 6: Commit**

```bash
git add src/components/automation-editor/modes.ts src/components/automation-editor/rule-node-config.tsx src/components/automation-editor/flow-node-config.tsx src/components/automations/automation-builder.tsx src/components/flows/forms/node-config-form.tsx src/components/flows/shared.tsx
git commit -m "refactor: share automation node configuration"
```

---

## Task 6: Build the unified canvas, nodes, and edges

**Files:**
- Create: `src/components/automation-editor/automation-editor.tsx`
- Create: `src/components/automation-editor/editor-canvas.tsx`
- Create: `src/components/automation-editor/editor-node.tsx`
- Create: `src/components/automation-editor/editor-edge.tsx`
- Create: `src/components/automation-editor/editor-empty-step.tsx`
- Create: `src/components/automation-editor/editor-canvas.test.tsx`
- Modify: `src/components/flows/flow-canvas.tsx`

**Step 1: Write failing interaction tests for pure/component-accessible behavior**

Test the shell-level behavior that does not require browser geometry:

- trigger/start node renders first;
- empty document renders “Choose first step”;
- selecting a palette item dispatches one node and connecting edge;
- selected node exposes `aria-selected`;
- deleting a non-start node removes attached edges;
- invalid connection surfaces its verdict and does not dispatch.

Mock React Flow only at its boundary; keep reducer and adapter behavior real.

**Step 2: Run focused test and verify failure**

```bash
pnpm test -- src/components/automation-editor/editor-canvas.test.tsx
```

Expected: FAIL.

**Step 3: Implement React Flow mapping**

Map normalized nodes and edges into `@xyflow/react` types. Reuse current Dagre layout helpers only for documents lacking meaningful positions. Persist drag-stop positions through one reducer command. Use `connectionMode="loose"` only if required by branch handles; otherwise keep strict directional handles.

**Step 4: Implement accessible editor nodes**

Render icon, localized label, summary, validation badge, ports, contextual duplicate/delete actions, and selected/focused state. Use semantic tokens only; do not copy the current per-node rainbow hue system into the unified shell. Reserve brand blue for selected/creation state and semantic colors for warnings/errors.

**Step 5: Implement empty first-step affordance and edges**

Place a dashed first-step card after the trigger when no action node exists. Edges use a clear neutral stroke and brand-blue active state. Do not add gradients or decorative motion.

**Step 6: Retire duplicated canvas implementation after parity**

Change `flow-canvas.tsx` into a compatibility wrapper at this stage. Remove its internal node/edge/sheet implementation only after the unified canvas is mounted by the flow route in Task 10. Remove usages before removing imports.

**Step 7: Run tests and typecheck**

```bash
pnpm test -- src/components/automation-editor/editor-canvas.test.tsx src/components/flows/shared.test.ts src/lib/flows/layout.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 8: Commit**

```bash
git add src/components/automation-editor src/components/flows/flow-canvas.tsx
git commit -m "feat: build unified automation canvas"
```

---

## Task 7: Build command bar, palette, inspector, and validation UI

**Files:**
- Create: `src/components/automation-editor/editor-header.tsx`
- Create: `src/components/automation-editor/step-palette.tsx`
- Create: `src/components/automation-editor/node-inspector.tsx`
- Create: `src/components/automation-editor/canvas-controls.tsx`
- Create: `src/components/automation-editor/validation-summary.tsx`
- Create: `src/components/automation-editor/editor-chrome.test.tsx`
- Modify: `src/components/flows/header.tsx`
- Modify: `src/components/flows/validation-panel.tsx`

**Step 1: Write failing chrome interaction tests**

Cover:

- palette search filters localized labels and keywords;
- category headings come from mode metadata;
- inspector renders the selected mode-specific form;
- validation issue selects and focuses its node;
- undo/redo disabled state reflects history;
- save state exposes an `aria-live` announcement;
- error state exposes retry;
- icon-only controls have accessible labels and tooltips.

**Step 2: Run test and verify failure**

```bash
pnpm test -- src/components/automation-editor/editor-chrome.test.tsx
```

Expected: FAIL.

**Step 3: Implement command bar**

Include back, editable name, mode label, save status, validation summary trigger, undo, redo, and route-provided status action. Use existing shadcn/base-ui primitives and project tokens. Avoid adding dependencies.

**Step 4: Implement responsive palette and inspector**

Use a popover/dropdown presentation on desktop and the existing `Sheet` primitive on compact viewports. The inspector is a fixed right panel at desktop widths and a bottom sheet below the dashboard breakpoint. Restore focus to the invoking control when transient surfaces close.

**Step 5: Implement validation summary and canvas controls**

Issue clicks select the node and call React Flow `fitView`/`setCenter`. Controls include add, zoom, fit, and help. Help lists keyboard commands and editing constraints.

**Step 6: Add restrained motion**

Use existing Tailwind transition utilities:

- active press scale only;
- transform-origin-aware palette/inspector entrance under 250ms;
- `motion-reduce:transform-none` and reduced opacity duration;
- hover motion only through `@media (hover: hover) and (pointer: fine)` compatible utilities/classes.

**Step 7: Run tests and typecheck**

```bash
pnpm test -- src/components/automation-editor/editor-chrome.test.tsx
pnpm typecheck
```

Expected: PASS.

**Step 8: Commit**

```bash
git add src/components/automation-editor src/components/flows/header.tsx src/components/flows/validation-panel.tsx
git commit -m "feat: add unified editor controls and inspector"
```

---

## Task 8: Add keyboard commands and unsaved-change protection

**Files:**
- Create: `src/components/automation-editor/use-editor-shortcuts.ts`
- Create: `src/components/automation-editor/use-editor-shortcuts.test.ts`
- Create: `src/components/automation-editor/use-unsaved-guard.ts`
- Create: `src/components/automation-editor/use-unsaved-guard.test.ts`
- Modify: `src/components/automation-editor/automation-editor.tsx`

**Step 1: Write failing shortcut tests**

Cover:

- Command/Ctrl+S prevents default and requests save;
- Command/Ctrl+Z, Command/Ctrl+Shift+Z, and Ctrl+Y map correctly;
- Delete/Backspace ignores start nodes and editable targets;
- Escape closes palette/inspector before clearing selection;
- IME composition and keyCode 229 never trigger editor commands from editable controls.

**Step 2: Implement shortcuts through reducer/controller callbacks**

Register one window listener while the editor is mounted. Use stable callbacks and remove the listener on cleanup. Never manipulate React Flow state outside the controller.

**Step 3: Write and implement unsaved guard tests**

Guard `beforeunload` for dirty documents. For in-app back navigation and the editor back button, show the project dialog only when leaving would discard a revision not saved or queued. Saving, retrying, or remaining on the page must preserve history.

**Step 4: Run focused tests**

```bash
pnpm test -- src/components/automation-editor/use-editor-shortcuts.test.ts src/components/automation-editor/use-unsaved-guard.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/components/automation-editor/use-editor-shortcuts.ts src/components/automation-editor/use-editor-shortcuts.test.ts src/components/automation-editor/use-unsaved-guard.ts src/components/automation-editor/use-unsaved-guard.test.ts src/components/automation-editor/automation-editor.tsx
git commit -m "feat: add editor shortcuts and leave protection"
```

---

## Task 9: Route rule automations through the unified shell

**Files:**
- Modify: `src/components/automations/automation-builder.tsx`
- Modify: `src/app/(dashboard)/automations/new/page.tsx`
- Modify: `src/app/(dashboard)/automations/[id]/edit/page.tsx`
- Modify: `src/messages/en.json`
- Modify: other locale message files matching the existing `Automations` namespace

**Step 1: Introduce the rule editor wrapper**

Keep `AutomationBuilder` as the route-facing export initially, but make it:

1. adapt `BuilderInitial` into `AutomationEditorDocument`;
2. pass the rule mode definition to `AutomationEditor`;
3. serialize via `documentToRulePayload()`;
4. call the existing POST/PUT endpoints;
5. preserve existing activation behavior and resource loading.

For new documents, create explicitly through the existing endpoint, update the document id from the response, then allow autosave.

**Step 2: Update route loading without `useEffect` fetches**

Move edit-page loading to a server component or existing RSC data helper where authentication and account scoping already live. Await Next.js 16 `params`. Pass serialized initial data into the client editor wrapper. Do not introduce SWR solely for one-time server-owned route data.

**Step 3: Add localized editor copy**

Add command, save-state, palette, validation, help, inspector, and leave-dialog keys. Reuse existing automation step labels where possible. Update every locale file that currently defines the namespace; do not leave runtime fallback strings.

**Step 4: Run rule-focused tests and checks**

```bash
pnpm test -- src/components/automation-editor src/lib/automations/validate.test.ts src/lib/automations/engine.test.ts
pnpm typecheck
pnpm lint
```

Expected: PASS.

**Step 5: Browser checkpoint for rule mode**

Use the `agent-browser` skill at `1208x457` with dark color scheme. Verify:

- existing automation loads;
- empty new automation shows trigger + first-step affordance;
- add/configure/connect/duplicate/delete;
- undo/redo and keyboard save;
- validation navigation;
- autosave status and failure retry path where practical;
- compact inspector/palette behavior at 767px;
- screenshot has no clipping, overlay collision, or unreadable contrast.

**Step 6: Commit**

```bash
git add src/components/automations/automation-builder.tsx src/app/'(dashboard)'/automations/new/page.tsx src/app/'(dashboard)'/automations/'[id]'/edit/page.tsx src/messages
git commit -m "feat: use unified editor for rule automations"
```

---

## Task 10: Route conversation flows through the unified shell

**Files:**
- Modify: `src/components/flows/flow-editor-shell.tsx`
- Modify: `src/components/flows/flow-editor-state.tsx`
- Modify: `src/components/flows/flow-builder.tsx`
- Modify: `src/components/flows/flow-canvas.tsx`
- Modify: `src/app/(dashboard)/automations/flows/[id]/page.tsx`
- Modify: `src/messages/en.json`
- Modify: other locale message files matching the existing `Flows` namespace

**Step 1: Mount unified editor with the flow adapter**

Adapt `initialFlow` and `initialNodes`, use the flow mode definition, serialize through `documentToFlowPayload()`, and call the existing `/api/flows/:id` and activation endpoints. Keep validation parity and status transitions.

**Step 2: Remove localStorage-dependent alternate editing state**

The unified shell is the editing surface on every viewport. Remove the canvas/list preference and mobile list fallback from `flow-editor-shell.tsx`. If list view remains useful, expose it as a read-only inspection mode backed by the same normalized document; otherwise remove the toggle and retain `flow-builder.tsx` only until no import remains.

**Step 3: Retire duplicated flow state after usage removal**

Move any still-needed defaults/helpers into the mode adapter. Remove usages of `FlowEditorProvider` and old mutations before deleting dead imports or code. Keep `defaultConfigFor`, node summaries, and validators in their reusable homes.

**Step 4: Update localized copy**

Reuse the shared editor namespace and retain flow-specific node/trigger labels. Update all existing locale files.

**Step 5: Run flow-focused and full tests**

```bash
pnpm test -- src/components/automation-editor src/components/flows src/lib/flows
pnpm test
pnpm typecheck
pnpm lint
```

Expected: PASS.

**Step 6: Browser checkpoint for flow mode**

Use `agent-browser` with the active preview viewport and dark scheme. Verify branch handles, button/list targets, condition edges, drag persistence, inspector forms, validation navigation, status activation, compact sheet behavior, keyboard-only operation, and reduced-motion preference.

**Step 7: Commit**

```bash
git add src/components/flows src/app/'(dashboard)'/automations/flows/'[id]'/page.tsx src/messages
git commit -m "feat: use unified editor for conversation flows"
```

---

## Task 11: Final accessibility, responsive, and regression verification

**Files:**
- Modify only files identified by failing checks or browser verification.

**Step 1: Run the full automated suite**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all commands exit 0.

**Step 2: Verify both primary paths in browser**

Using the `agent-browser` skill:

1. Match `1208x457` and dark color scheme.
2. Open a rule automation and a conversation flow.
3. Exercise add → configure → connect → duplicate → delete → undo → redo → save.
4. Confirm activation is blocked only by blocking validation errors.
5. Confirm focus order and visible focus indicators.
6. Confirm Escape priority, editable-field shortcut exclusions, and screen-reader labels in the accessibility snapshot.
7. Repeat at 767px and a narrow mobile width.
8. Repeat with reduced motion.
9. Capture screenshots for both modes and inspect for clipping and contrast.

**Step 3: Inspect runtime logs**

Read `user_read_only_context/v0_debug_logs.log` and distinguish current errors from stale pre-restart output. Fix only reproducible current errors.

**Step 4: Re-run affected tests after each fix**

Run the narrowest affected test first, then:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

**Step 5: Review diff boundaries**

```bash
git status --short
git diff --check
git diff --stat
```

Confirm there is no database migration, persistence format change, runtime semantic change, new dependency, direct color proliferation, gradient, or unrelated refactor.

**Step 6: Commit final fixes**

Stage each file listed by `git status --short` only after confirming it belongs to a verification fix, then commit:

```bash
git commit -m "fix: harden unified automation editor"
```

---

## Implementation review checkpoints

Pause for review after:

1. Tasks 1–4: domain, adapters, validation, history, and autosave semantics.
2. Tasks 5–8: shared UI, canvas, chrome, shortcuts, and leave protection.
3. Task 9: rule automation migration and browser verification.
4. Task 10: conversation-flow migration and browser verification.
5. Task 11: full regression and accessibility verification.

At each checkpoint, report changed files, tests run, browser paths exercised, known limitations, and the next task. Do not proceed past a checkpoint if adapters lose fields, runtime validators diverge, or save revision tests are flaky.
