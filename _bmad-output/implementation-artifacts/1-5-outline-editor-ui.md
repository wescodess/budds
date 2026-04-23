# Story 1.5: Outline Editor UI

Status: ready-for-dev

## Story

As a user,
I want to review and edit the AI-generated outline before starting,
So that I can customize my learning path.

## Acceptance Criteria

1. **Given** an outline has been generated for a course (status: 'ready')
   **When** the user views the outline editor
   **Then** sections are displayed as a vertically stacked draggable list with: drag handle (⠿), order number, section title, knowledge type badge pill, and remove button (✕)

2. **Given** the outline editor is displayed
   **When** the user drags a section via the drag handle
   **Then** the section reorders in the list with smooth animation
   **And** the `courses.outlineSections` and `courseSections` order fields are updated in Convex

3. **Given** a section row in the outline
   **When** the user clicks the section title
   **Then** it becomes an inline editable text field
   **And** pressing Enter or clicking away saves the updated title to `courses.outlineSections` and `courseSections.title`

4. **Given** a knowledge type badge on a section row
   **When** the user clicks the badge
   **Then** it cycles through types: factual → conceptual → procedural → mixed → factual
   **And** the change is saved to both `courses.outlineSections[].knowledgeType` and `courseSections.knowledgeType`

5. **Given** a section row with a ✕ remove button
   **When** the user clicks ✕
   **Then** the section is removed from the outline
   **And** the corresponding `courseSections` record is deleted from Convex
   **And** `courses.outlineSections` is updated to remove the section
   **And** `courses.totalSectionCount` is decremented
   **And** remaining sections are re-ordered

6. **Given** the "+ Add Section" button below the list
   **When** the user clicks it
   **Then** a new section is appended with a default title "New Section", knowledgeType "mixed", and status "locked"
   **And** the title field immediately enters inline edit mode
   **And** `courses.outlineSections` and `totalSectionCount` are updated
   **And** a new `courseSections` record is created

7. **Given** the source confidence card at the top of the editor
   **When** the outline loads
   **Then** it displays "Draws from N of your documents" for folder/cross-folder courses (using `sourceConfidence.docCount`)
   **Or** "Built from web sources" for web-only courses

8. **Given** the section count badge in the header
   **When** sections are added or removed
   **Then** the badge updates reactively (e.g. "12 sections" → "11 sections")

9. **Given** the Convex mutations needed for editing
   **When** the editor performs operations
   **Then** `courses.updateOutline` mutation accepts `{ courseId, outlineSections, totalSectionCount }` and patches the course
   **And** `courseSections.updateTitle` mutation updates a single section's title
   **And** `courseSections.updateKnowledgeType` mutation updates a single section's knowledgeType
   **And** `courseSections.remove` mutation deletes a section and re-orders siblings
   **And** `courseSections.create` mutation creates a new section with the next order value
   **And** all mutations verify course ownership

10. **Given** the component tests
    **When** `pnpm test:component` runs
    **Then** tests cover: section list rendering, inline title editing, knowledge type cycling, section removal, section addition, source confidence display, section count badge reactivity

## UI Design Assets

- Stitch screen: `learn-outline-editor` (project: 15806072973690193332, screen: 66be23d5db5c4db1b9101633357e0c70)
- Design direction: Compact List — centered single column (max-w-2xl), dark theme
- Section rows: flat list with subtle bottom borders, drag handle + order + title + badge + ✕
- Source confidence: muted card (#292524) at top
- Amber CTA button at bottom (Start Learning is Story 1.6 — this story only renders the outline editor portion)

## Tasks / Subtasks

- [ ] **Task 1: Create Convex mutations for outline editing** (AC: #9)
  - [ ] `courses.updateOutline` — patch outlineSections + totalSectionCount with ownership guard
  - [ ] `courseSections.updateTitle` — update single section title with ownership guard
  - [ ] `courseSections.updateKnowledgeType` — update single section knowledgeType with ownership guard
  - [ ] `courseSections.remove` — delete section, re-order siblings, update course outline
  - [ ] `courseSections.create` — create new section at next order, update course outline

- [ ] **Task 2: Create `app/components/learn/OutlineEditor.vue`** (AC: #1, #7, #8)
  - [ ] Props: `courseId`, `outlineSections`, `sourceConfidence`, `sourceType`
  - [ ] Render header with "Course Outline" + section count badge
  - [ ] Render source confidence card
  - [ ] Render section list with drag handles, order numbers, titles, badges, remove buttons

- [ ] **Task 3: Implement drag-to-reorder** (AC: #2)
  - [ ] Use VueDraggable or native drag events for section reordering
  - [ ] On drop: update local order, call `courses.updateOutline` + batch `courseSections` order patches

- [ ] **Task 4: Implement inline title editing** (AC: #3)
  - [ ] Click title → show input field, Enter/blur → save via `courseSections.updateTitle`
  - [ ] Escape → cancel edit

- [ ] **Task 5: Implement knowledge type cycling** (AC: #4)
  - [ ] Click badge → cycle factual→conceptual→procedural→mixed→factual
  - [ ] Save via `courseSections.updateKnowledgeType`

- [ ] **Task 6: Implement section remove and add** (AC: #5, #6)
  - [ ] ✕ click → call `courseSections.remove`
  - [ ] "+ Add Section" → call `courseSections.create`, auto-focus new title

- [ ] **Task 7: Write component tests** (AC: #10)
  - [ ] Test section list renders correct number of rows
  - [ ] Test inline title edit flow
  - [ ] Test knowledge type badge cycling
  - [ ] Test section removal updates count
  - [ ] Test add section creates new row
  - [ ] Test source confidence card content

## Dev Notes

- This component will be embedded in the Course Creator full flow (Story 1.7) — build it as a standalone component with clear props interface
- Drag-to-reorder: check if @vueuse/core has drag utilities, or use vuedraggable
- The "Start Learning" button and pace selector belong to Story 1.6 — this story focuses on the outline editing surface only
- Follow existing component patterns: no Reka-portaled primitives inside the editor (V1.x standing rule from V1.2 retros)
- Knowledge type badges use muted background (#292524) with muted text (#a8a29e), matching the Stitch design
