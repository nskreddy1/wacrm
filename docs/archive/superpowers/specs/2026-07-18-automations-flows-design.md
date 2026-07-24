# Automations Flows-Style Migration Design

## Goal

Migrate the Automations index page to the same visual structure and interaction model as the existing Flows index page. The two pages should feel like sibling resource pages while retaining their separate domain logic, copy, routes, and actions.

## Scope

- Redesign `src/app/(dashboard)/automations/page.tsx` to match the Flows page layout.
- Preserve existing automation data loading, creation, execution, editing, deletion, and status behavior.
- Move automation templates from the inline page layout into the Create Automation dialog.
- Reuse or extract focused shared presentation components when this prevents visual drift without forcing unrelated feature logic together.
- Keep the existing dashboard navigation, theme tokens, typography, and responsive conventions.

## Page Structure

The Automations page will mirror the Flows page in this order:

1. Page header with automation-specific title, description, and primary Create Automation action.
2. The same search and filtering treatment used by Flows, adapted to automation fields and statuses.
3. The same responsive resource-card grid and card hierarchy used by Flows.
4. The same empty-state composition when no automations exist or no results match filters.
5. A Create Automation dialog matching the Flows creation dialog structure.

Only the domain content changes: automation labels, trigger/action summaries, status, timestamps, menu actions, and navigation targets remain automation-specific.

## Create Automation Dialog

The dialog will become the sole entry point for starting an automation from the index page. It will use the same container, spacing, heading hierarchy, controls, and responsive behavior as the Flows create dialog.

The dialog will present:

- A blank automation option.
- Existing automation templates, moved from the inline page layout.
- Existing routes or creation handlers for each choice.

Closing the dialog must preserve the page state. Selecting an option should follow the current automation creation behavior rather than introducing a new persistence path.

## Components and Boundaries

The implementation should prefer targeted reuse over either full duplication or a broad generic-resource abstraction.

- Feature logic remains in the Automations page or automation-specific components.
- Small visual patterns shared with Flows may be extracted when both pages can consume them without domain conditionals.
- Shared components should accept content and callbacks through explicit props.
- No Flows business logic should be imported into Automations.

This keeps both features independently understandable while ensuring their design remains aligned.

## Interaction and Motion

- Match the Flows page interactions exactly wherever the same control exists.
- Retain immediate press feedback and current dashboard transition conventions.
- Do not add decorative animation or long page-entry sequences.
- Any movement must use transform and opacity, remain brief, and respect reduced-motion preferences.
- Keyboard-driven and high-frequency actions should remain instant.

## Accessibility

- Preserve semantic headings and button labels.
- Search and filter controls must retain accessible names.
- Dialog focus trapping, close behavior, and keyboard support must use the existing dialog primitives.
- Card menus and status indicators must remain understandable without relying on color alone.
- Empty states and filtered-result messages must be exposed as normal readable content.

## Data and Error Handling

No schema or backend migration is required. This is a presentation migration over the existing automation feature.

- Existing loading, success, and error states remain authoritative.
- Failed mutations continue to use the current error notification path.
- Existing cache invalidation or refresh behavior remains unchanged.
- Search and filters operate on already-loaded automation data unless the current page uses server-backed filtering.

## Responsive Behavior

The page should follow the same breakpoints and card-grid behavior as Flows:

- Controls stack cleanly on narrow screens.
- The primary action remains discoverable without horizontal overflow.
- Cards use the same responsive column count and minimum sizing as Flows.
- Dialog content remains usable at mobile viewport heights and scrolls internally when needed.

## Verification

- Compare Flows and Automations side by side at desktop and mobile widths.
- Confirm matching header geometry, controls, card dimensions, spacing, empty state, and dialog composition.
- Exercise blank creation and every migrated template option.
- Exercise search, filters, card navigation, edit/run actions, and deletion where available.
- Confirm loading, empty, no-results, and error states.
- Run the project type check or build and verify the page in the browser in dark mode.

## Out of Scope

- Redesigning the automation builder/editor pages.
- Changing automation database schemas, APIs, execution semantics, or permissions.
- Converting existing automations into Flows.
- Redesigning the Flows page itself.
- Broad dashboard visual refactoring unrelated to these two index pages.
