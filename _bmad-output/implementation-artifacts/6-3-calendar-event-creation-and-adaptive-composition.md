# Story 6.3: Calendar Event Creation & Adaptive Composition

## Status: done

## Story

As a user, I want time-blocked events created in my calendar with the right session type, so that I show up and the session is ready.

## Acceptance Criteria

1. Events created in Google Calendar with title `[Budds] {course_name} - {session_type}`, description including session composition and deep link.
2. Morning events (before 12:00 user timezone) favor new content, evening events favor review, commute-length slots (<=15 min) get audio-only.
3. `calendarEvents` records track each event's calendarEventId, scheduledAt, sessionType, status.

## Tasks

- [x] 1. Add `calendarEvents` table to `convex/schema.ts`
- [x] 2. Create `convex/calendarEvents.ts` with CRUD mutations/queries
- [x] 3. Create session composition logic (pure function for session type determination)
- [x] 4. Create `server/api/calendar/sync.post.ts` — calendar sync endpoint
- [x] 5. Create Google Calendar API helper for event creation
- [x] 6. Add Convex tests for calendarEvents (11 tests)
- [x] 7. Add server tests for session composition logic (17 tests)
- [x] 8. Run `pnpm test` to verify no regressions (725 pass, 1 pre-existing failure)

## Dev Agent Record

### Decisions

- `calendarEvents.create` is `internalMutation` — only the server sync endpoint creates events, never client directly (per NFR9 server-only token handling)
- `updateStatus` is a public mutation — client can mark events completed/missed
- `deleteByCourse` and `deleteByUser` are internal mutations for cascade cleanup
- Session composition is a pure function in `server/utils/session-composition.ts` — testable without Convex or network mocks
- Google Calendar API helper is a thin wrapper around the Events API — token decoding from base64 happens at the helper level
- Sync endpoint refreshes tokens if within 60s of expiry before making API calls
- Slot scheduling finds the next preferred day starting from tomorrow, up to 14 days out
- ATDD skipped — story has no UI-testable ACs; acceptance tests are the Convex integration tests + pure function unit tests

## File List

- `convex/schema.ts` — added `calendarEvents` table
- `convex/calendarEvents.ts` — CRUD mutations/queries (listByUser, listByCourse, listScheduled, create, updateStatus, deleteByCourse, deleteByUser, getScheduledByUser)
- `server/utils/session-composition.ts` — pure functions: determineSessionType, buildEventTitle, buildEventDescription, getScheduledHourInTimezone
- `server/utils/google-calendar.ts` — createGoogleCalendarEvent, deleteGoogleCalendarEvent
- `server/api/calendar/sync.post.ts` — calendar sync endpoint creating events per active course
- `convex/calendarEvents.test.ts` — 11 Convex integration tests
- `server/utils/session-composition.test.ts` — 17 unit tests

## Change Log

- Added `calendarEvents` table with userId, calendarConnectionId, calendarEventId, courseId, scheduledAt, sessionType, status, description fields
- Created CRUD layer in `convex/calendarEvents.ts` with internal create/delete mutations and public query/update functions
- Implemented session composition logic: morning < 12:00 = new-content, evening >= 12:00 = review, slots <= 15 min = audio-only
- Built Google Calendar API helper for event creation with base64 token decoding
- Created sync endpoint that reads preferences, finds active courses, determines session types, creates Google Calendar events, and stores records
