# Story prep-3-2: Add aria-labels to OutlineEditor interactive elements

## Status: ready-for-dev

## Epic
Prep Sprint — Epic 3 (mandatory before Epic 3)

## Story
As a user relying on assistive technology,
I want all interactive elements in the OutlineEditor to have accessible names,
So that I can understand and operate the outline editor with a screen reader.

## Acceptance Criteria

**AC1: Remove Button Accessible Name**
Given the OutlineEditor renders a section row
When a screen reader encounters the remove button (X icon)
Then the button has an aria-label describing its purpose including the section title (e.g., "Remove section Functional Groups")

**AC2: Title Edit Input Accessible Name**
Given the user clicks a section title to enter edit mode
When the inline input appears
Then the input has an aria-label of "Section title"

**AC3: Knowledge Type Badge Accessible Name**
Given the OutlineEditor renders a section row
When a screen reader encounters the knowledge type badge button
Then the button has an aria-label describing its purpose and current value (e.g., "Cycle knowledge type, currently factual")

**AC4: Drag Handle Accessibility**
Given the OutlineEditor renders a section row
When a screen reader encounters the drag handle icon
Then the icon is marked aria-hidden="true" since the parent row is draggable

**AC5: No Unlabeled Interactive Elements**
Given the OutlineEditor is fully rendered
When audited for WCAG 2.1 Level A compliance
Then no interactive element (button, input) lacks an accessible name

## Tasks

### Task 1: Add aria-label to remove button
- File: `app/components/learn/OutlineEditor.vue`
- Add `aria-label` with template literal including section title

### Task 2: Add aria-label to title edit input
- File: `app/components/learn/OutlineEditor.vue`
- Add `aria-label="Section title"` to the inline editing input

### Task 3: Add aria-label to knowledge type badge button
- File: `app/components/learn/OutlineEditor.vue`
- Add `aria-label` with template literal including current knowledge type

### Task 4: Add aria-hidden to drag handle icon
- File: `app/components/learn/OutlineEditor.vue`
- Add `aria-hidden="true"` to GripVertical icon since the row itself is draggable

### Task 5: Update component tests to verify aria-labels
- File: `tests/component/learn/outline-editor.test.ts`
- Add tests querying by role + accessible name for remove button, title input, and knowledge type badge
- Verify drag handle has aria-hidden="true"

### Task 6: Run pnpm test:component and verify no regressions

## Dev Agent Record

### Decisions
(none yet)

## File List
- `app/components/learn/OutlineEditor.vue`
- `tests/component/learn/outline-editor.test.ts`

## Change Log
(none yet)
