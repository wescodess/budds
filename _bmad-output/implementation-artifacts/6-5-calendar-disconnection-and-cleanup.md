# Story 6.5: Calendar Disconnection & Cleanup

## Status: review

## Story

As a user, I want to disconnect my calendar and remove all events, so that I can stop calendar integration cleanly.

## Acceptance Criteria

1. When user clicks "Disconnect", all `calendarEvents` for this user are deleted from Google Calendar via the API.
2. The `calendarConnections` record is deleted (tokens removed).
3. The connection UI resets to the "Connect" state.

## Tasks

- [x] 1. Create `server/api/calendar/disconnect.post.ts` — server endpoint that: gets user's calendar events, deletes each from Google Calendar (best-effort), deletes all calendarEvents from Convex, deletes calendarConnection record
- [x] 2. Update `disconnect` mutation in `convex/calendarConnections.ts` to also delete all calendarEvents for the user
- [x] 3. Update `CalendarConnectionCard.vue` — change Disconnect button to call server endpoint, add confirmation dialog
- [x] 4. Add tests for the disconnect flow
- [x] 5. Run `pnpm test` to verify no regressions

## File List

- `server/api/calendar/disconnect.post.ts` — full cleanup endpoint (Google Calendar deletion + Convex cleanup)
- `convex/calendarConnections.ts` — updated `disconnect` mutation to also delete calendarEvents
- `app/components/learn/CalendarConnectionCard.vue` — uses server endpoint, confirmation dialog before disconnect
- `convex/calendarConnections.test.ts` — added test for cascading event deletion on disconnect

## Dev Agent Record

### Decisions

- **Unified disconnect mutation**: Rather than adding a separate `deleteConnectionByUser` internal mutation, the existing public `disconnect` mutation was enhanced to also delete all `calendarEvents` for the user. This keeps cleanup atomic in a single Convex transaction and avoids the need for the server endpoint to make a separate internal mutation call. The server endpoint handles Google Calendar API deletion (best-effort), then calls the existing `disconnect` mutation which handles both Convex-side cleanups.

- **Best-effort Google Calendar deletion**: The server endpoint iterates all user events and attempts to delete each from Google Calendar. Individual failures are logged but do not block the disconnect flow. This matches the project convention established in `deleteGoogleCalendarEvent` (which already handles 410 Gone gracefully).

- **Confirmation dialog**: Added an inline confirmation dialog (alertdialog role) to `CalendarConnectionCard.vue` since disconnect is a destructive action that removes events from Google Calendar. Uses Teleport to body for proper z-index stacking.

- **Server endpoint pattern**: Follows the same `makeConvexClient` + `getConvexTokenIdentifier` pattern established in `sync.post.ts` and `callback.get.ts`. Token refresh is attempted before deletion to handle expired access tokens.

## Change Log

- Created `server/api/calendar/disconnect.post.ts`: authenticates user, refreshes tokens if needed, fetches all calendarEvents, deletes each from Google Calendar (best-effort), calls `disconnect` mutation for Convex cleanup
- Updated `disconnect` mutation in `convex/calendarConnections.ts` to delete all calendarEvents for the user before deleting the connection record
- Updated `CalendarConnectionCard.vue`: replaced direct Convex mutation call with `$fetch('/api/calendar/disconnect')`, added confirmation dialog with cancel/confirm buttons
- Added Convex test: `disconnect also deletes all calendarEvents for the user` — creates connection + 2 events, disconnects, verifies both events and connection are deleted
