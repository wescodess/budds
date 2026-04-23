# Deferred Work

## Deferred from: code review of 1-7-course-creator-ui-full-flow (2026-04-23)

- **SourceSelector only supports single-folder selection as sourceType 'folder'.** Multi-folder (cross-folder) selection requires document-level granularity to satisfy the `courses.create` cross-folder validator which needs `documentIds`. The UI selects folders, not individual documents. Add document-level selection in a future story when cross-folder courses are needed.

## Resolved from 1-6 / 1-5 deferrals in 1-7:

- **Error handling toasts added** to StartLearningButton, PaceSelector, OutlineEditor, and CourseCreator (all mutation calls now have try/catch + vue-sonner toast).
- **PaceSelector now uses optimistic update** with rollback on error.

## Deferred from: code review of 1-6-pace-selector-and-course-start (2026-04-22)

- **No error handling on mutation failures in StartLearningButton and PaceSelector.** `app/components/learn/StartLearningButton.vue` and `PaceSelector.vue` mutation calls have no try/catch with user-facing toast. If `startCourse` or `updatePace` throws, the error is swallowed or surfaces as an unhandled rejection. Add toast notifications in the full-flow integration (Story 1.7).
- **PaceSelector does not optimistically update.** After changing pace, the `<select>` briefly reverts to the old value until the Convex real-time subscription delivers the updated course record. Acceptable for MVP; address with optimistic local state in Story 1.7 full flow.

## Deferred from: code review of 1-5-outline-editor-ui (2026-04-22)

- **No error handling on mutation failures in OutlineEditor component.** `app/components/learn/OutlineEditor.vue` mutation calls (updateTitle, cycleKnowledgeType, removeSection, addSection) have no try/catch. Network errors or ownership guard failures surface as unhandled promise rejections with no user feedback. Add toast notifications on error in the full-flow integration (Story 1.7).
- **`courses.updateOutline` lacks status guard.** `convex/courses.ts` updateOutline mutation does not check `course.status === 'ready'`. Could theoretically be called on a generating/failed course. Low risk since UI only shows editor for ready courses.
- **No aria-label on interactive icon buttons.** OutlineEditor remove button (X) and drag handle have no `aria-label`. Screen readers announce them as unlabeled buttons. Address in accessibility pass.

## Deferred from: code review of 1-4-outline-generation-pipeline (2026-04-22)

- **`courses.get` 404 vs 403 distinction leaks course existence.** Endpoint returns 404 for both "course doesn't exist" and "course exists but not owned by you". Pre-existing pattern across all server endpoints (quiz, flashcard generators). A security-conscious review may want distinct error codes, but changing would break consistency with the rest of the codebase.
- **`outlineResponseSchema` was dead code.** Defined and exported but never used by `parseOutlineResponse`. Removed during review. Noting in case downstream stories expected to import it.

## Deferred from: code review of 1-3-course-creation-api-web-only (2026-04-22)

- **`webSearchEnabled` arg silently overridden for web-only.** The mutation accepts `webSearchEnabled` as optional, but for `sourceType: 'web-only'` it's hardcoded to `true`. If a caller passes `webSearchEnabled: false` with web-only, the value is silently ignored. Correct per AC but could be made explicit via validator or documentation.
- **Pre-existing `.collect()` on folder documents query still unbounded.** The folder branch (line 52) uses `.collect()` when no documentIds are specified. Already deferred from story 1-2 review. No change introduced in 1-3.

## Deferred from: code review of 1-2-course-creation-api-folder-cross-folder (2026-04-22)

- **`create` mutation transaction size with large folders.** When sourceType='folder' and no documentIds specified, the mutation reads all docs in the folder and creates one courseSourceDoc per doc. For folders with 200+ documents this could approach Convex transaction limits. Consider batched creation or a limit on source doc count for MVP.
- **Duplicate `requireAuth` helper.** courses.ts and courseSourceDocs.ts each define their own requireAuth. Same pattern exists in quizzes.ts, flashcards.ts, tasks.ts. Should extract to a shared `convex/lib/auth.ts` utility when the duplication exceeds 5 files.
- **`listByUser` returns full course documents including outlineSections array.** For list views, a lean projection (omitting outlineSections, sourceConfidence details) would reduce bandwidth. Not critical until outline generation populates large arrays.

## Deferred from: code review of 1-1-convex-schema-course-tables (2026-04-22)

- **`courseSourceDocs` table lacks a `by_userId` index.** Deletion and export iterate via `courses.by_userId` then `courseSourceDocs.by_courseId` per course. Functional but O(courses) queries. Adding `by_userId` index with a `userId` field would allow direct query like other tables. Matches current architecture spec (only `by_courseId` specified). Add the index when the table sees high-volume queries.

## Deferred from: spec-g3 amendment (2026-04-14) — CreateVoidDialog wiring

- **T15 (page-level integration test) deferred.** Testing that `rail-new-void` click opens `CreateVoidDialog` in `app/pages/app/folders/[id].vue` requires a mounted page test with Convex mocks for `useConvexQuery(api.conversations.listRecentForUser)`, `api.flashcards.listByFolder`, `api.quizzes.listByFolder`, `api.documents.countsByFolder`, plus `useFolders` and router setup. No harness exists yet. Covered today by: (a) `CreateVoidDialog` unit tests (5), (b) `FolderShell` → `FolderShellRail` `new-void` event propagation is structural/grep-verifiable, (c) manual smoke. Land the integration test alongside a general Convex-mock harness for page tests.
- **Flashcards/Quiz dialog dispatch is a tab-switch only.** No `flashcardSets` or `quizzes` row is created at dialog submit — voids of those types are produced by their respective generator UX (existing). If UX ever wants "empty void rows" for these types (e.g. so they appear in the rail counter immediately), add `createEmptySet` / `createEmptyQuiz` mutations and call from `onCreateVoid`.

## Deferred from: g2-atlas-style-home-sidebar implementation (2026-04-13)

- **Mobile sheet does not expand labels next to badges.** Spec AC said the mobile sheet should render folder names alongside badges. Current implementation reuses `HomeRail` unchanged inside the sheet — icon-only with sr-only labels + tooltips. Functionally accessible, visually identical to desktop. Add an `expanded?: boolean` prop to `HomeRail` and pass `true` from inside the mobile branch when G3/G4 land. No regression vs prior sidebar (which also didn't bother).
- **Pre-existing 7 component test failures on `ui-revamp` branch** (`folder-view.test.ts`, `folder-documents.test.ts`, `folder-breadcrumb.test.ts`) — unrelated to G2; setup error in `app/pages/app/folders/[id].vue`. Likely fallout from a prior in-flight refactor on this branch. Investigate in a follow-up.
- **Pre-existing `convex/users.test.ts > nuxt config redirects guest to /app` failure** on this branch — unrelated.

## Deferred from: round-2 review of spec-folder-metadata-and-create-modal (2026-04-13)

- **`getFolderDescendantCounts` (`convex/folders.ts`) returns `documentCount: 0` across all descendants.** Pre-existing bug — never sums stored counts. Any caller that surfaces "X documents will be deleted" gets a falsely reassuring zero. Fix: `descendants.reduce((s,d)=>s+d.documentCount,0) + folder.documentCount`.
- **`CourseCard.vue` quick-action buttons ("Chat" / "Flash Cards") are announced to screen readers but have no handlers.** Pre-existing regression (unrelated to G1 badge change). Either wire them or remove the `sr-only` labels.
- **`IconSelect.vue` `resolveIcon` is uncached.** Every keystroke re-resolves PascalCase lookups for every tile. Safe today; memoize via module-level `Map<string, Component>` once catalog grows.
- **IconSelect tint uses string concatenation `${colorHex}26`.** Assumes `#RRGGBB`. Brittle if the palette ever emits shorthand or `rgb()`. Switch to an `rgba()` computation.
- **`app/pages/index.vue` has dead defensive code:** `(folder as any).documentCount ?? 0` and `allFolders as any` in `FolderPickerDialog` binding. Schema guarantees shape; remove casts to restore type safety.

## Deferred from: review of spec-folder-metadata-and-create-modal (2026-04-13)

- **`backfillFolderDefaults` capped at 2000 rows per run.** Uses `.take(2000)`; correct and idempotent, but a user with >2000 folders would need multiple invocations. Document the run-until-zero operator contract or switch to cursor pagination when usage approaches the cap.
- **`updateFolder` has no optimistic-concurrency guard.** Two tabs editing the same folder race last-writer-wins. Realistic exposure on a single-user app is low; revisit with an `updatedAt` compare-and-swap if cross-device sync becomes a visible problem.
- **`useFolders` exports dual create signatures + an SSR stub.** `createFolder(name, opts?)` kept for callers, new widened overload for the modal. SSR stub returns empty reactives. Consolidate once all callers move to the object-arg form and SSR data-fetching lands.
- **Lucide dynamic PascalCase lookup silently falls back to `Folder`.** `IconSelect`/`FolderBadge` resolve icons via `toPascalCase(key)` against the lucide namespace — a typo in the catalog or a lucide rename yields the fallback with no console warning. Add a dev-only assertion or a compile-time catalog check.
- **IconSelect search matches only the icon key, not synonyms.** Searching "test" won't find `flask-conical`. Add a keyword index to `FOLDER_ICON_GROUPS` entries when the catalog grows past ~60 icons.
- **No unsaved-changes guard on `FolderFormModal`.** Closing the modal (Esc / overlay click) drops edits silently. Acceptable for a 2-field form; add a confirm-on-dirty guard if description length grows or more fields are added.
- **Description whitespace-trim policy not specified.** Server accepts leading/trailing spaces today. Decide whether to trim on write; currently handled as-is.
- **No runtime assertion that `FOLDER_COLOR_KEYS` / `FOLDER_ICON_KEYS` are duplicate-free.** A copy-paste in the catalog would validate successfully at mutation time but break the UI. Add a unit test asserting the set-size equals the array length.

## Deferred from: UI-revamp folder UX multi-goal split (2026-04-13)

Parent intent: folder UX overhaul (schema + sidebar + layout + drawer). Started with **G1 — Folder metadata + create modal** as `spec-folder-metadata-and-create-modal.md`. Remaining goals deferred to sequential follow-up specs after G1 ships:

- **G2 — Atlas-style home sidebar.** Replace current dashboard sidebar with compact Atlas-style rail: logo, root folders only (folders without parents), create-folder CTA. Reference: `docs/screenshots/Screenshot 2026-04-12 at 8.35.10 PM.png`. Consumes G1's `color` + `icon` fields to render folder entries.
- **G3 — Folder page 3-pane layout.** Left folder sidebar + resizable middle (primary: chat/flashcards/quiz) + resizable right helper pane (citations/transcripts/future). Position-flip toggle swaps middle↔right. Helper hidden by default; citations (and future equivalents in flashcards/quiz tabs) prompt it open. Resize + flip state persisted **per-folder**. Mobile collapses to stacked. Reference: `docs/screenshots/Screenshot 2026-04-12 at 11.52.19 PM.png`.
- **G4 — Left-sidebar drawer (Members / Knowledge).** Drawer floats-over middle+right (not push), triggered from left sidebar. Knowledge view **replaces the current `Documents` tab**: shows folder+subfolder tree (subfolders labeled "folders" in UI), with files-of-selected-folder listed below. Clicking a tree node selects+expands it and lists its files. Members entry is a stub only. Consumes G1 icons/colors in the tree.

## Deferred from: code review of story-7.1 (2026-04-12)

- **AC #6 cosmetic deviation — Generate button hidden during generating instead of showing "Generating…" spinner label.** `app/components/flashcards/Tab.vue` renders the shimmer branch (`v-else-if="generating"`) without a disabled button. AC wording requested "button shows a spinner and the label 'Generating…'; the button is disabled; no layout shift". Functionally equivalent (user cannot double-submit), but literal AC text not satisfied. One-line template addition would restore strict compliance.
- **`sourceDocumentId` resolution allows cross-folder same-user documents.** `convex/flashcards.ts` `createSetWithCards` accepts any documents row the user owns, not only rows inside `args.folderId`. Not a tenant leak (ownership still enforced), but a card provenance can point at a doc outside the containing folder if the LLM fabricates a matching documentId. Tighten by additionally asserting `doc.folderId === args.folderId` at resolution time.
- **Out-of-range `sourceIndex` silently falls back without logging.** `server/api/flashcards/generate.post.ts:61` uses `chunks[c.sourceIndex] ?? chunks[index] ?? chunks[0]!` — if the LLM emits nonsense indexes, the card text references a mismatched chunk with no observability. Add `console.warn` on first out-of-range hit per request for triage.
- **No rate limiting on `POST /api/flashcards/generate`.** Cost-bearing path (AI Search + AI Gateway). Same class as `/api/quiz/generate` and `/api/export/me`. Defer to V1.x global abuse guard.
- **Trailing-comma cleaner regex `,(\s*[}\]])` is over-broad.** `server/utils/flashcard-prompt.ts#tryJsonParse` could in theory strip `,]` inside a quoted string. Realistic LLM risk is near-zero but technically incorrect; replace with a tolerant-parser dependency in a follow-up if reliability ever degrades.

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

## ~~Deferred from: Story 6-1 — tests/component/chat/chat-input.test.ts baseline (2026-04-12)~~ — Resolved in Story 7.1 (2026-04-12)

All 6 failures shared a single root cause: `chatInputPath` pointed at `~/components/chat/ChatInput.vue`, but the production file lives at `~/components/chat/Input.vue` (Nuxt auto-component convention). One-line fix in `tests/component/chat/chat-input.test.ts`. All 6 tests now pass. Task 9 of Story 7.1 under the 30-min prep-P0-#1 triage budget.

## Deferred from: flashcard-room-refactor-phase-1 (2026-04-16)

- **Directory picker extraction not done.** The chat `ChatDirectoryPicker` is tightly coupled to `useReferenceScope`. Folder-level scoping via the existing server endpoint is sufficient for Phase 1. If Phase 2 needs fine-grained picker inside `RoomGenerateDialog`, extract the picker primitive to `app/components/global/` first.
- **`createSetWithCards` kept in legacy `convex/flashcards.ts`.** Existing `accountDeletion.test.ts` + `dataExport.test.ts` seed legacy rows through it. Remove when those tests are rewritten to seed rooms directly (Phase 2 cleanup).
- **Restore-no-op creates duplicate version row.** Clicking Restore on the currently-active version produces another archive + restore cycle. Low-severity UX (wastes one history slot). Fix by short-circuiting when target version equals current cards byte-for-byte.
- **SSR stub `roomId: ''` landmine.** `useFlashcardRooms` server-branch stub returns empty-string IDs; if SSR ever eagerly calls `createRoom`, router navigates to `?voidId=`. Swap to `<ClientOnly>` wrappers or throw on SSR call.
- **RoomShell mock mutation not keyed on api.** `tests/component/flashcards/room-shell.test.ts` injects a single `mockMutate` for rename/delete/etc — a wiring swap would still pass. Mirror the `apiRef`-discriminated pattern already used for `useConvexQuery` in the same file.
- **No component-level test for reorder rollback + toast.** RoomEditor.vue implements the rollback on reject; flashcardRooms.test covers the Convex rejection. Add a component test that fails the mutation and asserts localCards reverted + toast message shown.

## Deferred from: audio-overview-mvp spec (2026-04-17)

- **Customize-Audio-Overview dialog (Phase 2).** Pre-generation preferences for `lengthMinutes` (5/10/20), `complexity` (beginner/expert), `voiceProfile` (host A/B voice picker). Wire to `preferences` column in `audioOverviews` or a new `audioOverviewPresets` row keyed to user. MVP uses fixed defaults: `lengthMinutes: 10`, `complexity: beginner`.
- **Sticky mini-player (Phase 2).** Render single `<audio>` element in `layouts/default.vue` so playback survives route navigation. Requires a Pinia store plus the PRD §3.4 collapsed control bar. MVP: audio stops on navigate.
- **Client-side concat + Download (Phase 2).** Fetch all turn MP3s, decode via Web Audio API, re-encode with dynamic-imported `lamejs`, `<a download>` trigger. Server-side ffmpeg on Cloudflare Pages is not available.
- **Share link (Phase 3).** Public `/audio/[id]` page with signed-URL TTL; add `shareToken` + optional `publishedAt` to `audioOverviews`. Rate-limit the public route.
- **Audio visualizer (Phase 2).** Two pulsing orbs driven by `AnalyserNode` FFT on the `<audio>` element. MVP renders static circular orbs; active-turn gets amber ring + faint glow via reactive classes, not real audio-reactive.
- **Interjection flow (Phase 4).** `audioOverviewInterjections` table, mini-script generator endpoint, mic via browser `SpeechRecognition`, playlist splice-and-resume.
- **Per-user daily quota (Phase 3).** Soft cap — MVP skips; Workers AI TTS free tier covers realistic usage. Revisit if OpenRouter spend becomes visible.
- **Precise `durationMs` via ffprobe** or audio-decode sniff. MVP uses text-length heuristic (`chars/14 × 1000ms`); the real `<audio>` element provides accurate playback, so the only error is in the scrubber-before-load position — invisible to users in practice.
- **Voice variety beyond MeloTTS defaults.** If Workers AI exposes multiple speaker IDs per model, plumb a `speakerId` param through `synthesizeMeloTTS`. If not, consider Aura-1 for host_b as a second voice. MVP uses lang-only + slight pitch nudge.
- **Orphan blob cleanup on cancelled generation.** MVP accepts orphan `_storage` blobs when the user cancels. Add a `pendingCleanup` entry or a cron sweep that deletes unreferenced overview-related storage IDs older than 24h.
- **Token-budget / prompt-length enforcement.** Audio script prompt can grow with folder size; add a per-call token ceiling in `buildAudioScriptPrompt` with graceful trim of lower-score chunks.
- **Integration/component tests for the new components.** Unit tests are in-scope for the script prompt + Convex functions; full Vue component + page-level tests require the integration-test harness already deferred from G3.

## Additional deferrals from audio-overview-mvp round-1 review (2026-04-17)

- **Convex storage URL expiry on long pauses.** `getTurnUrls` returns URLs with ~30-min default TTL. If the user pauses for an hour, the player now surfaces an inline banner ("An audio segment couldn't be loaded. Try reloading the page.") but does not auto-refresh URLs. Phase 2: re-fetch via a refresh mutation or adopt shorter cadence; best fix is a signed-URL proxy endpoint that re-signs on demand.
- **AbortSignal for mid-turn TTS cancellation.** `synthesizeWithRetry` can consume up to ~10–30s of user-perceived cancel-wait time (3 attempts × up to 2s backoff + per-request latency) before the outer loop's `isTaskCancelled` check runs again. Phase 2: plumb a shared `AbortSignal` into `synthesizeMeloTTS`'s `fetch` and abort on cancel detection.
- **Scrubber floating-point boundary edge case.** Dragging the scrubber to exactly 100% can land `targetIndex` one past the end on zero-duration turns (defensive clamp catches it). User-unreachable given the 10ms clamp in `seek()`. Noted for completeness.
- **Mid-word truncation in `splitOversizedTurns` final-buffer path.** When a single sentence exceeds `MAX_TURN_CHARS`, the code slices mid-word without an ellipsis. MVP acceptable — MeloTTS handles partial-word input cleanly. Phase 2: break at word boundary + append "…" for synthesizer tone.
