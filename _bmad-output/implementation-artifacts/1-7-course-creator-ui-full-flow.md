# Story 1.7: Course Creator UI — Full Flow

Status: review

## Story

As a user,
I want a polished course creation experience,
So that creating a course feels simple and inviting.

## Acceptance Criteria

1. **Given** the user navigates to `/app/learn/create` (or `/app/learn/create?folderId=X` for folder-scoped)
   **When** the page loads
   **Then** Step 1 (Source Selection) is displayed with:
   - A text input "What do you want to learn?" for the topic
   - A folder/document selector with checkboxes showing the user's folders and documents
   - A "Supplement from web" toggle (default off for folder sources, forced on for topic-only)
   - A "Generate Outline →" primary button
   **And** if `folderId` query param is present, that folder's documents are pre-selected

2. **Given** the user has entered a topic and/or selected documents
   **When** they click "Generate Outline →"
   **Then** the button shows a loading spinner
   **And** the view transitions to a skeleton loading state with 8-10 shimmer lines and the caption "Analyzing your materials..."
   **And** the `courses.create` mutation is called with the appropriate `sourceType` ('folder', 'cross-folder', or 'web-only'), `title` (topic), selected `documentIds`/`folderIds`, and `webSearchEnabled`
   **And** the component subscribes to the created course's status via `courses.get` query

3. **Given** the outline generation completes (course status transitions to 'ready')
   **When** the skeleton is replaced
   **Then** Step 2 is displayed with:
   - The OutlineEditor component (Story 1.5) showing the generated sections
   - The PaceSelector component (Story 1.6) below the outline editor
   - The StartLearningButton component (Story 1.6) below the pace selector
   **And** the source confidence indicator is visible at the top of the outline editor

4. **Given** outline generation fails (course status transitions to 'failed')
   **When** the error state renders
   **Then** an error message is shown: "We couldn't generate an outline. Please try again."
   **And** a "Try Again" button is displayed that navigates back to Step 1 with the previous inputs preserved

5. **Given** the user is on Step 2 with the outline displayed
   **When** they interact with the outline editor
   **Then** all Story 1.5 interactions work (drag-to-reorder, inline edit, knowledge type cycling, add/remove sections)
   **And** the pace selector defaults to 'steady' and allows changing before starting

6. **Given** the user clicks "Start Learning →" on Step 2
   **When** the startCourse mutation completes
   **Then** the user is navigated to `/app/learn/[courseId]`
   **And** the route exists as a placeholder page showing "Course view coming in Epic 2" with the course title

7. **Given** the full flow on mobile viewports
   **When** the page renders
   **Then** Step 1: topic input and folder selector stack vertically, full-width
   **And** Step 2: outline editor, pace selector, and start button stack vertically with appropriate spacing
   **And** all interactive elements have min 44px touch targets

8. **Given** the Convex and component tests
   **When** tests run
   **Then** all existing tests pass with zero regressions
   **And** new component tests cover: SourceSelector renders topic input + folder list, SourceSelector calls courses.create on submit, CourseCreator transitions from Step 1 skeleton → Step 2 on course ready, error state renders on course failed, StartLearningButton integration in full flow

## Tasks / Subtasks

- [x] **Task 1: Create `app/components/learn/SourceSelector.vue`** (AC: #1)
  - [x] Text input for topic ("What do you want to learn?")
  - [x] Folder/document list with checkboxes using `useConvexQuery(api.folders.listAllFolders)` and `useConvexQuery(api.documents.countsByFolder)`
  - [x] "Supplement from web" toggle checkbox
  - [x] "Generate Outline →" button with loading state
  - [x] Props: `initialFolderId?` for pre-selection
  - [x] Emits: `submit` with `{ title, sourceType, folderIds, documentIds, webSearchEnabled }`

- [x] **Task 2: Create `app/components/learn/CourseCreator.vue`** (AC: #2, #3, #4, #5)
  - [x] Step state machine: 'source-selection' → 'generating' → 'outline-editor' | 'error'
  - [x] On SourceSelector submit: call `courses.create` mutation, transition to 'generating'
  - [x] In 'generating': show skeleton loading with shimmer lines + caption
  - [x] Subscribe to course via `useConvexQuery(api.courses.get, { courseId })` — watch for status 'ready' or 'failed'
  - [x] On 'ready': transition to 'outline-editor', render OutlineEditor + PaceSelector + StartLearningButton
  - [x] On 'failed': show error state with "Try Again" button that returns to 'source-selection'

- [x] **Task 3: Create `/app/pages/app/learn/create.vue`** (AC: #1, #6)
  - [x] Page that renders CourseCreator component
  - [x] Read `folderId` from `useRoute().query` and pass to SourceSelector

- [x] **Task 4: Create placeholder `/app/pages/app/learn/[courseId].vue`** (AC: #6)
  - [x] Placeholder page for course view (Epic 2/4 will flesh this out)
  - [x] Show course title from `useConvexQuery(api.courses.get)`
  - [x] Display "Course view coming soon" with a link back to create page

- [x] **Task 5: Wire error handling toasts** (deferred from 1-5, 1-6)
  - [x] Add try/catch with toast notifications in CourseCreator, StartLearningButton, PaceSelector, OutlineEditor
  - [x] Use `vue-sonner` toast for error feedback on all mutation failures

- [x] **Task 6: Write tests** (AC: #8)
  - [x] Component tests: SourceSelector renders inputs and emits on submit (8 tests)
  - [x] Component tests: CourseCreator step transitions and error state (3 tests)
  - [x] Verify zero regressions on existing 504 Convex tests and learn component tests

## Dev Agent Record

### Decisions

- Used `api.folders.listAllFolders` + `api.documents.countsByFolder` instead of per-folder document listing for the source selector. Simpler UX: user selects folders, not individual documents. Individual document selection can be added later.
- Removed `definePageMeta({ middleware: ['auth'] })` from learn pages since `/app/**` routes are already protected by the global auth middleware from `@onmax/nuxt-better-auth`.
- PaceSelector now does optimistic update with rollback on error (addresses deferred item from 1-6).

## File List

- `app/components/learn/SourceSelector.vue` (new)
- `app/components/learn/CourseCreator.vue` (new)
- `app/components/learn/OutlineEditor.vue` (modified — error toasts)
- `app/components/learn/PaceSelector.vue` (modified — error toasts + optimistic update)
- `app/components/learn/StartLearningButton.vue` (modified — error toasts)
- `app/pages/app/learn/create.vue` (new)
- `app/pages/app/learn/[courseId].vue` (new)
- `tests/component/learn/source-selector.test.ts` (new)
- `tests/component/learn/course-creator.test.ts` (new)

## Change Log

- Created SourceSelector component with topic input, folder checkbox list, web supplement toggle, and generate button
- Created CourseCreator component with step state machine (source-selection → generating → outline-editor | error)
- Created /app/learn/create page wiring CourseCreator with folderId query param support
- Created /app/learn/[courseId] placeholder page showing course title
- Added vue-sonner toast error handling to OutlineEditor, PaceSelector, StartLearningButton, and CourseCreator
- Added optimistic pace update with rollback in PaceSelector
- Added 11 new component tests (8 source-selector + 3 course-creator)

## Dev Notes

- OutlineEditor, PaceSelector, and StartLearningButton already exist from Stories 1.5 and 1.6 — compose them, don't rebuild
- The folder/document selector can reuse patterns from the existing chat DirectoryPicker but should use simpler checkboxes
- No Reka-portaled primitives for the selector — native HTML checkboxes or simple custom checkboxes
- The `/app/learn/[courseId]` page is a placeholder — Epic 2 Story 4.1 builds the real course view
- `courses.create` already handles all three sourceTypes and creates the outline generation task
- The skeleton loading state should match the dark theme used by OutlineEditor
- The `folderId` query param enables Story 2.2 (folder-scoped learn tab) to link directly to course creation with that folder pre-selected
