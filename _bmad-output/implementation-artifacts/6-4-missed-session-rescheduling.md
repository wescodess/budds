# Story 6.4: Missed Session Rescheduling

## Status: in-progress

## Story

As a user, I want missed sessions to be automatically rescheduled, so that I don't fall behind.

## Acceptance Criteria

1. A scheduled session that was missed (scheduledAt < now AND status = 'scheduled') is marked 'missed'.
2. A new event is created at the next available slot based on user preferences.
3. The new event is marked 'rescheduled'.

## Tasks

- [x] 1. Add `checkAndMarkMissed` internal mutation to `convex/calendarEvents.ts` — finds events where scheduledAt < now and status = 'scheduled', marks them 'missed', returns list of missed events with context
- [x] 2. Add `findNextSlot` pure function to `server/utils/session-composition.ts` — extracted from sync endpoint's `findNextPreferredSlot`, reusable for rescheduling
- [x] 3. Create `server/api/calendar/check-missed.post.ts` — server endpoint that: fetches missed events, refreshes tokens, finds next slot, creates Google Calendar event, stores rescheduled event in Convex
- [x] 4. Add `triggerCheckMissed` internal action to `convex/calendarEvents.ts` — calls the server endpoint via HTTP, triggered by cron
- [x] 5. Register hourly cron in `convex/crons.ts` to trigger the missed session check
- [x] 6. Add Convex tests for missed detection and rescheduling logic
- [x] 7. Run `pnpm test` to verify no regressions

## File List

- `convex/calendarEvents.ts` — added `checkAndMarkMissed` internal mutation, `createRescheduled` internal mutation
- `convex/crons.ts` — added hourly `check missed calendar sessions` cron
- `server/utils/session-composition.ts` — extracted `findNextPreferredSlot` as public export
- `server/api/calendar/check-missed.post.ts` — server endpoint for missed session check and rescheduling
- `convex/calendarEvents.test.ts` — added tests for missed detection and rescheduling

## Dev Agent Record

### Decisions

- **Rescheduling via server endpoint**: Since Google Calendar API calls need HTTP (not Convex action), the hourly check uses a Convex cron that triggers a Convex internal action, which calls the Nuxt server endpoint `/api/calendar/check-missed.post.ts`. The server endpoint handles: token refresh, Google Calendar event creation, and storing the rescheduled event back in Convex. This follows the same pattern as the existing sync endpoint.

- **New event status = 'rescheduled'**: Per AC3, the new event created to replace a missed session is marked 'rescheduled' rather than 'scheduled'. This distinguishes it in the UI and analytics.

- **Slot calculation reuse**: Extracted `findNextPreferredSlot` and `getTimezoneOffsetMs` from the sync endpoint into `session-composition.ts` as shared utilities, so both sync and rescheduling use the same slot-finding logic.

- **Cron triggers action, not mutation directly**: The cron invokes an internal action that makes the HTTP call to the server endpoint. Convex actions can use fetch; mutations cannot. The action pattern isolates the side-effect (HTTP call) correctly.

- **Per-user processing**: The check-missed endpoint processes one user at a time. The cron action queries all users with calendar connections and processes sequentially. For scale, this could be parallelized, but for the current user base this is sufficient.

## Change Log

- Added `checkAndMarkMissed` internal mutation: queries scheduled events where scheduledAt < now, patches each to 'missed' status, returns missed event details
- Added `createRescheduled` internal mutation: creates a new calendar event with 'rescheduled' status
- Added `getAllConnectedUserIds` internal query: returns distinct user IDs with active calendar connections
- Added `checkMissedSessions` internal action: orchestrates the missed session check across all users via the server endpoint
- Registered hourly cron job `check missed calendar sessions` in crons.ts
- Extracted `findNextPreferredSlot` and `getTimezoneOffsetMs` from sync endpoint to session-composition.ts
- Created `server/api/calendar/check-missed.post.ts` endpoint for server-side rescheduling
- Added 5 Convex tests covering missed detection, rescheduled event creation, and edge cases
