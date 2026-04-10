# Deferred Work

## Deferred from: code review of 1-1-verify-and-harden-authentication-flow (2026-04-09)

- **Unprotected `/api/rag/*` routes** — No auth on `server/api/rag/chat.post.ts` and `search.post.ts`. Any unauthenticated user can POST to these endpoints and consume AI API credits. Add `routeRules` auth or server-side session validation.
- **SQLite single-process auth store** — `better-sqlite3` at `./data/auth.db` cannot handle multi-process or horizontally-scaled deployments. Acknowledged V1 constraint.
- **Redundant `definePageMeta({ auth: 'guest' })` in login.vue** — Duplicates the `routeRules` entry for `/login`. Remove to centralize route protection.
- **Symbol introspection for ConvexClient access** — `app/plugins/convex-auth.client.ts` accesses ConvexClient via `Object.getOwnPropertySymbols` matching `'convex-client'`. This is fragile but the only working method — `nuxtApp.$convex` provides the Vue plugin wrapper, not the client, and `inject()` requires component context. Replace when `nuxt-convex` exposes a typed plugin API.
