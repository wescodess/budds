# Deferred Work

## Deferred from: code review of 1-1-verify-and-harden-authentication-flow (2026-04-09)

- **Unprotected `/api/rag/*` routes** — No auth on `server/api/rag/chat.post.ts` and `search.post.ts`. Any unauthenticated user can POST to these endpoints and consume AI API credits. Add `routeRules` auth or server-side session validation.
- **SQLite single-process auth store** — `better-sqlite3` at `./data/auth.db` cannot handle multi-process or horizontally-scaled deployments. Acknowledged V1 constraint.
- **Redundant `definePageMeta({ auth: 'guest' })` in login.vue** — Duplicates the `routeRules` entry for `/login`. Remove to centralize route protection.
- **Symbol introspection for ConvexClient access** — `app/plugins/convex-auth.client.ts` accesses ConvexClient via `Object.getOwnPropertySymbols` matching `'convex-client'`. This is fragile but the only working method — `nuxtApp.$convex` provides the Vue plugin wrapper, not the client, and `inject()` requires component context. Replace when `nuxt-convex` exposes a typed plugin API.

## Deferred from: code review of 1-2-app-shell-layout-with-responsive-navigation (2026-04-10)

- **`activeTab` ref decoupled from router** — Tabs don't sync with URL; page refresh always lands on "chat". By design for story 1.2 (placeholder tabs). Refactor when study modes get real routing.
- **`<slot />` only in chat TabsContent** — All page content renders into the chat tab. Correct for now since only `/app/chat` exists. Will need refactoring when other study modes get real pages.
- **Model identifier sent to backend without validation** — Pre-existing in chat.vue. Users can modify the `<select>` value via devtools to call arbitrary provider/model combinations. Add server-side model allowlist validation.
- **`source.score * 100` assumes 0-1 range** — Pre-existing in chat.vue. Scores outside [0,1] render as nonsensical percentages. Add bounds check or handle different score formats.
- **`useRag` doesn't validate response shape** — Pre-existing composable. A malformed API response (missing `answer` field) silently pushes `{ content: undefined }` into messages.
- **Scroll-after-send fires even on error** — Pre-existing chat.vue behavior. `nextTick` scroll runs unconditionally after `await chat()`, even on failure.

## Deferred from: code review of 1-3-dashboard-home-view (2026-04-10)

- **`documentCount` denormalized field has no increment/decrement mechanism** — Will always show 0 until document upload is implemented in Epic 3. Not actionable now.
- **`lastActivity` shows folder `_creationTime` not actual last activity** — No `updatedAt` or `lastStudied` field exists in the schema. Requires data model expansion in Epic 2/3.
- **SSR hydration mismatch on dashboard** — Server renders loading skeletons, client immediately switches state after Convex subscription fires. Needs broader nuxt-convex SSR strategy.
