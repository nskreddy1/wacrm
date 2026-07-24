# Automation Editor Overhaul Design

## Status

Approved for implementation planning on July 18, 2026.

## Goal

Replicate the established Flow editor experience for Automations without changing the persisted automation model or API contract. The result will provide a full-height editor shell, synchronized Canvas and List views, safe visual graph editing, and responsive fallback behavior while preserving the existing trigger and step configuration experience.

## Scope

### Included

- A Flow-style full-height Automation editor shell and header.
- Canvas and List view switching with one shared source of truth.
- A responsive List fallback when the viewport cannot support the graph editor.
- Automation-specific React Flow nodes and edges.
- Node selection that opens the existing trigger or step editor in a side panel.
- Safe graph reconnect and reorder operations that update the nested automation tree.
- Shared dirty, saving, validation, and save-error state.
- Existing create and edit routes using the new editor shell.
- Existing POST and PATCH payload formats and persistence behavior.
- Accessible rejection feedback for invalid graph operations.
- Unit tests for graph/tree conversion and browser verification for the primary editing flow.
- Localization updates for all new user-facing labels and messages.

### Excluded

- Database migrations or changes to the automation API contract.
- Changes to Flow editor behavior.
- New automation trigger or action types.
- Execution-history, analytics, or workflow-runtime changes.
- Free-form graphs that cannot be represented by the current nested automation tree.

## Architecture

### Editor shell

`AutomationEditorShell` will own the page-level composition and mirror the existing Flow editor structure: a full-height header, view controls, editor workspace, and save status. It will consume shared editor state rather than maintain a second copy of the automation.

The shell will expose Canvas and List views on supported desktop widths. On narrow screens it will render List view and explain that visual canvas editing is available on a wider viewport. Switching views will not reset selection, edits, validation state, or dirty state.

### Shared editor state

A dedicated `AutomationEditorProvider` will own:

- The current nested automation tree.
- Automation metadata needed by the editor.
- Selected trigger or step.
- Active Canvas/List view.
- Dirty and saving state.
- Validation and save errors.
- Mutations for adding, updating, deleting, moving, and reconnecting nodes.
- Serialization to the existing create/update request payload.

The provider will initialize from the route's existing automation data and remain the only mutable source of truth. Both Canvas and List views will derive their rendering from this state.

### Graph utilities

Pure automation graph utilities will form the boundary between the persisted nested tree and React Flow:

1. `automationTreeToGraph` converts the nested model into deterministic nodes and edges.
2. `reconnectAutomationGraph` validates a proposed edge change and returns a new nested tree when valid.
3. Supporting helpers locate nodes, identify parent/branch relationships, and preserve sibling ordering.

The utilities will not import React, browser APIs, or server code. This makes cycle checks, parent rules, branch semantics, and round-trip behavior independently testable.

### Automation-specific nodes

Automation nodes will use the existing design tokens and interaction patterns from Flows while presenting automation terminology and metadata. Node types will cover:

- Trigger.
- Action/step.
- Condition or branch-capable step where represented by the current model.
- Terminal/add controls where needed by the existing editor behavior.

Nodes will provide clear selected, invalid, and disabled states. Handles will be limited to connections the nested model can represent. Yes/No branch labels will remain stable through conversion, reconnection, and saving.

### Existing configuration editors

The current trigger and step editors remain authoritative for field configuration. Selecting a graph node opens the corresponding existing editor in a side panel; List view continues to use the same controls. Configuration edits update the provider immediately and therefore appear in both views.

The current monolithic automation builder will be decomposed only where required to share its editors and state. Unrelated behavior and styling will not be refactored.

## Data flow

1. The new or edit route loads the existing initial automation data.
2. The route renders `AutomationEditorShell` with that data.
3. `AutomationEditorProvider` normalizes the data into the current nested tree representation.
4. List view reads the tree directly.
5. Canvas view derives React Flow nodes and edges through pure graph utilities.
6. Field edits mutate the tree through provider actions.
7. A valid graph reconnect produces a replacement tree through a pure utility and marks the editor dirty.
8. Save serializes the tree using the existing POST/PATCH payload contract.
9. A successful save clears dirty state and preserves the current editor context.
10. A failed save leaves edits intact and exposes an accessible error message.

## Graph invariants

Every structural mutation must preserve these rules:

- The automation has exactly one trigger/root.
- The trigger cannot have a parent.
- A non-root node has at most one parent.
- A node cannot connect to itself.
- Reconnection cannot create a cycle.
- A node cannot be moved into its own descendant subtree.
- Sibling order remains deterministic.
- Branch-capable nodes preserve valid Yes/No branch ownership.
- Connections not representable by the nested API model are rejected.
- Deleting or moving a node follows the current builder's subtree semantics rather than silently losing descendants.

## Interaction and motion

This is a frequently used professional editor, so motion will be restrained. Pressable controls receive immediate press feedback; selection, panel, and view-state changes use short transform/opacity transitions only where they prevent a jarring change. Keyboard-initiated actions will not wait for animation. All movement will respect `prefers-reduced-motion`, and hover-only motion will be limited to fine pointers.

## Responsive behavior

- Desktop: Canvas and List views are available.
- Narrow desktop/tablet/mobile: List view is authoritative and Canvas controls are hidden or disabled with explanatory text.
- The editor remains full-height without introducing nested page scrolling that conflicts with canvas pan/zoom.
- Side-panel content remains keyboard reachable and scrollable independently when necessary.

## Accessibility

- Canvas/List controls expose their selected state programmatically.
- Nodes and editor controls have accessible names and visible focus states.
- Invalid reconnects announce a concise reason through an ARIA live region or equivalent accessible toast.
- Save, saving, saved, dirty, validation, and failure states are not communicated by color alone.
- Existing form labels and validation relationships remain intact when moved into the side panel.
- Reduced-motion preferences are honored.

## Error handling

Invalid structural operations are rejected before state mutation. The prior tree remains unchanged, and the user receives a specific message such as cycle creation, invalid parent, or incompatible branch.

Save failures retain all unsaved edits, keep the editor marked dirty, and expose a retry path. Serialization or unexpected graph conversion failures surface a safe editor-level error rather than rendering a corrupt graph.

## Testing

### Unit tests

Pure graph tests will cover:

- Tree-to-graph conversion.
- Stable node and edge identifiers.
- Parent and branch mapping.
- Valid reconnect and reorder operations.
- Cycle and self-connection rejection.
- Multiple-parent rejection.
- Descendant-subtree rejection.
- Yes/No branch preservation.
- Deterministic sibling order.
- Serialization-compatible round trips.

Provider or component tests will cover shared selection, dirty-state transitions, synchronized Canvas/List edits, and save-state behavior where the existing test setup supports them.

### Browser verification

At the active desktop viewport and dark color scheme:

1. Open a new automation.
2. Configure a trigger and multiple steps in List view.
3. Switch to Canvas and confirm the same structure.
4. Select and edit a node from Canvas.
5. Perform one valid structural change and confirm List synchronization.
6. Attempt one invalid reconnect and confirm rejection feedback with no state corruption.
7. Save, reload the edit route, and confirm persistence.
8. Verify narrow-viewport List fallback.
9. Smoke-test the existing Flow editor for regressions.

## Localization

All new labels, statuses, fallback explanations, validation reasons, and error messages will be added to the project's existing message catalogs. Components will not introduce hard-coded user-facing strings when an existing localization pattern is available.

## Rollout and compatibility

The editor will continue using existing automation endpoints and persisted records, so no data migration is required. Existing automation records must open, edit, save, and reload without semantic changes. The implementation will reuse shared visual primitives where appropriate but keep automation graph/state logic isolated from Flow internals to prevent cross-feature regressions.

## Acceptance criteria

- New and existing automations open in the Flow-style full-height editor.
- Canvas and List views always represent the same in-memory automation.
- Existing configuration forms and API payloads remain functional.
- Valid reconnect/reorder operations persist after save and reload.
- Invalid graph operations never corrupt editor state and provide accessible feedback.
- Narrow viewports receive a usable List experience.
- New user-facing text is localized.
- Graph utility tests, project checks, primary browser path, and Flow smoke test pass.
