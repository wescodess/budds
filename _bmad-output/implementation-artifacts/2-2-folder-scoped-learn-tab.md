# Story 2-2: Folder-Scoped Learn Integration

## Status: in-progress

## Epic
Epic 2: Learn Navigation & Course Management

## Story
As a user,
I want to see my folder-scoped courses in the folder sidebar and access them from a dedicated learn page,
So that my learning stays organized by subject.

## Acceptance Criteria

**AC1: Courses in Folder Sidebar**
Given the user is in a folder view (e.g., `/app/folders/[id]/`)
When folder-scoped courses exist for that folder
Then courses appear as void entries in the folder sidebar under the VOIDS section (alongside chats, flashcard sets, and quizzes)
And each course void shows a BookOpen icon, the course title, and is sorted by updatedAt
And clicking a course navigates to `/app/folders/[id]/learn/[courseId]`

**AC2: New Void Dialog — Course Type**
Given the user clicks "New Void" in a folder
When the CreateVoidDialog opens
Then a "Course" type option is available with BookOpen icon
And selecting it navigates to `/app/learn/create?folderId={currentFolderId}`

**AC3: Folder-Scoped Learn Page**
Given the user navigates to `/app/folders/[id]/learn/`
When the page loads
Then all courses scoped to that folder are displayed in a grid (reusing CourseCard from 2-1)
And a dashed "+ Create Course" card appears at the end
And clicking "+ Create Course" navigates to `/app/learn/create?folderId={id}`

**AC4: Learn Sidebar Entry**
Given the user is in a folder view
When the sidebar's workspace section renders
Then a "Learn" entry links to `/app/folders/[id]/learn/` showing the folder-scoped course grid

**AC5: Folder-Scoped Course View**
Given the user navigates to `/app/folders/[id]/learn/[courseId]`
When the page loads
Then the course view renders (placeholder OK — same as `/app/learn/[courseId]`)

## Tasks

### Task 1: Add 'course' to VoidKind and CreateVoidDialog
- Update `VoidKind` type to include `'course'`
- Add course option to CreateVoidDialog with BookOpen icon, title "Course", subtitle "Structured learning from your knowledge"
- On select: navigate to `/app/learn/create?folderId={currentFolderId}` (reuse existing course creator)

### Task 2: Query courses in FolderShellRail
- Add `useConvexQuery(api.courses.listByFolder, { folderId })` to FolderShellRail
- Map courses to VoidItem format: `{ id: course._id, type: 'course', title: course.title, updatedAt: course.updatedAt ?? course.createdAt }`
- Merge into the existing void list, sorted by updatedAt desc

### Task 3: Handle course void selection in folder shell
- When a void with type 'course' is selected, navigate to `/app/folders/[folderId]/learn/${voidId}`
- Follow existing pattern for chat/flashcards/quiz void selection

### Task 4: Create folder-scoped Learn page
- Create `/app/pages/app/folders/[id]/learn/index.vue`
- Use `useConvexQuery(api.courses.listByFolder, { folderId })` for course list
- Reuse CourseCard and CreateCourseCard from story 2-1
- CreateCourseCard navigates to `/app/learn/create?folderId={id}`
- SSR guard on reactive queries

### Task 5: Create folder-scoped course view page
- Create `/app/pages/app/folders/[id]/learn/[courseId].vue`
- Placeholder that loads course via `api.courses.get` and displays title
- Same pattern as existing `/app/pages/app/learn/[courseId].vue`

### Task 6: Add Learn entry to sidebar workspace section
- In the folder sidebar workspace area, add a "Learn" link
- Icon: BookOpen, navigates to `/app/folders/[id]/learn/`
- Only show if the user has at least one course in this folder (optional — can always show)

### Task 7: Write component tests
- Test CreateVoidDialog includes course type option
- Test FolderShellRail renders course voids in sidebar
- Test folder-scoped learn page renders course grid
- Test navigation from void selection to correct route
- Use `@nuxt/test-utils` with `mountSuspended`

## Dev Agent Record

### Decisions
- Skipped ATDD: Story is UI navigation/wiring with no complex business logic. All ACs are verifiable via component tests and manual routing checks.
- Used GraduationCap icon for sidebar Learn entry to differentiate from BookOpen (used for Knowledge and logo).
- Course void items in sidebar support context menu with Open/Delete like other void types.
- Added 'learn' as a valid tab value so course routes highlight correctly in the sidebar.

### Tasks Completed
- [x] Task 1: Add 'course' to VoidKind and CreateVoidDialog
- [x] Task 2: Query courses in FolderShellRail
- [x] Task 3: Handle course void selection in folder shell
- [x] Task 4: Create folder-scoped Learn page
- [x] Task 5: Create folder-scoped course view page
- [x] Task 6: Add Learn entry to sidebar workspace section
- [x] Task 7: Write component tests

### File List
- `app/components/voids/CreateVoidDialog.vue` — added 'course' type
- `app/components/folder-shell/FolderShellRail.vue` — added course query, void items, Learn sidebar entry
- `app/components/folder-shell/FolderShell.vue` — updated emit types for 'course' and 'learn'
- `app/pages/app/folders/[id].vue` — course void handling, learn tab detection
- `app/pages/app/folders/[id]/learn/index.vue` — new folder-scoped learn page
- `app/pages/app/folders/[id]/learn/[courseId].vue` — new folder-scoped course view
- `app/components/learn/CourseCard.vue` — added folderId prop for folder-scoped URLs
- `app/components/learn/CreateCourseCard.vue` — added folderId prop
- `tests/component/learn/folder-learn.test.ts` — 4 new tests
- `tests/component/learn/create-void-course.test.ts` — 2 new tests
- `tests/component/learn/create-course-card.test.ts` — 1 new test added

### Change Log
- Added "Course" option to CreateVoidDialog with BookOpen icon
- Courses from folder now appear as void items in folder sidebar
- Clicking course in sidebar navigates to `/app/folders/[id]/learn/[courseId]`
- New folder-scoped Learn page at `/app/folders/[id]/learn/`
- New folder-scoped course view at `/app/folders/[id]/learn/[courseId]`
- "Learn" workspace entry in sidebar navigates to folder's learn page
- CourseCard and CreateCourseCard support folder-scoped URLs via folderId prop
- 7 new component tests

## Technical Notes

### Existing infrastructure
- `api.courses.listByFolder({ folderId })` — already exists, returns courses scoped to a folder
- `CourseCard.vue`, `CreateCourseCard.vue` — built in story 2-1, reusable
- `FolderShellRail.vue` — existing sidebar with void entries for chats, flashcards, quizzes
- `CreateVoidDialog.vue` — existing dialog with chat, flashcards, quiz, audio-overview types
- VoidItem type: `{ id: string; type: VoidKind; title: string; updatedAt: number }`
- Course creator at `/app/learn/create` accepts `?folderId` query param (built in story 1-7)

### Routing pattern
Follow the established folder-scoped routing:
- `/app/folders/[id]/chat/[conversationId]`
- `/app/folders/[id]/flashcards/[roomId]`
- `/app/folders/[id]/quiz/[quizId]`
- NEW: `/app/folders/[id]/learn/[courseId]`

### Design tokens
Same as story 2-1 — dark theme, stone palette, amber accent
