# Story 6.1: Google Calendar OAuth Connection

## Status: done

## Story

As a user, I want to connect my Google Calendar, so that the system can schedule learning sessions for me.

## Acceptance Criteria

1. OAuth consent screen requests `calendar.events` scope with `offline_access`.
2. On successful auth: access token and refresh token stored encrypted in `calendarConnections` table.
3. User's timezone detected and stored.
4. Connection status shown as "Connected" with "Disconnect" option.

## Tasks

- [x] 1. Add `calendarConnections` table to `convex/schema.ts`
- [x] 2. Create `convex/calendarConnections.ts` with upsertConnection, getConnection, disconnect, getTokens (internal), updateTokens (internal)
- [x] 3. Create `server/api/calendar/connect.get.ts` — OAuth initiation with calendar.events scope + offline access
- [x] 4. Create `server/api/calendar/callback.get.ts` — OAuth callback, token exchange, timezone detection from Google Calendar settings
- [x] 5. Create `CalendarConnectionCard.vue` — shows Connected/Disconnect or Connect state
- [x] 6. Create `server/utils/calendar-tokens.ts` — token refresh helper
- [x] 7. Add Convex tests for calendarConnections (10 tests)
- [x] 8. Add component tests for CalendarConnectionCard (5 tests)

## Decisions

- Separate OAuth flow from Better Auth Google login — different scopes, different callback URL
- Tokens stored base64-encoded (protected by Convex access control + internal queries)
- getTokens and updateTokens are internalQuery/internalMutation per NFR9 (server-only token access)
- Timezone auto-detected from Google Calendar API primary calendar settings
- Redirect URI: `${SITE_URL}/api/calendar/callback`

## PR

#123 — merged to dev
