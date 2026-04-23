# Story 4.3: Streak System

## Status: review

## Story

As a user, I want to see my daily learning streak, so that I can build a consistent study habit.

## Acceptance Criteria

1. **Given** the user completes any section or review session, **When** the streak is evaluated, **Then** the streak counter increments if last streak date was yesterday, stays same if today.
2. Streak resets to 1 if more than 1 day passed (unless freeze used).
3. Streak display: flame icon (amber active, dim frozen) + counter + "days".
4. Streak freeze: one free per week (resets Monday), consuming a freeze prevents streak break for one missed day.
5. When a streak breaks: no guilt message, counter resets to 0.
6. Streak data stored in `learnProfile`: `streakCurrent`, `streakLastDate`, `streakFreezeAvailable`, `streakFreezeUsedAt`.
7. If `learnProfile` doesn't exist, create on first section completion or review.

## Tasks

- [x] 1. Read existing learnProfile schema and StreakDisplay to understand current state
- [x] 2. Create `updateStreak` internal helper/mutation in `convex/learnProfile.ts`
- [x] 3. Add `getOrCreateProfile` helper to ensure learnProfile exists
- [x] 4. Wire streak update into `completeSection` mutation
- [x] 5. Wire streak update into `reviewSection` mutation
- [x] 6. Add streak freeze logic (consume freeze, weekly reset on Monday)
- [x] 7. Update StreakDisplay.vue to show freeze availability indicator
- [x] 8. Add Convex tests for streak transitions (increment, same-day, break, freeze)
- [x] 9. Run checks

## Dev Agent Record

### Decisions

- learnProfile schema already has all required streak fields (streakCurrent, streakLastDate, streakFreezeAvailable, streakFreezeUsedAt). No schema changes needed.
- StreakDisplay.vue already renders flame/snowflake icons with counter. Minor enhancement: show freeze availability.
- Streak evaluation logic will be a pure helper function `evaluateStreak()` for testability, called by an internal mutation `updateStreakAfterActivity`.
- completeSection and reviewSection will call the internal streak mutation via `ctx.runMutation`.
- Timezone: AC says "calendar day (user's timezone)" but learnProfile.timezone is optional and may be null. Default to UTC when timezone is not set. This is a tier-1 decision per orchestrator policy.

## File List

- `convex/learnProfile.ts` — streak mutations and helpers
- `convex/lib/streak.ts` — pure streak evaluation logic
- `convex/courseSections.ts` — wire streak updates into completeSection/reviewSection
- `app/components/learn/StreakDisplay.vue` — freeze availability display
- `convex/learnProfile.test.ts` — Convex tests for streak system

## Change Log

- Created story file
- Created `convex/lib/streak.ts` with pure `evaluateStreak()` function handling all streak transitions
- Updated `convex/learnProfile.ts` with `getOrCreateProfile` and `updateStreakForActivity` helpers
- Wired streak updates into `completeSection` and `reviewSection` mutations in `convex/courseSections.ts`
- Replaced inline learnProfile creation in `convex/courses.ts` with shared `getOrCreateProfile` (fixed default `streakFreezeAvailable` from `false` to `true`)
- Updated `StreakDisplay.vue` to accept `streakFreezeAvailable` prop and render shield icon when freeze is available
- Updated Learn Home page to pass `streakFreezeAvailable` prop to StreakDisplay
- Added 15 tests: 8 pure logic tests for streak evaluation, 4 integration tests for streak-via-completeSection/reviewSection, 3 getProfile query tests
- Updated 3 existing StreakDisplay component tests and added 3 new ones for freeze indicator
