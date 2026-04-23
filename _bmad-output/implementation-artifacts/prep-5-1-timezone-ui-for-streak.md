# Story: prep-5-1-timezone-ui-for-streak

## Status: done

## Description

Add timezone-aware streak computation and a `setTimezone` mutation. Auto-detect the user's timezone from the browser and persist it to `learnProfile`. Modify `evaluateStreak` call sites to use the stored timezone for day boundary computation instead of UTC.

**Source:** Epic 4 retro action item #1. Deferred from 4-3 code review.

## Acceptance Criteria

- [x] AC1: `learnProfile` has a `setTimezone` mutation that validates and stores an IANA timezone string
- [x] AC2: `updateStreakForActivity` uses the user's stored timezone (from `learnProfile.timezone`) for day computation; falls back to UTC when no timezone is set
- [x] AC3: Auto-detect logic sets the user's timezone on first visit using `Intl.DateTimeFormat().resolvedOptions().timeZone` if not already configured
- [x] AC4: Convex tests verify timezone-aware streak evaluation (e.g., activity at 11pm EST is same day as previous EST activity, not next UTC day)
- [x] AC5: No regressions in existing test suites

## Tasks

- [x] 1. Add `setTimezone` mutation to `convex/learnProfile.ts` with IANA timezone validation
- [x] 2. Modify `updateStreakForActivity` to read `profile.timezone` and compute today's date in that timezone
- [x] 3. Add auto-detect composable `app/composables/useTimezoneSync.ts` that calls `setTimezone` on first visit
- [x] 4. Wire `useTimezoneSync` in the learn home page
- [x] 5. Add Convex tests for timezone-aware streak evaluation (5 setTimezone tests + 2 timezone-aware streak tests)
- [x] 6. Run `pnpm test` and `pnpm test:component` — all pass (617 Convex, 380 component)

## Dev Agent Record

### Decisions

- ATDD step skipped: this is a backend-focused prep story with no UI-testable acceptance criteria. The acceptance tests are Convex integration tests (Task 5).
- Timezone validation uses `toLocaleDateString('en-CA', { timeZone: tz })` which throws on invalid IANA timezone strings. This is the same approach used for timezone-aware date computation in `getTodayInTimezone`.
- The auto-detect composable uses a `watch` on the profile query to detect when the profile loads, then checks if timezone is already set. If not, it auto-detects and sets. The `synced` ref prevents duplicate calls.
- Added `useConvexMutation` mock to `tests/component/learn/learn-home.test.ts` to support the new `useTimezoneSync` composable usage in the page.
- Code review: 2 blockers fixed (duplicate Convex subscription in useTimezoneSync, race condition in synced flag). 3 deferred (no composable test, private getTodayInTimezone, learn-home-only wiring).

## File List

- `convex/learnProfile.ts` — added `setTimezone` mutation, `getTodayInTimezone` helper, updated `updateStreakForActivity` to use timezone
- `app/composables/useTimezoneSync.ts` — new, auto-detect and sync timezone on first visit (accepts profile ref, no duplicate subscription)
- `app/pages/app/learn/index.vue` — wired `useTimezoneSync(profile)`
- `convex/learnProfile.test.ts` — added 7 new tests (5 setTimezone, 2 timezone-aware streak)
- `tests/component/learn/learn-home.test.ts` — added `useConvexMutation` mock

## Change Log

- Added `setTimezone` mutation with IANA validation (try/catch on `toLocaleDateString`) and auth guard via `requireAuth`
- Added `getTodayInTimezone` helper that uses `toLocaleDateString('en-CA', { timeZone })` for timezone-aware date strings, falling back to UTC `toISOString().slice(0, 10)` when no timezone or invalid timezone
- Modified `updateStreakForActivity` to read `profile.timezone` and pass timezone-aware `todayStr` to `evaluateStreak`
- Created `useTimezoneSync` composable: accepts profile ref (no duplicate subscription), watches profile data, auto-detects timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`, calls `setTimezone` if profile exists but has no timezone set, retries on mutation failure
- Wired `useTimezoneSync(profile)` in learn home page setup
- Added 5 `setTimezone` tests: valid timezone, invalid timezone rejection, empty string rejection, auth required, profile auto-creation
- Added 2 timezone-aware streak tests: streak with stored timezone, fallback to UTC
- Fixed learn-home component tests by adding `useConvexMutation` mock
- Code review blocker fixes: removed duplicate Convex subscription (composable now accepts profile ref), fixed race condition where `synced` flag was set before confirming timezone was already stored or mutation succeeded (now resets on failure)
