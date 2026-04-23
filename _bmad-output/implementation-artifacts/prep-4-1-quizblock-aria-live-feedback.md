# Story: prep-4-1-quizblock-aria-live-feedback

## Status: done

## Description

Add `aria-live="polite"` to the QuizBlock feedback container so screen readers announce correct/incorrect feedback when the user answers a quiz question in the section void.

**Source:** Epic 3 retro action item #1. Deferred from 3-3 code review.

## Acceptance Criteria

- [x] AC1: The feedback container in QuizBlock.vue has `aria-live="polite"` so screen readers detect and announce content changes
- [x] AC2: A component test verifies `aria-live="polite"` is present on the feedback containers
- [x] AC3: No regressions in existing test suites

## Tasks

- [x] 1. Add `aria-live="polite"` to feedback container in QuizBlock.vue
- [x] 2. Restructure feedback rendering: always-present container with `<template v-if>` inside so screen readers detect mutation
- [x] 3. Create `tests/component/learn/quiz-block.test.ts` with 6 tests including aria-live verification
- [x] 4. Run `pnpm test` and `pnpm test:component` — all pass

## Dev Agent Record

### Decisions

- The `aria-live="polite"` container must be always-rendered (not conditionally rendered with `v-if`). If the container itself is conditionally added to the DOM, screen readers may not detect the content change. Solution: wrap feedback content in an always-present `<div aria-live="polite">` with a `<template v-if>` inside for the actual content.
- Used `mockNuxtImport('useConvexQuery', ...)` pattern (consistent with AudioBlock tests) to provide mock quiz data for testing the aria-live attribute with rendered questions.

## File List

- `app/components/learn/QuizBlock.vue` — added `aria-live="polite"` to feedback container
- `tests/component/learn/quiz-block.test.ts` — new, 6 tests

## Change Log

- Replaced conditional `v-if="submitted[q._id]"` on feedback container with always-present `<div aria-live="polite">` wrapping a `<template v-if>` for screen reader compatibility
- Created quiz-block.test.ts with mock Convex data: tests container rendering, loading state, question rendering, aria-live attribute presence per question, practice label, and option aria-labels
