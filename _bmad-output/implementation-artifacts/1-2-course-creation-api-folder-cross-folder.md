# Story 1.2: Course Creation API — Folder & Cross-Folder Sources

Status: done

## Story

As a user,
I want to create a course by selecting documents from my folders,
So that I can learn from my existing knowledge base materials.

## Acceptance Criteria

1. **Given** the user has documents in one or more folders
   **When** they call `courses.create` with `sourceType: 'folder'`, a `folderId`, a `title`, and optionally specific `documentIds`
   **Then** a `courses` record is created with `status: 'generating'`, `sourceType: 'folder'`, `pace: 'steady'` (default), `completedSectionCount: 0`, `totalSectionCount: 0`, `webSearchEnabled: false`, empty `outlineSections`, and timestamps
   **And** the user's folder ownership is verified before creation
   **And** `courseSourceDocs` records are created linking the course to each selected document (or all documents in the folder if none specified)

2. **Given** the user selects documents across multiple folders
   **When** they call `courses.create` with `sourceType: 'cross-folder'`, no `folderId`, a `title`, and `documentIds` from different folders
   **Then** a `courses` record is created with `sourceType: 'cross-folder'`, `folderId: undefined`
   **And** `courseSourceDocs` records are created for each document, each storing its own `folderId` from the source document
   **And** ownership of every referenced document is verified

3. **Given** a course is created successfully
   **When** the mutation completes
   **Then** a task is created via the existing `tasks.create` mutation with `type: 'course-outline'` and `metadata: { courseId }`
   **And** the returned `taskId` is stored on the `courses` record
   **And** a `learnProfile` is created for the user if one does not already exist (upsert pattern: `streakCurrent: 0`, `streakFreezeAvailable: false`, `dailyReviewCap: 50`)

4. **Given** the user is not authenticated
   **When** they call `courses.create`
   **Then** the mutation throws an authentication error

5. **Given** the user references a `folderId` they do not own
   **When** they call `courses.create` with `sourceType: 'folder'`
   **Then** the mutation throws "Folder not found"

6. **Given** the user references `documentIds` they do not own
   **When** they call `courses.create`
   **Then** the mutation throws "Document not found" (no existence leak — same error for missing or foreign documents)

7. **Given** the courses table
   **When** a `courses.listByUser` query is called
   **Then** it returns all courses for the authenticated user ordered by `_creationTime desc`
   **And** only the user's own courses are returned

8. **Given** the courses table
   **When** a `courses.listByFolder` query is called with a `folderId`
   **Then** it returns courses where `folderId` matches and `userId` matches, ordered by `_creationTime desc`

9. **Given** a course exists
   **When** `courses.get` is called with a course `id`
   **Then** it returns the course if owned by the user, or `null` if not found / not owned

10. **Given** the Convex tests
    **When** `pnpm test` runs
    **Then** all existing tests pass with zero regressions
    **And** new tests cover: folder-source creation happy path, cross-folder creation happy path, auth rejection, folder ownership rejection, document ownership rejection, task creation linkage, learnProfile upsert (created on first course, reused on second), listByUser isolation, listByFolder filtering, get ownership guard

## Tasks / Subtasks

- [x] **Task 1: Implement `convex/courses.ts` — create mutation** (AC: #1, #2, #3, #4, #5, #6)
  - [x] `create` mutation with args: `title` (string), `sourceType` (union: 'folder'|'cross-folder'), `folderId` (optional id('folders')), `documentIds` (optional array of id('documents')), `webSearchEnabled` (optional boolean, default false)
  - [x] Auth guard: derive `userId` from `ctx.auth.getUserIdentity().tokenIdentifier`
  - [x] For `sourceType: 'folder'`: verify folder ownership, fetch all documents in folder if `documentIds` not specified, else verify each doc belongs to user and folder
  - [x] For `sourceType: 'cross-folder'`: verify each documentId belongs to user, derive folderId per doc from the document record
  - [x] Insert `courses` record with defaults (`pace: 'steady'`, `status: 'generating'`, `completedSectionCount: 0`, `totalSectionCount: 0`)
  - [x] Insert `courseSourceDocs` records for each document
  - [x] Create task via `ctx.runMutation(internal.tasks.createInternal, ...)` with `type: 'course-outline'`
  - [x] Patch course with `taskId`
  - [x] Upsert `learnProfile` for user if not exists

- [x] **Task 2: Implement `convex/courses.ts` — read queries** (AC: #7, #8, #9)
  - [x] `listByUser` query: auth guard, index `by_userId`, order desc, return all
  - [x] `listByFolder` query: auth guard, args `folderId`, index `by_userId_and_folderId`, order desc
  - [x] `get` query: auth guard, fetch by id, return null if not owned

- [x] **Task 3: Implement `convex/courseSourceDocs.ts` — read query** (AC: #1, #2)
  - [x] `listByCourse` query: auth guard, args `courseId`, verify course ownership, index `by_courseId`

- [x] **Task 4: Implement learnProfile upsert** (AC: #3)
  - [x] Inline upsert in courses.create: query `by_userId`, if null insert defaults

- [x] **Task 5: Write Convex tests** (AC: #10)
  - [x] Test folder-source creation: creates course + sourceDoc records + task
  - [x] Test folder-source with specific documentIds
  - [x] Test cross-folder creation: creates course + multiple sourceDoc records from different folders
  - [x] Test auth rejection (unauthenticated user)
  - [x] Test folder ownership rejection
  - [x] Test document ownership rejection (foreign doc)
  - [x] Test learnProfile upsert: first course creates profile, second course reuses it
  - [x] Test listByUser returns only user's courses
  - [x] Test listByFolder filters by folder
  - [x] Test get returns null for foreign course
  - [x] Test courseSourceDocs.listByCourse ownership guard

## Dev Notes

- Follow existing Convex mutation patterns from `convex/quizzes.ts` and `convex/flashcards.ts` — auth guard, ownership verification, index-based queries
- Task creation: check `convex/tasks.ts` for the exact internal mutation signature — may need `internal.tasks.createInternal` or similar
- The `outlineSections` array starts empty — it gets populated by the outline generation pipeline (Story 1.4)
- `sourceConfidence` starts as `{ docCount: <num docs>, webPercent: 0 }` for folder/cross-folder sources
- Cross-folder courses have `folderId: undefined` — they appear on Learn Home but not in any folder's sidebar or learn page

## File List

- `convex/courses.ts` — create mutation + listByUser, listByFolder, get queries
- `convex/courseSourceDocs.ts` — listByCourse query
- `convex/tasks.ts` — added `createInternal` internalMutation for cross-folder task creation
- `convex/schema.ts` — made tasks.folderId optional, added by_userId index on tasks
- `convex/courses.test.ts` — 12 new tests

## Change Log

- Added `courses.create` mutation with folder and cross-folder support, auth/ownership guards, task linkage, and learnProfile upsert
- Added `courses.listByUser`, `courses.listByFolder`, `courses.get` queries
- Added `courseSourceDocs.listByCourse` query with ownership guard
- Added `tasks.createInternal` internalMutation to support folderless task creation (cross-folder courses)
- Made `tasks.folderId` optional in schema (backwards-compatible; existing tasks still have folderId)
- Added `by_userId` index on tasks table
- Added 12 new Convex integration tests (459 total pass, 0 regressions)

## Dev Agent Record

### Decisions

- **tasks.folderId made optional**: Cross-folder courses have no folderId, but the existing `tasks.create` public mutation requires folderId. Rather than forcing a synthetic folder assignment, made folderId optional in the schema (backwards-compatible) and added `tasks.createInternal` internalMutation that accepts optional folderId. This preserves the existing public API contract while enabling folderless tasks.
- **ATDD skipped**: This story has no UI-testable acceptance criteria — it's a pure backend/Convex API story. All ACs are tested via Convex integration tests in `courses.test.ts`. No E2E or acceptance tests generated.
- **learnProfile upsert inline**: Instead of a separate internal helper function, the upsert is inlined in `courses.create` since it's a simple query-then-insert pattern and only used in one place currently.
