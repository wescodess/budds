# Story 3-2: N+1 Section Pre-Fetch

## Status: review

## Epic
Epic 3: Section Learning Experience

## Story
As a user,
I want the next section ready when I finish the current one,
So that I never wait between sections.

## Acceptance Criteria

**AC1: Pre-Fetch Check on Section View**
Given the user is working on section N
When section N is opened or being viewed
Then the system checks if section N+1 exists and has a generation task

**AC2: Trigger Generation for N+1**
Given section N+1 is in 'locked' status
When the pre-fetch check runs
Then a task is created for N+1 generation and `/api/course/generate-section` is called

**AC3: Failed Task Retry**
Given section N+1's previous generation task failed
When the pre-fetch check detects the failure
Then it retries once by creating a new task and triggering generation

**AC4: Only Pre-Fetch One Ahead**
Given pre-fetch logic runs
When it checks sections beyond N+1
Then it does NOT trigger generation for N+2 or beyond

**AC5: Instant Load When Ready**
Given the user advances to section N+1
When N+1 has been pre-fetched and is ready
Then it loads instantly (<500ms via existing Convex real-time subscription)

## Tasks

### Task 1: Add `getNextSection` query to `convex/courseSections.ts` (AC: #1, #4)
- Public query that takes `courseId` and `currentOrder` args
- Returns the section at `order = currentOrder + 1` for the given course
- Uses the existing `by_courseId_and_order` index
- Only returns if caller owns the course (auth check)

### Task 2: Add `checkPreFetchStatus` query to `convex/courseSections.ts` (AC: #1, #3)
- Public query that takes `courseId` and `currentOrder` args
- Returns `{ nextSection, taskStatus }` — the next section and its task status
- Checks task status via the section's `taskId` field + task record lookup
- Returns `null` if no next section or if next section is already ready/completed/generating

### Task 3: Add `triggerPreFetch` mutation to `convex/courseSections.ts` (AC: #2, #3)
- Public mutation that takes `courseId` and `currentOrder` args
- Finds section at `currentOrder + 1`
- Guards: skip if next section is already `ready`, `completed`, or `generating`
- If `locked`: create a task via `tasks.createInternal`, set section status to `generating`, link taskId
- If `failed`: check if a retry has already been attempted (look for task with matching metadata)
  - If no previous retry: create new task, set section back to `generating`
  - If already retried once: skip (don't retry more than once)
- Returns `{ sectionId, taskId }` or `null` if no action needed

### Task 4: Create `usePreFetchSection` composable (AC: #1, #2, #3, #5)
- `app/composables/usePreFetchSection.ts`
- Takes `courseId` and `currentSectionOrder` as reactive refs
- Uses `checkPreFetchStatus` query to watch next section state
- When next section is `locked` or `failed` (eligible for pre-fetch): calls `triggerPreFetch` mutation
- After mutation returns `{ sectionId, taskId }`: fires `/api/course/generate-section` via `$fetch`
- Exposes `{ nextSectionReady, isPreFetching }` as reactive state
- Only fires once per section transition (debounced/guarded)

### Task 5: Write Convex tests for pre-fetch logic (AC: #1-#4)
- Test `getNextSection` returns correct next section
- Test `getNextSection` returns null for last section
- Test `triggerPreFetch` transitions locked section to generating
- Test `triggerPreFetch` skips if next section is already ready/generating
- Test `triggerPreFetch` retries failed section once
- Test `triggerPreFetch` does not retry more than once

### Task 6: Integration — verify no regressions
- Run `pnpm test` to confirm all existing tests pass
- Verify the composable can be imported without errors

## Technical Notes

### Existing patterns to follow
- `convex/courseSections.ts` — existing queries/mutations with auth checks
- `convex/courses.ts` `startCourse` — creates task and sets section to generating
- `app/components/learn/StartLearningButton.vue` — fires `/api/course/generate-section` after starting
- `convex/tasks.ts` `createInternal` — internal task creation

### Schema references
- `courseSections` table: by_courseId_and_order index for efficient next-section lookup
- `tasks` table: task status tracking (pending/running/completed/failed/cancelled)

### Key design decisions
- Pre-fetch is client-initiated (Option A from story brief) — consistent with StartLearningButton pattern
- Only 1 section ahead (N+1), never N+2
- Retry failed sections once — use task count for the section as retry indicator
- The composable will be used by Story 3-3's Section Void UI when it is built

### Out of scope
- Section Void UI (Story 3-3) — composable is prepared for future consumption
- Adaptive pacing changes to generation params (Story 3-4)
- Audio primer personalization (Story 3-5)

## Dev Agent Record

### Tasks Completed
- [x] Task 1: Add `getNextSection` query
- [x] Task 2: Add `checkPreFetchStatus` query
- [x] Task 3: Add `triggerPreFetch` mutation
- [x] Task 4: Create `usePreFetchSection` composable
- [x] Task 5: Write Convex tests (15 new tests, 544 total passing)
- [x] Task 6: Integration verification (544 Convex + 289 component tests pass, 0 regressions)

### Decisions
- `triggerPreFetch` uses the failed task's metadata `retryOf` field to track whether a retry has been attempted, avoiding a second retry. This is simpler than counting tasks per section.
- `checkPreFetchStatus` returns `needsPreFetch: false` for `generating` status to prevent race conditions where multiple clients trigger the same pre-fetch.
- The composable watches `preFetchStatus` (reactive Convex query) and triggers mutation + server call once per section transition, matching the fire-and-forget pattern in StartLearningButton.

### Change Log
- convex/courseSections.ts: Added getNextSection query, checkPreFetchStatus query, triggerPreFetch mutation
- app/composables/usePreFetchSection.ts: New composable for client-side pre-fetch orchestration
- convex/courseSections.test.ts: 15 new tests for pre-fetch queries and mutations

### File List
- convex/courseSections.ts (modified)
- app/composables/usePreFetchSection.ts (new)
- convex/courseSections.test.ts (modified)
- _bmad-output/implementation-artifacts/3-2-n-plus-1-section-pre-fetch.md (new)
