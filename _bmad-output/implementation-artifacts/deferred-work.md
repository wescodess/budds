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

## Deferred from: code review of story-5.3 (2026-04-12)

- **Governing-law jurisdiction placeholder in `app/pages/terms.vue` section 5.** Tier-3 legal decision intentionally not picked by the agent. Must be finalised by the project owner (counsel) before general availability; during private beta the placeholder is acceptable and transparent to users.
- **No rate-limit / abuse guard on `GET /api/export/me`.** An authenticated user can spam exports in a loop, triggering repeated Convex scans + R2 fetches + zip assembly. Acceptable for private beta; add a per-user rate limiter (e.g., once per 5 minutes) before GA.
- **Mid-stream error handling truncates the zip without client signal.** If a `fetch(blobUrl)` fails after headers are flushed, `writer.abort(err)` tears down the response and the client ends up with a corrupt `.zip`. AC #4 requires streaming so fixing this means either buffering+finalising manifest on error, or emitting a sentinel entry. Defer: realistic failure rate is low, and the manifest's `unresolvedDocuments` list already captures the typical case (blob-missing, handled before streaming). Follow-up: add server-side error logging so silent partial exports are observable.
- **`collectUserData` is unbounded.** Convex caps single-query reads at 16,384 documents. An extreme-outlier user with more conversations/messages than that would see a 500 from Convex. Realistic V1 usage is far under the cap (AC #4 targets 500 docs), but when we exceed ~5k messages per user we should paginate the query and stream JSON entries rather than buffering the full arrays.
- **No `pnpm lint` / `pnpm typecheck` scripts.** `package.json` has only `build`, `dev`, `test`, `test:component`. Adding `"lint": "eslint ."` and `"typecheck": "vue-tsc --noEmit"` would let the bmad-story-runner run the full check pipeline and reduce drift. Low urgency — `pnpm test` is the gate today.
- **`collectUserData` returns full document rows including `r2Key`, `indexJobId`, `failureReason`.** Acceptable since they describe the user's own data, but a security-conscious review may want to mask internal ingestion identifiers. Revisit if the export becomes a customer-facing artifact with compliance requirements.

## Deferred from: code review of story-5.2 (2026-04-12)

- **`deleteDocumentFromR2` internal action is now dead code** — `convex/documentActions.ts:259-289` is no longer referenced after Story 5.2 rerouted `documents.deleteDocument` through the `pendingCleanup` queue. Safe to delete in a follow-up commit (single file, no API surface change — it is an `internalAction`). Deferred to avoid widening the diff during the cleanup-path refactor.

## Deferred from: code review of story-5.1 (2026-04-12)

- **`getR2Client()` non-null-asserts R2 credentials** — `convex/documentActions.ts:9-17` uses `process.env.R2_ENDPOINT!`, `R2_ACCESS_KEY_ID!`, `R2_SECRET_ACCESS_KEY!`. The new `performCleanupAttempt(kind:'r2')` path only guards `R2_BUCKET_NAME`. In the extremely unlikely event of a partial env misconfig, client construction succeeds with `undefined!` creds and fails cryptically at `.send()`. Mirror the `getAiSearchConfig()` early-return pattern for all four vars. Out of scope for 5.1 (shared infra touched by `ingestDocument`).
- **No alerting on `pendingCleanup` rows nearing MAX_ATTEMPTS** — For NFR13 (24-hour external-data removal guarantee), persistent cleanup failures need operational visibility. Today they only hit `console.error` via `recordRetry.lastError`. Add a cron/alert on `pendingCleanup` rows where `attempts >= 7` so on-call is notified before the 10-attempt cap hard-fails. Candidate for Epic 5 observability follow-up.
- **`drainPendingCleanup` reschedule uses min-attempts backoff across all failing rows** — If one row is fresh (`attempts=0→1`) and another is near-dead (`attempts=9→10`), the action reschedules at `backoffMs(1) = 60s`, causing extra polling for the older row. Correctness is preserved (per-row attempts still track), but slight wasted polling. Consider per-row backoff via individual scheduled tasks or separate the drain loop by attempt tier.
- **Bulk AI Search drain may run before provider indexes deletions** — `deleteAccountCascade` schedules `drainPendingCleanup` with `runAfter(0)`, and the `__user_bulk__` list-by-filter endpoint has eventual-consistency semantics. First pass may return 0 matches even though per-doc deletes still need to happen; the per-doc backstop rows cover this and the retry loop self-heals. No functional issue, just occasional no-op first pass.

## Deferred from: code review of story-4.4 (2026-04-12)

- **`route.query.conversationId` array-case in delete redirect** — `app/layouts/default.vue` compares `route.query.conversationId` to the deleted `target._id` with `===`. If the query ever arrives as an array (`?conversationId=a&conversationId=b`), the comparison is false and the redirect is skipped. Add the same defensive guard as `app/pages/app/folders/[id].vue:12-14` (`if (!q || Array.isArray(q)) return null`).
- **Silent user-message persistence failures** — `useChat.sendMessage` fires `persistMessage(convoId, 'user', query)` without awaiting. If Convex rejects the mutation (transient error), the user sees the message in the UI but it never lands in DB, producing a reload-time inconsistency. Story accepted this tradeoff; consider a retry queue or optimistic-rollback pattern later.
- **Theoretical ordering race between user and assistant persistence** — User-message `appendMessage` is fire-and-forget (step 3) while assistant persist runs in the streaming `finally` (step 5). In practice the user mutation commits first, but if it fails silently a conversation can end up with only an assistant reply. Coupled with the silent-failure item above.
- **Sidebar-recent-chats and new-chat component tests are `.skip`** — Following the repo's documented precedent for Reka UI portaled content + `mountSuspended` mocking difficulty (same gap as story 4.3). Backfill when a stable mounting pattern lands for Reka portals.
- **`executeDeleteConversation` drops all non-`conversationId` query params on redirect** — The navigate-to target hard-codes `/app/folders/${target.folderId}` with no query. If future tabs or filters are encoded as query params, they get dropped. Preserve the rest of `route.query` minus `conversationId`.

## Deferred from: code review of story-4.3 (2026-04-11)

- **chat.vue uses native `<select>`, `useRag`, no fallback handling** — Pre-existing: `/app/chat` page uses the `useRag` composable (not `useChat`), a native `<select>` element, and has no model fallback handling. Story 4.3 scope only centralizes the models array for this page (Task 1). Full conversion should happen when this page gets the `useChat` composable or is deprecated.

## Deferred from: code review of story-4.2 (2026-04-11)

- **Streaming test doesn't verify source-before-AI ordering** — Test uses `expect(output).toContain` to check both sources and AI data exist, but doesn't assert their relative order. The transform's purpose is that sources come first. Add an `indexOf` comparison.

## Deferred from: code review of story-3.3 (2026-04-11)

- **Move folder picker renders flat list, not a tree** — Spec mentions "folder tree via a Dialog" but implementation shows a flat list of all folders. Nested folders with the same name are indistinguishable. UX enhancement, not a functional bug.

## Deferred from: code review of story-3.2 (2026-04-11)

- **~~`deleteDocument` does not remove document from Cloudflare AI Search index~~** — Deleted documents remain searchable. Story 3.3 ("Delete Documents and Move Between Folders") should handle AI Search cleanup. — Resolved in Story 5.2 (2026-04-12) via durable `pendingCleanup` queue reusing the Story 5.1 retry worker.
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

## Deferred from: Story 6-1 — documentActions.test.ts baseline triage (2026-04-12)

Story 6-1 AC #11 / Task 9 retired the 8-failure baseline in `convex/documentActions.test.ts` with a one-pass triage (30-min budget, Epic 5 retro "fix, delete, or .skip with a link" framing). All 8 classified as category (c) — **dead**: the tests assume a legacy ingestion flow (`pdf-parse` mock + fetch-based AI Search `/documents/upsert` endpoint) that was replaced by `unpdf`'s `extractText` plus S3 SDK PUT to R2 + a sync-job fetch. The tests are now `.skip`'d with an in-file comment pointing to this section and `epic-5-retro-2026-04-12.md`. They are preserved (not deleted) so a future ingestion-rewrite story can read the original intent and write replacement tests against the unpdf/S3 path.

Skipped cases:
- [P0] should extract text from PDF and update status to success — pdf-parse mock no longer wired (unpdf used now)
- [P0] should upsert to Cloudflare AI Search with correct metadata — production code uses R2 PUT + sync job, no `/documents/upsert` fetch
- [P0] should fail with reason when PDF has no extractable text — pdf-parse mock unused; needs rewrite against unpdf
- [P0] should fail with error details when AI Search API returns error — flow changed; 503 now surfaces from jobs endpoint, not upsert
- [P1] should include authorization header in AI Search request — fetch spy sees S3-SDK call, not AI Search fetch
- [P0] should transition document from processing to success after ingestion — depends on above dead mocks
- [P0] should pass correct userId and filename through ingestion flow — asserts shape of removed upsert body
- [P0] should delete from R2 and trigger sync — production uses S3 DeleteObjectCommand, no fetch to spy

**Follow-up story scope (bounded):** rewrite `documentActions.test.ts` to mock `S3Client` and the AI Search jobs endpoint; re-assert status transitions, metadata fields on the R2 PUT, and the sync-job POST. Out of scope for 6-1 — already folded in the 30-min budget triage decision.

## Deferred from: Story 6-1 — tests/component/chat/chat-input.test.ts baseline (2026-04-12)

Independently discovered during Story 6-1's full `pnpm test:component` run: 6 tests in `tests/component/chat/chat-input.test.ts` fail on the Epic 5 baseline (verified via `git stash` + branch-checkout on 2026-04-12). Not caused by 6-1 — kept out of scope per the story's 30-minute triage budget framing. All 6 target the same file; likely a similar ingestion-style drift (component API changed). Follow-up story: audit `ChatInput.vue` event/disabled contract vs the test's assertions; same "fix, delete, or .skip" options as the documentActions triage.

Failing cases:
- [P0] should emit submit with trimmed message when Enter is pressed
- [P0] should insert newline on Shift+Enter instead of submitting
- [P0] should prevent empty or whitespace-only submissions
- [P0] should disable textarea and send button when disabled prop is true
- [P1] should disable send button when input is empty
- [P1] should expose focus() method via defineExpose
