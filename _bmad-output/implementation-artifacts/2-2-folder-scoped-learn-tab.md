# Story 2-2: Folder-Scoped Learn Integration

## Status: ready-for-dev

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
