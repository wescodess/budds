# Story 3.4: Section Completion & Adaptive Pacing

## Status: in-progress

## Story

As a user, I want feedback when I complete a section and adaptive difficulty going forward, so that I know how I'm doing and the course adjusts to my level.

## Acceptance Criteria

1. **Given** the user finishes the last content block in a section, **When** the section completion card appears, **Then** it shows: accuracy percentage, mastery level, and count of concepts added to review queue.
2. Two action buttons: "Continue to Section N+1" (primary) and "Back to Course Overview" (ghost).
3. Section status updates to `'completed'` with `practiceScore` and `masteryLevel` saved.
4. If accuracy < 60%: the completion card shows adaptive feedback text and the next section's generation parameters increase foundational practice items.
5. If accuracy > 90%: the next section reduces practice block size.
6. The user can override the AI content format for the next section (FR16).

## Tasks

- [x] 1. Add `completeSection` mutation to `convex/courseSections.ts`
- [x] 2. Create `SectionCompletionCard.vue` component
- [x] 3. Wire completion flow into section void page
- [x] 4. Add adaptive feedback logic (threshold-based text + mastery level computation)
- [x] 5. Handle "Continue to N+1" navigation (check if next section exists and is ready)
- [x] 6. Add Convex tests for completeSection mutation
- [x] 7. Add component tests for SectionCompletionCard
- [ ] 8. Run `pnpm test` and `pnpm test:component` to verify no regressions
- [ ] 9. Commit, push, open PR to `dev`

## Dev Agent Record

### Decisions

- Review queue count: Since spaced repetition (Epic 5) is not yet implemented, the "concepts added to review queue" count will show 0 with text "Concepts ready for future review". This is accurate and honest per the current state.
- FR16 (format override): Implementing as a simple dropdown on the completion card allowing users to override the AI content format preference for the next section. Stored on the course as `nextSectionFormatOverride` is not feasible without schema changes to courses table. Instead, passing the override as part of the section generation trigger metadata when pre-fetching N+1.
- Adaptive pacing: Stored as adaptive hints in the `triggerPreFetch` metadata rather than modifying the course schema. The section generation pipeline (3-1) already reads task metadata.

## File List

- `convex/courseSections.ts` — added `completeSection` mutation
- `app/components/learn/SectionCompletionCard.vue` — new component
- `app/pages/app/learn/[courseId]/[sectionId].vue` — wired completion flow
- `convex/courseSections.test.ts` — added completeSection tests
- `tests/component/learn/section-completion-card.test.ts` — new component tests

## Change Log

- Added `completeSection` mutation: validates ownership, computes masteryLevel from practiceScore, updates section status to completed, increments course completedSectionCount
- Created SectionCompletionCard: accuracy percentage ring, mastery badge, adaptive feedback text, Continue/Back buttons
- Wired section void page to show completion card after last block, with quiz score tracking
- Adaptive pacing: <60% shows "needs more practice" feedback, >90% shows "advanced" feedback
- Format override dropdown for next section content preference
