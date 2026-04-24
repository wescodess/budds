# Story 5.4: Cross-Course Review Budgeting

## Status: review

## Story

As a user, I want my daily review to be manageable even with multiple courses, so that I don't get overwhelmed by review debt.

## Acceptance Criteria

1. Items drawn from all courses in a single priority queue (most overdue first).
2. Configurable daily cap (default 50) limits session size.
3. "Minimum viable review" option allows completing just top 5-10 highest-priority items (~2-3 min).
4. If review backlog exceeds 2x daily cap, warning appears during course creation.

## Context

- AC #1 and #2 already implemented by `listDueWithContext` (5-2) which queries all due items across courses ordered by nextReviewDate ASC, capped by dailyReviewCap from learnProfile.
- `learnProfile` has `dailyReviewCap` field (default 50).
- Review session page at `/app/learn/review` (5-2) loads and displays items.
- This story adds: AC #3 quick review mode, AC #4 backlog warning on course creation.

## Tasks

- [x] 1. Add `getReviewBacklogCount` query to `convex/reviewItems.ts`
- [x] 2. Add quick review mode to the review session page (mode toggle, limit to 10 items)
- [x] 3. Add backlog warning to course creation flow in `SourceSelector.vue`
- [x] 4. Add daily cap configuration UI to learn profile (ReviewCapSetting component on review page)
- [x] 5. Add Convex tests for `getReviewBacklogCount` query and `updateDailyReviewCap` mutation
- [x] 6. Add component tests for backlog warning and ReviewCapSetting
- [x] 7. Run checks (test, test:component)

## Dev Agent Record

### Decisions

- AC #1 and #2 were already satisfied by `listDueWithContext` from 5-2. No additional work needed.
- Quick review mode implemented via `?mode=quick` query parameter on `/app/learn/review` rather than a separate page. The `listDueWithContext` query accepts an optional `mode` arg; `quick` limits to `min(10, dailyCap)`.
- Backlog warning threshold: `dueCount > dailyCap * 2` per FR32/AC#4. Warning includes a link to the review page.
- Daily cap setting placed on the review page header as a gear icon dropdown rather than a separate settings page, since it's contextually relevant during review sessions.
- `updateDailyReviewCap` mutation validates cap between 5-200 and rounds to integer.
- Mode toggle uses a pill-style segmented control in the header that only appears when the session has items.

## File List

- `convex/reviewItems.ts` — added `getReviewBacklogCount` query, added `mode` arg to `listDueWithContext`
- `convex/learnProfile.ts` — added `updateDailyReviewCap` mutation
- `app/pages/app/learn/review.vue` — quick review mode toggle, daily cap setting, quick mode badge
- `app/components/learn/SourceSelector.vue` — backlog warning banner
- `app/components/learn/ReviewCapSetting.vue` — daily cap configuration UI (new)
- `convex/reviewItems.test.ts` — tests for getReviewBacklogCount, quick mode, updateDailyReviewCap
- `tests/component/learn/source-selector.test.ts` — tests for backlog warning
- `tests/component/learn/review-cap-setting.test.ts` — tests for ReviewCapSetting (new)

## Change Log

- Added `getReviewBacklogCount` public query returning `{ dueCount, dailyCap }` for backlog threshold detection
- Extended `listDueWithContext` with optional `mode` arg: `quick` limits to min(10, dailyCap) items
- Added `updateDailyReviewCap` mutation with 5-200 range validation
- Added quick/full mode toggle to review page header with Zap icon for quick mode
- Added quick mode badge below progress bar when in quick review mode
- Added `ReviewCapSetting` component with gear icon toggle, number input, save/cancel
- Added backlog warning banner to `SourceSelector` when due count > 2x daily cap
- Added 11 new Convex tests (4 getReviewBacklogCount, 3 quick mode, 4 updateDailyReviewCap)
- Added 3 new component tests for backlog warning, 4 for ReviewCapSetting
- 680 Convex tests pass, 409 component tests pass
- Code review: 2 blockers fixed (mode switch mid-session no-op, click-outside-to-close on cap dropdown), 3 deferred (unused isLoading, backlog post-filter, Escape key on dropdown)
