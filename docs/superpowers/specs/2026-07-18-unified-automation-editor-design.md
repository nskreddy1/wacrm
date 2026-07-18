# Unified Automation Editor Design

## Objective

Build a production-complete unified automation editor shell that presents rule automations and conversation flows through one coherent node-canvas experience while preserving their existing persistence APIs and runtime payloads.

This release does not introduce a database migration, a new execution engine, collaboration, simulation, or versioned publishing. It establishes the editor architecture those features can build on later.

## Success criteria

- Existing rule automations and conversation flows open in the same editor shell.
- Users can add, select, configure, connect, duplicate, and delete supported nodes.
- Trigger/start nodes remain explicit and protected from invalid deletion.
- Undo and redo cover all document mutations made during the current editor session.
- Keyboard shortcuts, validation, autosave feedback, save failure recovery, and responsive fallbacks are complete.
- Existing save endpoints receive payloads in their current formats.
- Existing runtimes continue to execute unchanged payloads.
- The editor is fully usable with keyboard navigation and honors reduced-motion preferences.

## Architecture

### Normalized editor document

The UI operates on one normalized in-memory document:

```ts
type AutomationEditorMode = "rule" | "flow"

type AutomationEditorDocument = {
  id?: string
  mode: AutomationEditorMode
  name: string
  description: string
  status: "draft" | "active" | "inactive"
  nodes: AutomationEditorNode[]
  edges: AutomationEditorEdge[]
  revision: number
}

type AutomationEditorNode = {
  id: string
  kind: string
  position: { x: number; y: number }
  config: Record<string, unknown>
  sourceRef?: string
}

type AutomationEditorEdge = {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}
```

`sourceRef` retains the original rule step identity or flow `node_key` when available. The normalized model is editor-facing only and is not persisted directly in this release.

### Compatibility adapters

Two adapter pairs isolate persistence differences:

- Rule adapter: existing automation payload to/from `AutomationEditorDocument`.
- Flow adapter: existing `BuilderNode` payload to/from `AutomationEditorDocument`.

Adapters are pure functions with fixture-based tests. They preserve unknown configuration fields and stable source identities so opening and saving an existing document does not silently discard data.

Rule automations remain an ordered execution graph. Their save adapter rejects graph shapes the current runtime cannot represent. Conversation flows retain explicit branch handles and `next_node_key` relationships.

### Editor state

A reducer-backed editor store owns:

- current document;
- selection;
- viewport state;
- undo and redo stacks;
- dirty revision and last saved revision;
- save lifecycle;
- validation results;
- active palette or inspector state.

All document mutations are commands dispatched through the reducer. View-only changes such as pan, zoom, inspector disclosure, and selection do not enter history. Consecutive text edits in the same field are coalesced into one history entry until focus changes or a structural command occurs.

### Existing feature reuse

The implementation reuses the current flow metadata, node summaries, node configuration forms, resource loaders, validation patterns, React Flow canvas integration, and existing API clients. The current monolithic rule builder is split only where needed to expose reusable configuration panels and adapters; unrelated refactoring is out of scope.

## Interface design

### Shell

The editor fills the available dashboard viewport and contains:

1. A top command bar with back navigation, editable automation name, mode label, save state, validation summary, undo, redo, and the existing activation or publish-equivalent action.
2. A full-height canvas as the primary workspace.
3. A contextual inspector docked on desktop and presented as a sheet on compact viewports.
4. Floating canvas controls for add step, fit view, zoom in, zoom out, and help.

The visual system uses the existing semantic design tokens. The primary brand blue is reserved for selection, creation, and primary actions; neutrals carry structure; semantic warning and error colors appear only for validation and failures. No gradients are introduced.

### Empty workflow

A new document displays an explicit trigger/start card connected to a dashed “Choose first step” card. The card offers only node categories valid for the current mode. Selecting an option creates the node, connects it where appropriate, selects it, and opens its inspector.

### Step palette

The floating add button opens an origin-aware categorized palette. Categories are generated from the existing step metadata instead of duplicated labels. Search filters by localized label and keywords. Disabled or unavailable capabilities explain their requirement rather than appearing as dead controls.

### Nodes and edges

Nodes show icon, title, concise configuration summary, validation state, and accessible selected state. Ports are visible on selection or keyboard focus and remain large enough to target. Edge creation is constrained by mode rules. Invalid connections are rejected immediately with a concise explanation and no document mutation.

The start node cannot be deleted. Deleting a selected non-start node removes its attached edges in one undoable command. Duplicate creates a new stable client id, offsets the copy, clears source identity, and does not duplicate inbound edges.

### Inspector

The inspector displays the selected node’s localized title, summary, configuration form, validation issues, advanced disclosure, duplicate action, and delete action. Field errors appear inline and in the document-level validation summary. Closing the inspector does not clear selection on desktop; Escape clears transient UI first, then selection.

### Responsive behavior

Desktop is the primary editing surface. Below the existing dashboard breakpoint, the inspector becomes a bottom sheet and the step palette becomes a searchable sheet. Canvas controls remain reachable without covering the selected node. A compact viewport never falls back to a separate editor implementation.

## Interaction and keyboard model

- Click or press Enter/Space on a node to select it.
- Delete or Backspace deletes an eligible selected node unless focus is inside an editable control.
- Command/Ctrl+Z undoes and Command/Ctrl+Shift+Z or Ctrl+Y redoes.
- Command/Ctrl+S requests an immediate save and prevents the browser save dialog.
- Escape closes palette/dialog/sheet first, then clears selection.
- Tab order reaches command bar controls, canvas controls, nodes, and inspector fields.
- Keyboard-initiated actions update instantly without decorative animation.
- Destructive actions remain reversible through undo; confirmation is reserved for leaving with unrecoverable unsaved changes.

## Autosave and failure recovery

Autosave is enabled only for existing documents with a valid current payload. It waits briefly after the latest document mutation, cancels superseded requests, and saves a revision snapshot. A late response may update its own request status but cannot mark a newer revision clean.

New documents use the existing explicit create action first; after an id is assigned, normal autosave begins. Command/Ctrl+S always attempts the latest valid revision immediately.

Save states are `saved`, `unsaved`, `saving`, and `error`. On failure, the editor retains the full local document and history, exposes a retry action, and announces the failure through an accessible live region. Navigation with unsaved changes uses the project’s existing leave-protection pattern.

## Validation

Validation is deterministic and mode-aware. Shared checks cover:

- exactly one start/trigger node;
- unique node ids;
- edges referencing existing nodes;
- required fields;
- unreachable non-start nodes;
- prohibited cycles where the target runtime does not support them.

Rule mode additionally enforces shapes representable by the current ordered-step payload. Flow mode validates branch targets and required terminal behavior using existing flow rules. Blocking errors disable activation or publish-equivalent actions but never prevent saving a draft. Warnings remain saveable and navigable.

## Motion and accessibility

Motion is restrained and functional:

- press feedback uses `transform: scale(0.97)` over 100–160ms;
- small palette and inspector entrances use transform and opacity with a strong ease-out curve and remain under 250ms;
- trigger-anchored surfaces use their trigger as transform origin;
- canvas panning, zooming, keyboard commands, and frequent node selection do not add decorative animation;
- hover motion is gated to fine pointers;
- reduced motion removes positional movement while retaining brief opacity and color feedback.

All controls have accessible names, icon-only controls provide tooltips, errors are associated with fields, focus is restored to the invoking control when transient surfaces close, and status changes are announced without stealing focus.

## Testing strategy

### Unit tests

- Round-trip fixtures for both adapter pairs.
- Preservation of unknown configuration fields and stable source identities.
- Reducer commands, history coalescing, undo, and redo.
- Mode-aware graph constraints and validation.
- Save revision race handling.

### Component tests

- Empty-state step creation.
- Palette search and category filtering.
- Node selection, configuration, duplication, deletion, and connection rejection.
- Inspector focus behavior and keyboard shortcuts.
- Save status and retry behavior.

### Browser verification

Exercise both modes in the real preview at desktop and compact widths. Verify the primary create-edit-connect-save path, keyboard-only operation, inspector sheet behavior, unsaved navigation protection, dark mode, reduced motion, and no visual overlap at the active preview viewport.

## Delivery boundaries

Included:

- unified editor shell;
- normalized in-memory document;
- rule and flow compatibility adapters;
- production-complete core editing;
- validation, history, autosave state, accessibility, and responsive inspector/palette behavior.

Excluded:

- database schema migration;
- canonical document persistence;
- new runtime compiler or execution semantics;
- immutable versions and rollback;
- collaboration and presence;
- simulator, analytics, templates marketplace, or AI generation.

These excluded capabilities may build on the normalized document after the shell proves stable.
