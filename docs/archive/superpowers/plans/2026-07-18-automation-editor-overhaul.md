# Automation Editor Overhaul Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-18-automation-editor-overhaul-design.md`

## Objective

Replace the current page-style Automation builder with a Flow-style, full-height editor that keeps Canvas and List views synchronized while preserving the existing automation payloads and backend behavior.

## Implementation constraints

- Keep `/api/automations` POST and `/api/automations/[id]` PATCH contracts unchanged.
- Do not modify Supabase schema or runtime automation execution.
- Do not change Flow editor behavior.
- Keep the current automation trigger and step configuration controls authoritative.
- Keep graph operations representable by the nested automation step model.
- Use existing `@xyflow/react`, `@dagrejs/dagre`, shadcn primitives, design tokens, and localization patterns; no new dependencies are expected.

## Task 1: Extract the automation editor model and pure tree operations

**Files**

- Create: `src/components/automations/automation-editor-types.ts`
- Create: `src/lib/automations/editor-graph.ts`
- Create: `src/lib/automations/editor-graph.test.ts`
- Modify: `src/components/automations/automation-builder.tsx`

**Steps**

1. Move `BuilderInitial`, `BuilderStep`, and editor-only supporting types out of the monolithic builder into `automation-editor-types.ts` without changing their serialized shape.
2. Define stable graph node kinds, branch identifiers, and graph mutation result/error types.
3. Implement pure traversal helpers for finding a node, finding its parent and branch, checking ancestry, removing a subtree, and inserting a subtree at a deterministic position.
4. Implement `automationTreeToGraph` with stable IDs for trigger, steps, branch handles, and edges.
5. Implement a reconnect/reorder function that returns either a replacement automation tree or a typed rejection reason.
6. Enforce one root trigger, one parent per step, no self-links, no cycles, no insertion into descendants, deterministic sibling order, and valid Yes/No ownership.
7. Add Vitest coverage for conversion, stable IDs, branch mapping, valid moves, every rejection case, sibling order, and serialization-compatible round trips.
8. Update the existing builder imports to use the extracted types, confirming no behavior change before UI work begins.

**Verification**

- `pnpm test src/lib/automations/editor-graph.test.ts`
- `pnpm typecheck`

## Task 2: Introduce one shared Automation editor state provider

**Files**

- Create: `src/components/automations/automation-editor-state.tsx`
- Modify: `src/components/automations/automation-builder.tsx`

**Steps**

1. Create `AutomationEditorProvider` and `useAutomationEditor` following the proven Flow provider boundary without importing Flow state.
2. Move mutable automation state, selection, dirty state, saving state, save error, validation feedback, and active view into the provider.
3. Expose focused actions for metadata updates, trigger updates, step configuration, add/delete/move/reconnect, selection, and view changes.
4. Move existing POST/PATCH serialization and save behavior into the provider unchanged.
5. Preserve edits after save failure; clear dirty state only after a successful response.
6. Refactor the existing builder to consume provider state and actions as the List view instead of owning local editor state.
7. Keep the current trigger and step form components and payload construction behavior intact.

**Verification**

- Existing List editor can create and edit the same payload as before.
- `pnpm typecheck`
- `pnpm test`

## Task 3: Build the full-height shell and header

**Files**

- Create: `src/components/automations/automation-editor-shell.tsx`
- Create: `src/components/automations/automation-editor-header.tsx`
- Modify: `src/components/automations/automation-builder.tsx`
- Modify: `src/app/(dashboard)/automations/new/page.tsx`
- Modify: `src/app/(dashboard)/automations/[id]/edit/page.tsx`

**Steps**

1. Reproduce the Flow editor page composition: full-height workspace, editor header, body, and bottom validation/status region.
2. Add back navigation, editable name/status presentation, dirty/saving/saved/error indicators, and the existing save action.
3. Add accessible Canvas/List view controls whose state comes from the provider.
4. Render the refactored current builder as `AutomationListEditor` inside the shell.
5. Keep both new and edit route data-loading behavior and initial values unchanged while replacing their rendered root with `AutomationEditorShell`.
6. Add a narrow-viewport guard that keeps List view usable and hides or disables Canvas with explanatory copy.
7. Use only existing semantic theme tokens and existing typography; keep motion short, transform/opacity-only, and reduced-motion aware.

**Verification**

- New and edit routes fill the available dashboard workspace.
- Header save state stays synchronized with List edits.
- Narrow viewport remains usable without canvas overflow.
- `pnpm lint`
- `pnpm typecheck`

## Task 4: Implement the Automation canvas and node renderers

**Files**

- Create: `src/components/automations/automation-canvas.tsx`
- Create: `src/components/automations/automation-nodes.tsx`
- Create: `src/components/automations/automation-node-panel.tsx`
- Modify: `src/components/automations/automation-editor-shell.tsx`
- Modify: `src/components/automations/automation-builder.tsx`

**Steps**

1. Add a React Flow provider and canvas body using the existing Flow canvas controls, background, minimap, layout strategy, and token system as the visual reference.
2. Derive canvas nodes and edges from provider state via `automationTreeToGraph`; do not introduce a second mutable graph model.
3. Implement trigger, action, and branch-capable node renderers with stable handles, selected/invalid states, accessible labels, and automation-specific summaries.
4. On canvas node selection, open `AutomationNodePanel` with the existing trigger or step configuration control.
5. Route panel edits directly through provider actions so List view updates immediately.
6. Wire valid reconnect/reorder events through the pure graph utility and replace provider tree state only on success.
7. Reject invalid changes without mutating state and announce the typed reason through the project's toast plus an accessible live region where needed.
8. Fit the graph after initial render and structural changes without overriding deliberate user pan/zoom during ordinary field edits.
9. Ensure keyboard actions are immediate, pointer feedback is subtle, and `prefers-reduced-motion` removes positional motion.

**Verification**

- Canvas and List show the same trigger, steps, order, and branches.
- Canvas selection opens the correct existing configuration editor.
- A valid move updates List immediately.
- Invalid cycles, parents, and branch links leave state untouched.
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test src/lib/automations/editor-graph.test.ts`

## Task 5: Add localization and complete regression verification

**Files**

- Modify: `messages/en.json`
- Modify as required: automation editor files from Tasks 2–4

**Steps**

1. Add messages for Canvas/List controls, viewport fallback, save states, panel labels, graph rejection reasons, and accessible announcements under the existing `Automations` namespace.
2. Replace any newly introduced hard-coded user-facing text with `next-intl` lookups.
3. Run formatting, linting, type checking, and the full test suite.
4. Use `agent-browser` at 1208×682 with dark color scheme to verify the new automation create/edit flow.
5. Exercise List editing, Canvas synchronization, node configuration, one valid move, one invalid reconnect, save, reload, and persistence.
6. Repeat at a narrow viewport to verify the List fallback.
7. Open the existing Flow editor and smoke-test its list/canvas switch and render for regressions.
8. Inspect screenshots for clipping, nested scrolling, panel overlap, contrast, focus visibility, and responsive layout defects; correct only issues in the implemented scope.

**Verification commands**

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

## Completion criteria

- Automation new/edit routes use the new full-height shell.
- Canvas and List are synchronized through one provider-owned tree.
- Existing configuration forms and API payloads are preserved.
- Valid graph changes persist after save/reload.
- Invalid graph changes are non-destructive and accessible.
- Narrow viewports receive a complete List editing experience.
- New text is localized.
- Unit tests, static checks, build, browser path, and Flow regression smoke test pass.
