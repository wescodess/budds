# Story 1.6: Pace Selector & Course Start

Status: done

## Story

As a user,
I want to set my learning pace and start the course,
So that the system adapts to my schedule.

## Acceptance Criteria

1. **Given** the user has reviewed the outline
   **When** they view the pace selector below the outline editor
   **Then** a dropdown shows 3 presets: Intensive ("Learn faster, more per session"), Steady ("Balanced pace"), Relaxed ("Take it slow, fewer items per session")
   **And** the current pace value from `courses.pace` is pre-selected (default: 'steady')

2. **Given** the user selects a different pace
   **When** the dropdown value changes
   **Then** `courses.updatePace` mutation is called to store the new pace on the course record

3. **Given** the "Start Learning" button below the pace selector
   **When** the user clicks it
   **Then** `courses.startCourse` mutation is called which:
   - Updates the first section's status from `'locked'` to `'generating'`
   - Creates a task with `type: 'section-generate'` and `metadata: { courseId, sectionId }` for the first section
   - Returns the `courseId` for navigation

4. **Given** the course has been started
   **When** the `startCourse` mutation completes
   **Then** the user is navigated to the course view at `/app/learn/[courseId]`

5. **Given** the user is on the course view (future Story 4.1)
   **When** they want to change pace
   **Then** they can update pace at any time via `courses.updatePace`
   **And** this story only implements the mutation — the course view UI is a later story

6. **Given** the `courses.startCourse` mutation
   **When** the course is not in `'ready'` status
   **Then** the mutation throws "Course is not ready to start"
   **And** when the course has no sections
   **Then** the mutation throws "Course has no sections"

7. **Given** the Convex and component tests
   **When** tests run
   **Then** all existing tests pass with zero regressions
   **And** new Convex tests cover: updatePace happy path + ownership guard, startCourse happy path (first section → generating + task created), startCourse status guard, startCourse no-sections guard
   **And** new component tests cover: PaceSelector renders 3 options, selecting a pace calls mutation, Start Learning button calls startCourse

## Tasks / Subtasks

- [x] **Task 1: Create `courses.updatePace` mutation** (AC: #2, #5)
  - [x] Args: `courseId`, `pace` (union: 'intensive'|'steady'|'relaxed')
  - [x] Auth + ownership guard
  - [x] Patch course with new pace + updatedAt

- [x] **Task 2: Create `courses.startCourse` mutation** (AC: #3, #6)
  - [x] Args: `courseId`
  - [x] Auth + ownership guard
  - [x] Verify course status is 'ready' and has sections
  - [x] Get first section (order 0), patch status to 'generating'
  - [x] Create task via `internal.tasks.createInternal` with `type: 'section-generate'`, `metadata: { courseId, sectionId }`
  - [x] Patch section with `taskId`
  - [x] Return `courseId`

- [x] **Task 3: Create `app/components/learn/PaceSelector.vue`** (AC: #1)
  - [x] Props: `courseId`, `currentPace`
  - [x] Native `<select>` with 3 options
  - [x] Each option shows pace name + description
  - [x] On change calls `courses.updatePace`

- [x] **Task 4: Create `app/components/learn/StartLearningButton.vue`** (AC: #3, #4)
  - [x] Props: `courseId`
  - [x] Amber CTA button "Start Learning ->"
  - [x] On click: calls `courses.startCourse`, then navigates to `/app/learn/[courseId]`
  - [x] Loading state while mutation runs

- [x] **Task 5: Write tests** (AC: #7)
  - [x] Convex tests: updatePace happy path + ownership guard + unauth guard, startCourse happy path, status guard, no-sections guard, double-start guard
  - [x] Component tests: PaceSelector renders 3 options + descriptions, PaceSelector calls mutation on change, StartLearningButton renders + calls mutation + shows loading state

## Dev Agent Record

### Decisions

- **Skipped ATDD step.** Story 1-6 has no E2E-testable UI route (the course view page `/app/learn/[courseId]` does not exist yet). The components are standalone and will be integrated in Story 1.7. ATDD tests would have no page to mount against. Convex integration tests + component unit tests provide equivalent coverage for this story.
- **Added double-start guard to `startCourse`.** Code review found that calling `startCourse` twice would create duplicate tasks. Added `firstSection.status !== 'locked'` check. Not in the original ACs but required for correctness.
- **Used native `<select>` over Reka UI dropdown.** Per dev notes, avoids portal-based components that are difficult to test in `mountSuspended`.

### Code Review

- **Blocker fixed:** Double-start guard added to `startCourse` mutation (checks first section is `'locked'` before proceeding).
- **Deferred (2):** Error handling on mutation failures (toast notifications) and optimistic pace updates -- both deferred to Story 1.7 full-flow integration.

## File List

- `convex/courses.ts` — Added `updatePace` and `startCourse` mutations
- `app/components/learn/PaceSelector.vue` — New component
- `app/components/learn/StartLearningButton.vue` — New component
- `convex/courses.test.ts` — Added 7 new Convex tests (updatePace: 3, startCourse: 4)
- `tests/component/learn/pace-selector.test.ts` — New, 4 component tests
- `tests/component/learn/start-learning-button.test.ts` — New, 3 component tests

## Change Log

- Added `courses.updatePace` mutation with auth + ownership guard
- Added `courses.startCourse` mutation: validates course is ready, first section is locked, creates section-generate task, transitions first section to generating
- Created PaceSelector.vue: native select with 3 presets (Intensive/Steady/Relaxed) and descriptions, calls updatePace on change
- Created StartLearningButton.vue: amber CTA button with loading state, calls startCourse then navigates to course view
- Added 7 Convex integration tests and 7 component tests (14 new total)
- 506 Convex/server tests pass (0 regressions, +8 net new), 22 learn component tests pass

## Dev Notes

- PaceSelector and StartLearningButton will be composed into the Course Creator full flow in Story 1.7
- No Reka-portaled primitives (no UiSelect) — use native select or inline radio buttons
- The `/app/learn/[courseId]` route does not exist yet (Epic 2/4) — just navigate to it; the page will be created later
- Section generation endpoint (`POST /api/course/generate-section`) is Epic 3 — this story only creates the task, the actual generation pipeline comes later
