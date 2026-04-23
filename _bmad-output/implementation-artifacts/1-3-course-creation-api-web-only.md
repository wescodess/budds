# Story 1.3: Course Creation API — Web-Only (Cold Start)

Status: done

## Story

As a user,
I want to create a course from a topic with no documents,
So that I can start learning immediately without uploading anything.

## Acceptance Criteria

1. **Given** the user has no documents or wants a web-sourced course
   **When** they call `courses.create` with `sourceType: 'web-only'`, a `title` (the topic), and no `folderId` or `documentIds`
   **Then** a `courses` record is created with `sourceType: 'web-only'`, `folderId: undefined`, `webSearchEnabled: true`, `sourceConfidence: { docCount: 0, webPercent: 100 }`, `status: 'generating'`
   **And** no `courseSourceDocs` records are created (web-only has no document references)
   **And** a task is created with `type: 'course-outline'` and `metadata: { courseId }` (same as folder-based)
   **And** a `learnProfile` is upserted for the user

2. **Given** the `courses.create` mutation currently only accepts `sourceType: 'folder' | 'cross-folder'`
   **When** `'web-only'` support is added
   **Then** the mutation validator accepts `sourceType: v.union(v.literal('folder'), v.literal('cross-folder'), v.literal('web-only'))`
   **And** for `web-only`: `folderId` and `documentIds` are ignored (not required)
   **And** `webSearchEnabled` defaults to `true` for web-only courses

3. **Given** a `web-only` course is created
   **When** the outline generation task eventually runs (Story 1.4)
   **Then** it will use AI Gateway web search instead of RAG document retrieval
   **And** this story does NOT implement the outline generation — only the Convex mutation and task creation

4. **Given** a user can optionally attach a `folderId` to a web-only course
   **When** they pass a `folderId` with `sourceType: 'web-only'`
   **Then** the course is scoped to that folder (appears in folder Learn tab) but has no document sources
   **And** folder ownership is verified

5. **Given** the Convex tests
   **When** `pnpm test` runs
   **Then** all existing tests pass with zero regressions
   **And** new tests cover: web-only creation happy path (no docs, no folder), web-only with optional folderId, web-only sourceConfidence values, web-only does not create courseSourceDocs, auth rejection

## Tasks / Subtasks

- [x] **Task 1: Extend `courses.create` mutation for web-only** (AC: #1, #2, #3, #4)
  - [x] Add `v.literal('web-only')` to the `sourceType` validator union
  - [x] Add web-only branch: skip document fetching/verification, skip courseSourceDocs creation
  - [x] Set `webSearchEnabled: true` and `sourceConfidence: { docCount: 0, webPercent: 100 }` for web-only
  - [x] Allow optional `folderId` for web-only (verify ownership if provided)
  - [x] Task creation and learnProfile upsert remain the same as folder/cross-folder

- [x] **Task 2: Write Convex tests** (AC: #5)
  - [x] Test web-only creation: course created, no courseSourceDocs, task linked, learnProfile upserted
  - [x] Test web-only with folderId: course scoped to folder
  - [x] Test web-only sourceConfidence: docCount 0, webPercent 100
  - [x] Test auth rejection for web-only
  - [x] Verify existing folder/cross-folder tests still pass

## Dev Notes

- This is a small delta on top of Story 1-2's `courses.create` — just adding the web-only branch
- The actual web search / AI Gateway call happens in Story 1.4 (outline generation pipeline) — this story only creates the course record and task
- Architecture specifies AI Gateway for web supplementation rather than a dedicated search API
- Web-only courses can optionally be folder-scoped (appears in folder Learn tab) even without document sources
