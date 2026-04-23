# Story: 4-1-course-view-with-progress-and-mastery-dashboard

## Status: review

## Epic: Epic 4 - Progress Tracking, Mastery & Content Quality (MVP)

## Title: Course View with Progress & Mastery Dashboard

## Description

As a user,
I want to see my progress through a course with mastery indicators per section,
So that I know what I've learned and what's next.

## Source

Epic 4, Story 4.1. FRs covered: FR22, FR23, FR24. UX-DRs covered: UX-DR4, UX-DR9.

## Acceptance Criteria

1. **Given** the user navigates to a course view
   **When** the page loads
   **Then** a progress bar shows overall course completion percentage

2. **Given** the course has sections with various statuses
   **When** the section list renders
   **Then** each section shows its status: completed (checkmark + mastery badge), current (amber left border + arrow), locked (lock icon + muted text)

3. **Given** sections have mastery levels assigned
   **When** mastery badges render
   **Then** they are color-coded: gray dot = new, amber dot = learning, gold dot = reviewing, green checkmark = mastered

4. **Given** a section is completed
   **When** the user clicks it in the section list
   **Then** the user navigates to the section void to revisit it

5. **Given** the user is on the course view
   **When** the action area renders
   **Then** action buttons appear at bottom: "Edit Outline" (ghost), "Change Pace" (ghost with PaceSelector), "Delete Course" (destructive)

6. **Given** the user is on mobile
   **When** the course view renders
   **Then** mastery badges show as right-aligned dots without text labels, actions move to a three-dot menu

## Tasks

- [x] 1. Read existing `[courseId]/index.vue` and understand current structure
- [x] 2. Create MasteryBadge component with color-coded mastery indicators
- [x] 3. Enhance course view with mastery badges on section list items
- [x] 4. Style current section with amber left border + arrow indicator
- [x] 5. Add action buttons: "Edit Outline", "Change Pace" (PaceSelector), "Delete Course"
- [x] 6. Add mobile responsive behavior for mastery badges (dots only) and actions (three-dot menu)
- [x] 7. Extract shared CourseViewBody component to eliminate duplication between top-level and folder-scoped views
- [x] 8. Update folder-scoped course view to use shared component with correct folder-aware URLs
- [x] 9. Add component tests for MasteryBadge and updated course view
- [x] 10. Run pnpm test:component to verify no regressions

## Dev Agent Record

### Decisions

- Created MasteryBadge as a standalone component with `level` and `compact` props. `compact` mode (mobile) hides text labels and shows only color dots. Desktop shows both dot and label text.
- Mastery colors: gray (stone-500) for new, amber-500 for learning, yellow-500 for reviewing, green-500 for mastered. "Mastered" uses a checkmark icon instead of a dot.
- Current section detection: finds the first section with `status === 'ready'`, falling back to `status === 'generating'`. This handles both the normal case (next ready section) and the edge case where a section is being generated.
- Action buttons use ghost styling (border-stone-700) for "Edit Outline" and "Change Pace", destructive styling for "Delete Course" via the existing DeleteCourseDialog component.
- Mobile actions use a three-dot DropdownMenu from the existing shadcn-vue component library.
- "Change Pace" toggles a PaceSelector panel inline rather than opening a dialog, for a more lightweight interaction.
- Edit Outline links to `/app/learn/create?courseId=...` -- the CourseCreator page already accepts a courseId query param. Folder-scoped version includes `folderId` in the query string.
- Extracted CourseViewBody.vue to deduplicate the ~200 lines of shared logic between top-level and folder-scoped course views. Both pages are now thin wrappers (~35 lines each) that pass props and handle routing.

## File List

- `app/components/learn/MasteryBadge.vue` (new)
- `app/components/learn/CourseViewBody.vue` (new -- shared course view body)
- `app/pages/app/learn/[courseId]/index.vue` (modified -- now thin wrapper)
- `app/pages/app/folders/[id]/learn/[courseId].vue` (modified -- now thin wrapper with folder-aware URLs)
- `tests/component/learn/mastery-badge.test.ts` (new -- 9 tests)
- `tests/component/learn/course-view.test.ts` (new -- 13 tests)

## Change Log

- Created story file from Epic 4 definition
- Created MasteryBadge.vue with 4 mastery levels, compact mode, aria-labels
- Rewrote top-level course view with progress bar, mastery badges, current section styling, action buttons, mobile dropdown
- Rewrote folder-scoped course view to match
- Code review: 2 blockers fixed (extracted CourseViewBody.vue to eliminate duplication, fixed folder-scoped Edit Outline URL)
- 3 deferred findings (counter-based test mock, no folder-view tests, reviewing color mismatch with UX spec)
- All 368 component tests pass, 566 Convex tests pass
