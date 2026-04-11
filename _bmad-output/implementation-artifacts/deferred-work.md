# Deferred Work

## Resolved during Epic 2 retrospective prep (2026-04-11)

- **~~Unprotected `/api/rag/*` routes~~** — Added `requireUserSession(event)` to `chat.post.ts` and `search.post.ts`. Unauthenticated requests now return 401.
- **~~`handleCreateSubfolder` uses `window.prompt()`~~** — Replaced with inline input in FolderTree. Emit now sends `(parentId, name)` directly.
- **~~SSR hydration mismatch on dashboard~~** — Added `hydrated` ref with `onMounted` gate. Server and initial client render both show skeletons until after hydration.
- **~~Auth config test assertions stale~~** — Removed 2 tests asserting session config strings that no longer exist in simplified `server/auth.config.ts`.
- **~~Folder-view test missing composable mock~~** — Added `mockNuxtImport` for `useFolderDetail`, `useFolders`, and `useRoute`.

## Resolved during Epic 1 retrospective prep (2026-04-10)

- **~~Component test infrastructure not runnable~~** — Added `vitest.config.component.ts` with `@nuxt/test-utils` nuxt environment + happy-dom. Added `test:component` npm script. All 8 test files (59 tests) now discoverable.
- **~~`lastActivity` shows folder `_creationTime` not actual last activity~~** — Added `updatedAt` field to folders schema. `CourseCard.vue` now uses `updatedAt ?? _creationTime`. `createFolder` sets `updatedAt: Date.now()`.
- **~~JWKS bootstrap undocumented~~** — Created `scripts/bootstrap-jwks.sh` automation script and documented setup steps in `CLAUDE.md`.

## Deferred from: code review of story-3.1 (2026-04-11)

- **`updateDocumentStatus` doesn't clear `failureReason` on non-failure transitions** — When status moves from 'failed' to 'success'/'processing', old `failureReason` persists in DB. Not user-visible (FileStatusItem only renders it for 'failed') but stale data.
- **`folderDepth` defaults to 1 while `allFolders` loads** — "New Subfolder" button briefly shows for deeply nested folders during initial load. Pre-existing from Epic 2.

## Deferred from: code review of 1-1-verify-and-harden-authentication-flow (2026-04-09)

- **~~Unprotected `/api/rag/*` routes~~** — Resolved in Epic 2 retro prep (2026-04-11).
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

## Deferred from: code review of 2-2-rename-and-delete-folders (2026-04-10)

- **~~`handleCreateSubfolder` uses `window.prompt()`~~** — Resolved in Epic 2 retro prep (2026-04-11).
- **Component tests lack interaction-level coverage** — Rename/delete tests only verify element existence, not actual user interaction flows (trigger rename → type → Enter → verify emit).
- **`onSelect` both emits and navigates** — FolderTree emits `select` event AND calls `navigateTo` directly, leaking navigation responsibility. Pre-existing from Story 2.1.
- **Dynamic `await import('vue-sonner')` on every toast call** — Imports vue-sonner fresh on every error/success path instead of a top-level import. Pre-existing pattern across the app.
