# Story 5.5: Review Session Completion & Daily Review CTA

## Status: done

## Story

As a user, I want to see my review results and have easy access to daily review, so that review becomes part of my routine.

## Acceptance Criteria

1. Completion card shows: items reviewed, correct count, streak update.
2. A `reviewSessions` record is created with date, itemsReviewed, itemsCorrect, durationMs.
3. Streak is updated if this is the first review of the day.
4. Daily Review CTA card on Learn Home shows item count and estimated duration.
5. CTA disappears when no items are due.

## Tasks

- [x] 1. Add `reviewSessions` table to `convex/schema.ts`
- [x] 2. Create `completeReviewSession` mutation in `convex/reviewItems.ts`
- [x] 3. Wire session completion into review page (track start time, call mutation on finish)
- [x] 4. Create `DailyReviewCTA.vue` component for Learn Home
- [x] 5. Wire CTA into Learn Home page using `getReviewBacklogCount`
- [x] 6. Add Convex tests for `completeReviewSession`
- [x] 7. Add component tests for DailyReviewCTA

## Decisions

- Session duration tracked from page mount to completion button click
- `completeReviewSession` also calls `updateStreakForActivity` (idempotent with `submitReview` streak calls)
- CTA shows estimated duration at ~15s per item
- CTA hidden when `getReviewBacklogCount` returns 0

## PR

#122 — merged to dev
