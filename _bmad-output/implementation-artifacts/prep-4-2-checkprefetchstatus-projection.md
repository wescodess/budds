# Story: prep-4-2-checkprefetchstatus-projection

## Status: in-progress

## Description

Return a projection from `checkPreFetchStatus` instead of the full section document. The composable only needs `status` (and `_id` for type safety), but the query currently returns the entire `nextSection` document including `contentBlocks` (a large array). When `contentBlocks` is populated, any change to it triggers unnecessary subscription re-evaluations on the client.

**Source:** Epic 3 retro action item #2. Deferred from 3-2 code review.

## Acceptance Criteria

- [x] AC1: `checkPreFetchStatus` returns `{ _id, status }` for the next section instead of the full document
- [x] AC2: `usePreFetchSection` composable works correctly with the projected shape
- [x] AC3: Existing tests updated to assert on the projected shape
- [x] AC4: No regressions in existing test suites

## Tasks

- [x] 1. Modify `checkPreFetchStatus` in `convex/courseSections.ts` to return `{ _id, status }` projection instead of full `nextSection` document
- [x] 2. Update `usePreFetchSection` composable type annotations to match new shape
- [x] 3. Update existing `checkPreFetchStatus` tests to assert on projected fields only
- [x] 4. Add a test verifying that `contentBlocks` is NOT included in the response
- [x] 5. Run `pnpm test` to verify no regressions

## Dev Agent Record

### Decisions

- Kept `taskStatus` field in the response since `triggerPreFetch` logic in the composable does not use it, but it provides useful debugging context at minimal cost (single field, not a large array).
- The `nextSection` object in the response is replaced with `{ _id, status }` — only the fields the composable actually reads.

## File List

- `convex/courseSections.ts` — modified `checkPreFetchStatus` to return projection
- `convex/courseSections.test.ts` — updated assertions, added contentBlocks exclusion test
- `app/composables/usePreFetchSection.ts` — updated type annotations

## Change Log

- `checkPreFetchStatus` now returns `{ nextSection: { _id, status }, needsPreFetch, taskStatus }` instead of the full section document
- Composable type annotations updated from `{ status: string }` to match new shape
- Tests updated to assert on projected shape; new test verifies `contentBlocks` is absent from response
