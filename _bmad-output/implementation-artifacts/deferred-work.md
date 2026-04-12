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

## Deferred from: code review of story-4.2 (2026-04-11)

- **Streaming test doesn't verify source-before-AI ordering** — Test uses `expect(output).toContain` to check both sources and AI data exist, but doesn't assert their relative order. The transform's purpose is that sources come first. Add an `indexOf` comparison.

## Deferred from: code review of story-3.3 (2026-04-11)

- **Move folder picker renders flat list, not a tree** — Spec mentions "folder tree via a Dialog" but implementation shows a flat list of all folders. Nested folders with the same name are indistinguishable. UX enhancement, not a functional bug.

## Deferred from: code review of story-3.2 (2026-04-11)

- **`deleteDocument` does not remove document from Cloudflare AI Search index** — Deleted documents remain searchable. Story 3.3 ("Delete Documents and Move Between Folders") should handle AI Search cleanup.
- **No retry/idempotency mechanism for Cloudflare upsert** — Transient Cloudflare failures permanently mark documents as "failed" with no recovery path. Consider a retry queue or manual re-ingest action.
- **Race condition: file deletion between `createDocument` commit and `ingestDocument` execution** — If a user deletes a document before the scheduled action runs, ingestion fails with "File not found". Handled gracefully but not preventable.
- **No timeout wrapping for `pdf-parse`** — Malformed/corrupt PDFs could hang the action. Convex platform timeout (~300s) provides a safety net but the user sees a stuck "processing" state.
- **`pdf-parse` npm package test-file side effect** — On import, `pdf-parse` attempts to load a test PDF fixture from `node_modules`. May crash in Convex's serverless Node runtime if the fixture is excluded from deployment.
- **Documents table lacks `createdAt`/`updatedAt` fields** — Cannot track processing duration or identify stale "processing" documents. Observability gap, not a functional bug.

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
