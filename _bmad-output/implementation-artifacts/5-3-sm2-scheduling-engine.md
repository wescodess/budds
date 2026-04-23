# Story 5.3: SM-2 Scheduling Engine

## Status: done

## Story

As a user, I want the review system to show me items at optimal intervals, so that I remember what I've learned without wasting time on easy items.

## Acceptance Criteria

1. **Given** the user rates a review item, **When** the rating is submitted, **Then** SM-2 parameters update:
   - Again (quality 0): resets interval to 1, repetitions to 0
   - Hard (quality 3): multiplies interval by 1.2
   - Good (quality 4): multiplies interval by easeFactor
   - Easy (quality 5): multiplies interval by easeFactor * 1.3
2. easeFactor adjusts: `max(1.3, easeFactor + 0.1 - (5-quality) * (0.08 + (5-quality) * 0.02))`
3. nextReviewDate set to today + new interval (in days)
4. Scheduling calculation runs in pure functions (`convex/lib/sm2.ts`)

## Tasks

- [x] 1. Create `convex/lib/sm2.ts` with pure SM-2 computation function
- [x] 2. Add `submitReview` mutation to `convex/reviewItems.ts`
- [x] 3. Wire rating buttons in review session page to call `submitReview`
- [x] 4. Add comprehensive tests for SM-2 pure functions
- [x] 5. Add Convex tests for `submitReview` mutation
- [x] 6. Run checks (lint, typecheck, test, test:component)

## Dev Agent Record

### Decisions

- SM-2 pure function placed in `convex/lib/sm2.ts` per architecture boundary (pure functions in convex/lib/), diverging from architecture spec's `server/utils/sr-scheduler.ts` since the function is called directly from Convex mutations with no network hop needed
- Quality mapping: Again=0, Hard=3, Good=4, Easy=5 per architecture spec
- `submitReview` mutation uses user timezone from learnProfile when available, falls back to UTC
- Streak update triggered on review submission (learning activity per AC in 4-3)
- Added `submitting` guard in review.vue to prevent double-rating race condition (code review blocker fix)

## File List

- `convex/lib/sm2.ts` — pure SM-2 computation
- `convex/reviewItems.ts` — submitReview mutation added
- `app/pages/app/learn/review.vue` — wired to call submitReview on rating
- `convex/lib/sm2.test.ts` — comprehensive pure function tests (28 tests)
- `convex/reviewItems.test.ts` — submitReview integration tests (8 new tests)

## Change Log

- Created `convex/lib/sm2.ts` with `computeSM2` pure function implementing SM-2 algorithm
- Added `submitReview` public mutation to `convex/reviewItems.ts` with auth, ownership, quality validation, SM-2 update, and streak trigger
- Wired review session UI to call `submitReview` on rating button click with async mutation
- Added `submitting` guard to prevent double-rating during mutation flight
- Added 28 comprehensive SM-2 pure function tests covering all quality levels, easeFactor floor, interval bounds, date calculations, progressive scheduling
- Added 8 Convex integration tests for `submitReview` (all 4 quality levels, nextReviewDate update, invalid quality rejection, auth/ownership guards, streak trigger)
- Code review: 2 blockers fixed (double-rating race condition), 3 deferred (getTodayInTimezone duplication, no flagged-item guard, arch spec location mismatch)
