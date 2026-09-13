# Auth Flows

## 1. Google OAuth Login Flow

1. User clicks "Sign in with Google" on `/login`.
2. Client calls `signIn.social({ provider: 'google', callbackURL: '/app' })` via `@onmax/nuxt-better-auth`.
3. This sends `POST /api/auth/sign-in/social` with `{ provider: "google", callbackURL: "/app" }`.
4. The Nitro auth-proxy middleware (`server/middleware/auth-proxy.ts`) intercepts all `/api/auth/*` requests and forwards them to the Convex HTTP endpoint (`CONVEX_SITE_URL/api/auth/...`). It sets `x-forwarded-host`, `x-forwarded-proto`, and `origin` headers so Better Auth can construct correct redirect URLs.
5. Better Auth on Convex returns a redirect to Google's OAuth consent screen (`accounts.google.com/o/oauth2/v2/auth`) with the configured `GOOGLE_CLIENT_ID` and redirect URI `${CONVEX_SITE_URL}/api/auth/callback/google`.
6. User authenticates with Google and grants consent.
7. Google redirects to `${CONVEX_SITE_URL}/api/auth/callback/google` with an authorization code.
8. Better Auth on Convex exchanges the code for tokens, creates or updates the user record in the Convex database, and creates a session.
9. Better Auth sets a session cookie (`better-auth.session_token`) and redirects the user to the `callbackURL` (`/app`).
10. The auth-proxy rewrites the redirect Location header to point to the requesting origin (handles localhost vs production discrepancies).
11. The auth-proxy rewrites Set-Cookie headers for localhost (strips `Domain`, removes `Secure`, changes `SameSite=None` to `SameSite=Lax`).
12. On page load, `convex-auth.client.ts` plugin watches `loggedIn` state. When authenticated, it calls `convexClient.client.setAuth(fetchToken, callback)` which triggers a token exchange.
13. The `fetchToken` function calls `GET /api/auth/convex/token` to obtain a Convex JWT.
14. Once authenticated with Convex, the plugin calls `users:upsertUser` mutation to ensure the user record exists.

## 2. Session Management

- **Session cookie**: `better-auth.session_token`, set by Better Auth via the Convex HTTP action.
- **Session lifetime**: 30 days (`expiresIn: 60 * 60 * 24 * 30` seconds).
- **Session refresh**: Sessions are refreshed (updateAge) every 24 hours (`updateAge: 60 * 60 * 24`). When a session is accessed and its age exceeds 24 hours, the expiry is extended.
- **Cookie properties**: In production, cookies are `Secure; SameSite=None`. For localhost, the auth-proxy strips `Domain`, removes `Secure`, and sets `SameSite=Lax`.
- **Client-side state**: `useUserSession()` from `@onmax/nuxt-better-auth` exposes `loggedIn` and `ready` reactives. SSR mode (`clientOnly: false`) means session state is available during server-side rendering.

## 3. Convex Token Provisioning

### SSR (Server-Side Rendering)

1. On every SSR request, the `server/middleware/convex-token.ts` middleware runs.
2. It reads the session cookie from the incoming request headers.
3. It calls `${CONVEX_SITE_URL}/api/auth/convex/token` with the cookie forwarded.
4. If successful, the returned JWT is stored in `event.context.convexToken`.
5. Downstream Nitro API handlers access `event.context.convexToken` for authenticated Convex operations.
6. If the token exchange fails (no cookie, expired session, network error), `convexToken` is not set. SSR queries run without auth; client-side auth takes over after hydration.

### Client-Side

1. `convex-auth.client.ts` plugin registers a `fetchToken` callback with the Convex client.
2. `fetchToken` calls `GET /api/auth/convex/token` (proxied through auth-proxy to Convex).
3. The Convex client manages token refresh internally using the callback.
4. When the user logs out, `convexClient.client.clearAuth()` is called.

### Token Identity Extraction

Server API handlers call `getConvexTokenIdentifier(event)` from `server/utils/convex-identity.ts`. This:
1. Reads `event.context.convexToken`.
2. Throws 401 if absent.
3. Decodes the JWT payload (base64url) and returns `${iss}|${sub}` as the user identifier.

## 4. Protected Routes

### Client-Side Protection

`app/plugins/auth-redirect.client.ts` watches `loggedIn`, `ready`, and `route.path`. Protected paths:
- `/` (root)
- `/chat`
- `/app`
- `/app/*` (all sub-routes)

When `ready=true`, `loggedIn=false`, and the current path matches a protected pattern, the user is redirected to `/login` with `replace: true`.

### Server-Side Protection

All API endpoints that call `getConvexTokenIdentifier(event)` implicitly require auth. If `event.context.convexToken` is not set (user not authenticated), a 401 error is thrown. This applies to:
- All RAG endpoints (`/api/rag/*`)
- Chat endpoint (`/api/chat/general`)
- Course endpoints (`/api/course/*`)
- Quiz endpoints (`/api/quiz/*`)
- Flashcard endpoint (`/api/flashcards/generate`)
- Audio overview endpoints (`/api/audio-overview/*`)
- Calendar endpoints (`/api/calendar/disconnect`, `/api/calendar/sync`)
- Export endpoint (`/api/export/me`)
- Learn endpoint (`/api/learn/section-cache-payload`)

Exceptions:
- `/api/calendar/connect` does not require a Convex token (it starts OAuth)
- `/api/calendar/callback` validates via CSRF state cookie, not Convex token

## 5. Logout Flow

1. Client calls `signOut()` from `useUserSession()`.
2. This sends `POST /api/auth/sign-out` via the auth-proxy to Convex.
3. Better Auth invalidates the session in the database and clears the session cookie.
4. `convex-auth.client.ts` watches `loggedIn` go to `false`, calls `convexClient.client.clearAuth()`, and resets the `upsertDone` flag.
5. `auth-redirect.client.ts` detects `loggedIn=false` on a protected route and redirects to `/login`.

## 6. Edge Cases for QA Testing

### Expired Session
- Let a session expire (30 days) or manually delete the session cookie.
- Accessing a protected route should redirect to `/login`.
- API calls should return 401.
- The `convex-token` middleware should fail silently and not crash SSR.

### Invalid/Revoked OAuth Token
- Revoke the Google OAuth grant from the Google Account settings.
- The existing session remains valid until it expires (Better Auth sessions are independent of OAuth token validity).
- Calendar operations will fail because they use the stored Google access/refresh tokens. Verify graceful error handling on `/api/calendar/sync` and `/api/calendar/disconnect`.

### Multiple Tabs
- Log in on one tab, verify all other tabs pick up the session (cookie-based, shared across tabs).
- Log out on one tab. Other tabs should detect the session loss on next navigation or API call. The `auth-redirect` plugin runs on route changes, not continuously.
- Verify no stale Convex subscriptions remain after logout in another tab.

### Direct URL Access to Protected Routes When Unauthenticated
- Navigate directly to `/app/some-folder-id` without a session.
- SSR should render without auth data (convex-token middleware fails silently).
- After hydration, `auth-redirect.client.ts` should redirect to `/login`.
- Verify no flash of protected content before redirect.

### Token Refresh Failures
- Simulate `GET /api/auth/convex/token` returning an error (e.g., Convex deployment down).
- The Convex client's `setAuth` callback receives `isAuthenticated=false`.
- Client-side queries should degrade (run without auth or show error state).
- SSR should continue functioning without the Convex token.

### Network Interruption During OAuth Flow
- Start the Google OAuth flow, then disconnect the network before the callback.
- The callback endpoint should handle missing/invalid `code` parameter and redirect to `/app/learn?calendar_error=no_code` (for calendar) or show an error page (for login).
- Verify the CSRF state cookie (`calendar_oauth_state`) expires after 10 minutes, preventing replay.
- For login OAuth: if the callback to Convex fails, Better Auth should redirect with an error. The auth-proxy preserves error responses.

### Session Cookie Manipulation
- Modify the `better-auth.session_token` cookie value.
- The token exchange at `/api/auth/convex/token` should fail.
- SSR middleware should catch the error and proceed without auth.
- Client should redirect to `/login`.

### Concurrent Auth State
- Log in with one Google account, then try to log in with a different Google account in the same browser.
- Better Auth should replace the session. Verify the user record and Convex subscriptions update correctly.

### Account Deletion
- Call `POST /api/auth/delete-user`.
- Verify the `beforeDelete` hook runs `accountDeletion.deleteCurrentUser` mutation.
- Session should be invalidated after deletion.
- Subsequent access attempts should redirect to `/login`.
