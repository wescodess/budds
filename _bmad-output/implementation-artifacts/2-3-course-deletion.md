# Story 2-3: Course Deletion

## Status: review

## Epic
Epic 2: Learn Navigation & Course Management

## Story
As a user,
I want to delete a course and all its associated content,
So that I can clean up courses I no longer need.

## Acceptance Criteria

**AC1: Delete Button on Course View**
Given the user is on a course view page (`/app/learn/[courseId]` or `/app/folders/[id]/learn/[courseId]`)
When the page renders
Then a "Delete Course" button is visible (destructive styling)

**AC2: Confirmation Dialog**
Given the user clicks "Delete Course"
When the confirmation dialog appears
Then it warns that all sections, course-scoped quizzes, flashcards, and audio will be permanently deleted
And provides Cancel and Delete actions

**AC3: Cascade Deletion**
Given the user confirms deletion
When the delete mutation runs
Then the course record is deleted
And all courseSections for that course are deleted
And all courseSourceDocs for that course are deleted
And all course-scoped entities (quizzes with courseScoped=true, flashcardRooms with courseScoped=true, audioOverviews with courseScoped=true) matching the courseId are deleted

**AC4: Navigation After Delete**
Given the course is successfully deleted
When the deletion completes
Then the user is navigated back to Learn Home (`/app/learn/`) or the folder learn page (`/app/folders/[id]/learn/`) depending on context
And a success toast confirms the deletion

**AC5: Void Sidebar Update**
Given a folder-scoped course is deleted
When deletion completes
Then the course void entry disappears from the folder sidebar (real-time via Convex subscription)

## Tasks

### Task 1: Create deleteCourse mutation
- Add `deleteCourse` mutation to `convex/courses.ts`
- Args: `{ id: v.id('courses') }`
- Validate ownership (userId matches authenticated user)
- Cascade delete in order:
  1. courseSections by courseId
  2. courseSourceDocs by courseId
  3. quizzes where courseId matches AND courseScoped === true
  4. flashcardRooms where courseId matches AND courseScoped === true
  5. audioOverviews where courseId matches AND courseScoped === true
  6. The course record itself
- Use `.take(500)` batch pattern for safety (follow accountDeletion.ts pattern)
- Note: review items (SR) and calendar events don't exist yet (Epics 5/6) — skip those cascades

### Task 2: Add delete button to course view pages
- Update both `/app/pages/app/learn/[courseId].vue` and `/app/pages/app/folders/[id]/learn/[courseId].vue`
- Add a "Delete Course" button with destructive styling (red/rose)
- Wire click to open confirmation dialog

### Task 3: Build confirmation dialog
- Use the existing UiAlertDialog pattern (Reka UI)
- Title: "Delete Course"
- Description: "This will permanently delete this course and all its sections, quizzes, flashcards, and audio. This action cannot be undone."
- Cancel button + destructive Delete button

### Task 4: Wire deletion and navigation
- On confirm: call `useConvexMutation(api.courses.deleteCourse)`
- Show loading state on the Delete button during mutation
- On success: show vue-sonner toast "Course deleted"
- Navigate to Learn Home or folder learn page based on current route context
- On error: show error toast, keep dialog open

### Task 5: Write Convex tests for deleteCourse
- Test cascade deletes all related records
- Test ownership validation (cannot delete another user's course)
- Test deletion of course-scoped entities only (non-courseScoped items remain)
- Use `convex-test` with `convexTest(schema, modules)`

### Task 6: Write component tests
- Test delete button renders on course view
- Test confirmation dialog opens on click
- Test dialog shows warning text
- Test cancel closes dialog without action
- Use `@nuxt/test-utils` with `mountSuspended`

## Technical Notes

### Existing patterns
- Account deletion cascade: `convex/accountDeletion.ts` — uses `.take(500)` batch loops
- Quiz deletion: `convex/quizzes.ts` lines 868-901 — cascade delete children then parent
- FlashcardRoom deletion: `convex/flashcardRooms.ts` lines 609-640
- AlertDialog: used in folder deletion, audio overview player — UiAlertDialog components

### Schema references
- `courseSections` has `by_courseId` index
- `courseSourceDocs` has `by_courseId` index
- `quizzes` has optional `courseScoped: v.optional(v.boolean())` and `courseId: v.optional(v.id('courses'))`
- `flashcardRooms` has optional `courseScoped` and `courseId` fields
- `audioOverviews` has optional `courseScoped` and `courseId` fields

### Course-scoped entity filtering
Course-scoped entities are identified by BOTH `courseId === args.id` AND `courseScoped === true`. Do NOT delete entities that happen to share the folder but aren't course-scoped.

### Out of scope
- Review items deletion (spaced repetition not built yet — Epic 5)
- Calendar event removal (calendar not integrated yet — Epic 6)
- These will be added to the delete cascade when those features land

## Dev Agent Record

### Tasks Completed
- [x] Task 1: Create deleteCourse mutation in convex/courses.ts
- [x] Task 2: Add delete button to both course view pages
- [x] Task 3: Build confirmation dialog (DeleteCourseDialog.vue)
- [x] Task 4: Wire deletion and navigation with toast feedback
- [x] Task 5: Write Convex tests for deleteCourse (3 tests)
- [x] Task 6: Write component tests (3 ATDD tests)

### Decisions
- Course-scoped entities (quizzes, flashcardRooms, audioOverviews) lack a `courseId` field in the schema; they only have `courseScoped: boolean`. Entity IDs are found via `courseSections.contentBlocks[].entityId` and resolved by `ctx.db.get()` with `courseScoped === true` guard.
- Used try/catch around entity ID resolution because `entityId` could reference any table type (quiz, flashcardRoom, or audioOverview). Each `ctx.db.get()` is attempted and gracefully skipped if the ID doesn't belong to that table.
- ATDD component tests query `document.querySelector()` for dialog content because Reka UI AlertDialog portals content to document body.

### File List
- `convex/courses.ts` — added `deleteCourse` mutation
- `app/components/learn/DeleteCourseDialog.vue` — new component
- `app/pages/app/learn/[courseId].vue` — added delete button + navigation
- `app/pages/app/folders/[id]/learn/[courseId].vue` — added delete button + navigation
- `convex/courses.test.ts` — added 3 deleteCourse tests
- `tests/component/learn/course-delete.atdd.test.ts` — new ATDD test file (3 tests)

### Change Log
- Added `deleteCourse` mutation with cascade: sections, sourceDocs, course-scoped quizzes (with child questions/attempts/answers), flashcardRooms (with roomCards/versions/versionCards), audioOverviews (with storage cleanup)
- Created `DeleteCourseDialog.vue` component with UiAlertDialog, destructive styling, loading state, toast feedback, and `deleted` event emission
- Updated both course view pages to include delete button and post-delete navigation (Learn Home or folder learn page based on route context)
- Added 3 Convex integration tests: cascade deletion, course-scoped-only deletion, ownership guard
- Added 3 ATDD component tests: trigger render, dialog content, cancel behavior
