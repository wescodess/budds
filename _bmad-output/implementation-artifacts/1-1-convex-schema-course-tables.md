# Story 1.1: Convex Schema — Course Tables

Status: done

## Story

As a developer,
I want the course data model created in Convex,
So that all course features have a data foundation.

## Acceptance Criteria

1. **Given** the Convex schema at `convex/schema.ts`
   **When** the new tables are added
   **Then** `courses` table is created with fields: `userId` (string), `folderId` (optional id('folders')), `title` (string), `status` (union: 'generating'|'ready'|'failed'), `sourceType` (union: 'folder'|'cross-folder'|'web-only'), `sourceConfidence` (object: docCount number, webPercent number), `pace` (union: 'intensive'|'steady'|'relaxed'), `outlineSections` (array of objects: title string, description string, knowledgeType string, order number), `completedSectionCount` (number), `totalSectionCount` (number), `taskId` (optional id('tasks')), `webSearchEnabled` (boolean), `createdAt` (number), `updatedAt` (number)
   **And** indexes: `by_userId` (['userId']), `by_userId_and_folderId` (['userId', 'folderId']), `by_folderId` (['folderId'])

2. **Given** the schema
   **When** `courseSections` table is added
   **Then** it has fields: `courseId` (id('courses')), `userId` (string), `order` (number), `title` (string), `knowledgeType` (union: 'factual'|'conceptual'|'procedural'|'mixed'), `status` (union: 'locked'|'generating'|'ready'|'completed'|'failed'), `contentBlocks` (array of objects: type union('text'|'quiz'|'flashcard'|'audio'), entityId optional(string), content optional(string), order number), `practiceScore` (optional number), `masteryLevel` (union: 'new'|'learning'|'reviewing'|'mastered'), `completedAt` (optional number), `taskId` (optional id('tasks'))
   **And** indexes: `by_courseId` (['courseId']), `by_courseId_and_order` (['courseId', 'order']), `by_userId` (['userId'])

3. **Given** the schema
   **When** `courseSourceDocs` table is added
   **Then** it has fields: `courseId` (id('courses')), `documentId` (optional id('documents')), `folderId` (optional id('folders')), `userId` (string)
   **And** indexes: `by_courseId` (['courseId'])

4. **Given** the schema
   **When** `learnProfile` table is added
   **Then** it has fields: `userId` (string), `streakCurrent` (number), `streakLastDate` (optional string), `streakFreezeAvailable` (boolean), `streakFreezeUsedAt` (optional string), `dailyReviewCap` (number), `timezone` (optional string)
   **And** indexes: `by_userId` (['userId'])

5. **Given** the existing `quizzes` table in `convex/schema.ts`
   **When** the `courseScoped` field is added
   **Then** `courseScoped: v.optional(v.boolean())` is present on the `quizzes` table definition

6. **Given** the existing `flashcardRooms` table in `convex/schema.ts`
   **When** the `courseScoped` field is added
   **Then** `courseScoped: v.optional(v.boolean())` is present on the `flashcardRooms` table definition

7. **Given** the existing `audioOverviews` table in `convex/schema.ts`
   **When** the `courseScoped` field is added
   **Then** `courseScoped: v.optional(v.boolean())` is present on the `audioOverviews` table definition

8. **Given** existing folder-tab queries in `convex/quizzes.ts`, `convex/flashcardRooms.ts`, and `convex/audioOverviews.ts` that list entities by folder
   **When** they return results
   **Then** they filter out entities where `courseScoped === true` so course-generated items do not appear in folder tabs

9. **Given** the data export at `server/api/export/me.get.ts`
   **When** the schema version is checked
   **Then** `schemaVersion` is bumped from 4 to 5
   **And** new entries for `courses.json`, `courseSections.json`, `courseSourceDocs.json`, and `learnProfile.json` are added to the export manifest
   **And** the export test expects schemaVersion 5

10. **Given** the account deletion cascade at `convex/accountDeletion.ts`
    **When** a user deletes their account
    **Then** `learnProfile`, `courseSourceDocs`, `courseSections`, and `courses` are deleted in child-before-parent order (courseSourceDocs + courseSections before courses; learnProfile independently)
    **And** deletion is inserted before the existing `flashcardRooms` step in the cascade sequence
    **And** an isolation test verifies user-A deletion does not affect user-B's course data

11. **Given** the new tables
    **When** Convex tests run (`pnpm test`)
    **Then** all existing tests pass with zero regressions
    **And** new tests cover: courses CRUD ownership isolation, courseSections ownership, courseSourceDocs ownership, learnProfile uniqueness per user, courseScoped filter on quizzes/flashcardRooms/audioOverviews folder queries, account deletion cascade for Learn tables

## Tasks / Subtasks

- [x] **Task 1: Add MVP course tables to `convex/schema.ts`** (AC: #1, #2, #3, #4)
  - [x] Add `courses` table with all fields and 3 indexes
  - [x] Add `courseSections` table with all fields and 3 indexes
  - [x] Add `courseSourceDocs` table with all fields and 1 index
  - [x] Add `learnProfile` table with all fields and 1 index

- [x] **Task 2: Add `courseScoped` flag to existing tables** (AC: #5, #6, #7)
  - [x] Add `courseScoped: v.optional(v.boolean())` to `quizzes` table
  - [x] Add `courseScoped: v.optional(v.boolean())` to `flashcardRooms` table
  - [x] Add `courseScoped: v.optional(v.boolean())` to `audioOverviews` table

- [x] **Task 3: Filter `courseScoped` entities from folder-tab queries** (AC: #8)
  - [x] Update `convex/quizzes.ts` folder-scoped list query to filter out `courseScoped === true`
  - [x] Update `convex/flashcardRooms.ts` folder-scoped list query to filter out `courseScoped === true`
  - [x] Update `convex/audioOverviews.ts` folder-scoped list query to filter out `courseScoped === true`

- [x] **Task 4: Update account deletion cascade** (AC: #10)
  - [x] Add `deleteAllLearnProfilesForUser` helper in `convex/accountDeletion.ts`
  - [x] Add `deleteAllCourseSourceDocsForUser` helper
  - [x] Add `deleteAllCourseSectionsForUser` helper
  - [x] Add `deleteAllCoursesForUser` helper
  - [x] Insert cascade steps child-before-parent before existing flashcardRooms step

- [x] **Task 5: Update data export** (AC: #9)
  - [x] Add courses, courseSections, courseSourceDocs, learnProfile to export manifest
  - [x] Bump schemaVersion from 4 to 5
  - [x] Update export test assertion to expect schemaVersion 5

- [x] **Task 6: Write Convex tests** (AC: #11)
  - [x] Test courses table CRUD with ownership isolation (user-A cannot read user-B's courses)
  - [x] Test courseScoped filter on quizzes/flashcardRooms/audioOverviews list queries
  - [x] Test account deletion cascade: seed user-A + user-B with courses, delete user-A, assert user-B's data survives
  - [x] Verify all existing tests pass (`pnpm test`)

## Dev Notes

- Architecture specifies `courseScoped` flag approach over new parallel tables — reuses existing quiz/flashcard/audio infrastructure
- `offlineAvailable` field on `courseSections` is deferred to Epic 7 (Offline Access, fast-follow)
- `reviewItems`, `reviewSessions`, `calendarConnections`, `calendarEvents` tables are deferred to their respective fast-follow epics (5, 6)
- Follow existing Convex patterns: `userId` derived from `ctx.auth.getUserIdentity().tokenIdentifier`, never accepted as an argument
- The `courseScoped` filter uses `.filter(q => q.neq(q.field('courseScoped'), true))` — entities without the field (existing data) pass through correctly since `undefined !== true`
