# Story 5.2: Daily Review Session UI

**Status:** in-progress
**Epic:** 5 — Spaced Repetition
**Created:** 2026-04-23

## User Story

As a user, I want a focused daily review session, so that I can reinforce my learning in a few minutes.

## Acceptance Criteria

1. Items queried where `nextReviewDate <= today`, ordered by nextReviewDate ASC (most overdue first), limited by daily cap (default 50).
2. Items presented one at a time as large centered cards with the prompt.
3. "Tap to reveal" shows the answer.
4. After reveal: 4 rating buttons (Again/Hard/Good/Easy) color-coded (red/amber/green/teal).
5. Source attribution below card ("From: Course Name, Section N").
6. "Flag as incorrect" link below rating buttons.
7. Progress bar and item count (n/m) update as user progresses.
8. Keyboard shortcuts: Space=reveal, 1=Again, 2=Hard, 3=Good, 4=Easy, f=flag.
9. On mobile: card spans full width, rating buttons span full width at 48px height.

## Tasks

- [x] 1. Add `listDueWithContext` query to convex/reviewItems.ts (enriches items with course title and section title)
- [x] 2. Create `ReviewCard.vue` — large centered card with prompt, tap-to-reveal answer, source attribution
- [x] 3. Create `ReviewRatingButtons.vue` — 4 rating buttons (Again/Hard/Good/Easy) color-coded
- [x] 4. Create `ReviewSessionProgress.vue` — progress bar + item count
- [x] 5. Create `/app/pages/app/learn/review.vue` — review session page with keyboard shortcuts, flag link
- [x] 6. Add component tests for ReviewCard, ReviewRatingButtons, ReviewSessionProgress, and review page
- [x] 7. Run `pnpm test:component` to verify no regressions

## Dev Agent Record

### Decisions

- Rating buttons do NOT call SM-2 mutations yet — that is story 5-3. Ratings advance to next card and store quality locally.
- `listDueWithContext` enriches each review item with course.title and section.title + section.order for source attribution, limited by daily cap from learnProfile.
- Flag action reuses existing `contentFlags.flagFlashcard` mutation since review items are extracted from flashcard room cards.
- Keyboard shortcuts are document-level event listeners scoped to the review page only, cleaned up on unmount.

## File List

- `convex/reviewItems.ts` — added `listDueWithContext` query
- `app/components/learn/ReviewCard.vue` — new
- `app/components/learn/ReviewRatingButtons.vue` — new
- `app/components/learn/ReviewSessionProgress.vue` — new
- `app/pages/app/learn/review.vue` — new
- `tests/component/learn/review-card.test.ts` — new
- `tests/component/learn/review-rating-buttons.test.ts` — new
- `tests/component/learn/review-session-progress.test.ts` — new
- `tests/component/learn/review-page.test.ts` — new

## Change Log

- Added `listDueWithContext` query to reviewItems.ts that joins course/section data for source attribution
- Created ReviewCard.vue with prompt display, tap-to-reveal animation, and source attribution
- Created ReviewRatingButtons.vue with 4 color-coded rating buttons (red/amber/green/teal)
- Created ReviewSessionProgress.vue with progress bar and item counter
- Created review session page at /app/pages/app/learn/review.vue
- Wired keyboard shortcuts (Space=reveal, 1-4=rate, f=flag)
- Added flag link that opens inline correction editor via existing contentFlags.flagFlashcard
- Mobile-responsive: full-width card and 48px rating buttons
