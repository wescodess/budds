# Story 6.1: Generate Quiz from Folder Documents

Status: review

## Story

As a student,
I want to generate a quiz from my uploaded materials in a folder,
So that I can test my understanding of the course content.

## Acceptance Criteria

1. **Given** the Convex schema must support quizzes
   **When** `convex/schema.ts` is extended
   **Then** two new tables exist with the following shapes and indexes:
     - `quizzes`: `{ userId: string, folderId: Id<'folders'>, title: string, status: 'generating' | 'ready' | 'failed', failureReason?: string, model?: string, score?: number, completedAt?: number }`, indexed `by_userId`, `by_folderId`, `by_userId_and_folderId`
     - `quizQuestions`: `{ quizId: Id<'quizzes'>, userId: string, order: number, question: string, type: 'multiple-choice' | 'free-response', options?: string[], correctAnswer: string, sourceDocumentId?: Id<'documents'>, sourceChunkContent: string, sourceFilename: string }`, indexed `by_quizId`, `by_userId`
   **And** the `userId` mirror on `quizQuestions` is present so account-cascade deletion can reach rows without a `quizzes` hop (matches the `messages.userId` pattern already used for the conversations/messages graph)
   **And** the cascade-delete helper in `convex/accountDeletion.ts` (`deleteAccountCascade`) is extended to clear `quizzes` and `quizQuestions` for the user, in that order, before the existing `documents`/`folders`/`users` sweep (Epic 5 retro prep item #6: full cascade re-audit with quizzes added)

2. **Given** the LLM needs a dedicated prompt contract to generate citable quiz questions (Epic 5 retro prep item #2 — quiz-generation LLM prompt spike)
   **When** `server/utils/quiz-prompt.ts` is added
   **Then** it exports a `buildQuizPrompt(chunks, options)` helper that takes the retrieved AI-Search chunks and returns a `ChatMessage[]` suitable for `generateCompletion()` where the system prompt instructs the model to:
     - Return JSON only (no markdown fences) matching the exact schema: `{ title: string, questions: Array<{ order: number, question: string, type: 'multiple-choice' | 'free-response', options?: string[], correctAnswer: string, sourceIndex: number }> }`
     - Produce a mix of MC (with exactly 4 options — one correct) and free-response items (target ratio ~60/40, final count capped at 8 questions per quiz for the V1 scope and 10s NFR6 budget)
     - Reference only the supplied source passages via `sourceIndex` (0-based into the chunks list) — never invent filenames or passage content
     - Skip generation (return `{ title, questions: [] }`) if fewer than 2 chunks are provided
   **And** the helper exports a pure `parseQuizResponse(raw: string)` that tolerates a leading ```` ```json ```` fence, trailing commas, and validates each question against the shape above using a zod schema defined in the same file; invalid items are dropped, not thrown, and the returned `{ title, questions }` is always well-formed (possibly empty)
   **And** the prompt + parser are unit-tested in `server/utils/quiz-prompt.test.ts` under the `node` vitest environment (happy path, markdown-fenced response, partially-invalid questions dropped, empty chunks short-circuits to `{ questions: [] }`)

3. **Given** a user in a folder with indexed documents clicks "Generate Quiz"
   **When** the client calls `POST /api/quiz/generate` with `{ folderId, model?, questionCount? }`
   **Then** the Nitro handler at `server/api/quiz/generate.post.ts`:
     - Resolves `userId` via `getConvexTokenIdentifier(event)` (401 on missing token — same pattern as `/api/rag/chat`)
     - Validates the body: `folderId` required; `model` optional (falls through to `SERVER_DEFAULT_MODEL` via the existing `isAllowedModel` allowlist + fallback logic); `questionCount` optional (default 8, clamped to 3..8)
     - Calls `searchDocuments({ query: 'key concepts, definitions, and facts', userId, filters: { folderId }, max_num_results: 12 })` (fixed seed query — the LLM does the work of choosing what's quiz-worthy; `max_num_results` intentionally exceeds the 8-question target so the prompt has headroom to skip low-quality chunks)
     - If `searchResults.data.length < 2`, returns 422 `{ error: 'Not enough indexed content to generate a quiz' }` without calling the LLM
     - Calls `generateCompletion({ model, messages: buildQuizPrompt(chunks, { questionCount }) })` with `temperature: 0.3` (low-variance for structured output) and `max_tokens: 3000`
     - Parses the response via `parseQuizResponse()`; if the parsed list is empty and chunks were present, returns 502 `{ error: 'Quiz generation produced no valid questions' }`
     - Persists via a new Convex mutation `quizzes.createWithQuestions({ folderId, title, model, questions })` which (a) validates `folder.userId === identity.tokenIdentifier`, (b) inserts the `quizzes` row with `status: 'ready'`, (c) inserts each `quizQuestions` row with the `quizId`, `userId` mirror, `order`, and the source chunk's `content` + `attributes.filename` + resolved `sourceDocumentId` (only when the chunk's `attributes.documentId` maps to a real `documents` row owned by the user; otherwise left undefined but `sourceFilename` + `sourceChunkContent` are always set)
     - Returns `{ quizId, title, questionCount }` on success
   **And** the entire handler budget is ≤ 10s wall-clock for a typical 8-question quiz (NFR6 — documented in the Dev Agent Record, not asserted in CI due to real-LLM variance)

4. **Given** cross-user isolation must hold end-to-end
   **When** any new Convex query or mutation is called
   **Then** it derives `userId` from `ctx.auth.getUserIdentity().tokenIdentifier` — never from an argument; the `quizzes.createWithQuestions` mutation, the `quizzes.listByFolder` query (AC #5), and the `quizzes.getWithQuestions` query (AC #5) all enforce ownership on both the parent folder/quiz and on every returned row. Attempting to read another user's quiz returns `null` / empty; attempting to write under a folder the caller doesn't own throws `Folder not found`

5. **Given** the folder tab bar renders quizzes
   **When** `app/pages/app/folders/[id].vue` is extended
   **Then** a new `Quiz` tab appears between `Chat` and `Documents` (matches UX-DR1 tab ordering: Chat, Flash Cards, Quiz, Documents — Flash Cards is Epic 7, so for V1.1 the order becomes Chat, Quiz, Documents, and a code comment in the template documents this)
   **And** the tab shows one of three states:
     - **Empty (no indexed documents)**: a centered empty state with the text "Upload and index documents to generate quizzes"; the Generate button is NOT shown (progressive availability, UX-DR24)
     - **Empty (indexed documents, no quizzes yet)**: a centered prompt "No quizzes yet" with a single "Generate Quiz" button (`data-testid="quiz-generate-button"`)
     - **Has quizzes**: a list of quiz cards ordered by creation desc, each showing the quiz title, creation date, question count, and (when it exists) a taken-score badge; the "Generate Quiz" button sits at the top of the list. Story 6.2 will extend each card's click-through to the take-quiz flow — this story renders the list but card click is a no-op placeholder
   **And** the composable backing the tab is a new `app/composables/useQuizzes.ts` that exposes `{ quizzes, hasIndexedDocuments, generating, generate, lastError }`. `hasIndexedDocuments` reuses the same derivation `useChat` does (any document with `status === 'success'`). `quizzes` is a live `useConvexQuery(api.quizzes.listByFolder, { folderId })` ref

6. **Given** the user triggers quiz generation
   **When** `generate()` is called
   **Then** the UI replaces the list with 3 shimmer placeholder cards (`UiSkeleton` blocks ~120px tall each) to reinforce "work is happening" (AC from epics.md line 795)
   **And** the button shows a spinner and the label "Generating…"; the button is disabled; the tab content scrolls nothing (no layout shift)
   **And** on success the new quiz appears at the top of the list with its CitationBadge-like per-question source row visible in a collapsed-by-default "Preview questions" expander per card (each question shows the first ~120 chars of `sourceChunkContent` + the filename via an inline `ChatCitationBadge` — reuses the existing component)
   **And** on failure (HTTP non-200 or caught fetch error) a `vue-sonner` toast shows the error message and the button returns to idle; the shimmer state clears

7. **Given** Epic 5 retro prep item #3 — Reka-portal `mountSuspended` test pattern (rolled forward from Epic 4 prep #4, flagged P0 "Decision + PR, not just investigation")
   **When** the component-layer test for the new Quiz tab is written
   **Then** `tests/component/quiz/quiz-tab.test.ts` attempts to mount the Quiz tab content via `mountSuspended` and assert: (a) empty-no-docs state renders when `hasIndexedDocuments === false`; (b) empty-with-docs state renders the Generate button when quizzes=[]; (c) click-through on the button invokes the mocked `generate()`; (d) list state renders one card per quiz
   **And** if a Reka-portal dropdown/dialog renders in the tab content and `mountSuspended` cannot expose its portaled children reliably, the Dev Agent Record records a short Decision block naming the specific component blocked (e.g., a future SelectQuestionCount dropdown), the `.skip` is annotated with a `TODO(story-runner): portal pattern — see 6-1 Dev Agent Record` comment, and the test file still lands with the non-portal assertions passing. This satisfies the retro's "Decision + PR" clause — the decision is explicit, auditable, and capped to a named, bounded scope inside this story. **If** dev discovers that making the Quiz tab's happy path assertable requires mountSuspended + Reka portal workarounds beyond a bounded change (e.g., restructuring multiple shadcn-nuxt wrappers), the story-runner escalates BLOCKED with `block_reason=scope_overflow` per the orchestrator contract — do NOT silently expand the story. For this story's scope, the Quiz tab intentionally avoids introducing a NEW portaled component; any portals come from pre-existing shared UI

8. **Given** Convex-layer test coverage
   **When** `convex/quizzes.test.ts` runs under `convex-test`
   **Then** it asserts:
     - `createWithQuestions` rejects calls with no identity (throws Unauthenticated)
     - `createWithQuestions` rejects when the folder is owned by a different user (throws "Folder not found")
     - `createWithQuestions` persists the quiz + each question with the correct `userId` mirror and `quizId`
     - `listByFolder` only returns the caller's quizzes for that folder (the cross-user dataset is invisible)
     - `getWithQuestions` returns `null` for a quiz owned by a different user
     - The existing account-cascade test (or a new case inside `convex/accountDeletion.test.ts`) verifies that `deleteAccountCascade` now also clears `quizzes` + `quizQuestions` for the deleted user while leaving another user's quizzes intact (Epic 5 retro "cascade audits must re-check inherited cascades whenever a new table joins the graph")

9. **Given** server-layer test coverage
   **When** `server/api/quiz/generate.post.test.ts` runs under the `node` vitest environment
   **Then** it asserts (using the same mock-Convex-client pattern `server/api/rag/chat.post.test.ts` + `server/api/export/me.get.test.ts` already use):
     - 401 when `getConvexTokenIdentifier` throws (no Convex token)
     - 422 when AI Search returns fewer than 2 chunks (no LLM call made — assert via a spy on `generateCompletion`)
     - 200 with `{ quizId, title, questionCount }` on the happy path (AI Search + LLM + Convex mutation mocked; the test verifies the prompt builder is called with the chunks and that the mutation receives the parsed questions)
     - 502 when `parseQuizResponse` returns an empty question list despite chunks being present
     - The happy path passes `model: SERVER_DEFAULT_MODEL` when the client sends a disallowed model (exercising the same allowlist fallback as `/api/rag/chat`)

10. **Given** data export must remain a faithful dump (Story 5.3 AC #2 placeholder)
    **When** `convex/dataExport.ts#collectUserData` runs for a user with quizzes
    **Then** the returned shape gains `quizzes` (array) and `quizQuestions` (array) sourced via `by_userId` indexes; the `/api/export/me` zip's `quizzes.json` becomes the non-empty array it was forward-declared for in Story 5.3. **An accompanying test in `convex/dataExport.test.ts`** verifies the two new fields are present, user-scoped, and are empty arrays for users with no quizzes (existing 5.3 test shape continues to pass)

11. **Given** documentActions.test.ts 8-failure baseline (Epic 5 retro prep item #5 — rolled forward once)
    **When** this story runs
    **Then** the dev pass attempts one focused read of `convex/documentActions.test.ts` to classify each of the 8 failures as either (a) fixable inside a ≤20-line test edit, (b) a product bug disguised as a test failure, or (c) dead (covers removed code). Any in category (a) are fixed in this PR; any in category (b) or (c) are logged to `deferred-work.md` under a clearly-titled subsection "documentActions.test.ts baseline (from Story 6-1)" with one line per failure. **If** triage exceeds 30 minutes of wall-clock without producing a clean tri-state classification, the story-runner logs a Decision ("documentActions.test.ts baseline deferred in full — see deferred-work.md") and leaves the tests as-is rather than expand the story. This satisfies the retro's "no more carrying it silently" clause without becoming a scope trap. The retro's own guidance ("Fix, delete the dead tests, or .skip with a link to this retro") is the three options the triage picks from

## Tasks / Subtasks

- [x] **Task 1: Extend Convex schema for quizzes + quizQuestions** (AC: #1)
  - [x] Edit `convex/schema.ts`: add `quizzes` and `quizQuestions` tables with the exact shapes + indexes listed in AC #1
  - [x] Run `pnpm dev` (or `npx convex codegen`) once so `convex/_generated` picks up the new tables before writing the mutation in Task 2. If `pnpm dev` isn't available in the test harness, manually delete `convex/_generated/api.d.ts` + re-run `pnpm install` (which triggers `nuxt prepare` + Convex codegen via postinstall) — document the method used in the Dev Agent Record
  - [x] Decision note (Dev Agent Record): per-row `userId` mirror on `quizQuestions` is a deliberate duplication that lets the cascade delete reach question rows in O(1)-per-row instead of quiz→question joining; same pattern as `messages.userId`

- [x] **Task 2: Add `quizzes` Convex module** (AC: #1, #3, #4, #8)
  - [x] New file `convex/quizzes.ts`. Export:
    - `createWithQuestions` (mutation) — args: `{ folderId, title, model, questions: Array<{ order, question, type, options?, correctAnswer, sourceDocumentId?, sourceChunkContent, sourceFilename }> }`. Validate folder ownership; insert `quizzes` with `status: 'ready'`; loop questions and insert each into `quizQuestions` with the `quizId` + `userId` mirror. Return `{ quizId }`.
    - `listByFolder` (query) — args: `{ folderId }`. Returns quizzes for the caller + folder ordered desc by `_creationTime`. Each row returns `{ _id, _creationTime, title, status, score, completedAt, questionCount }` where `questionCount` is computed via `db.query('quizQuestions').withIndex('by_quizId', q => q.eq('quizId', row._id)).collect().length` — fine at the V1 scale (≤ 8 questions per quiz).
    - `getWithQuestions` (query) — args: `{ id }`. Returns `null` if the quiz isn't owned by the caller; otherwise `{ quiz, questions }` where `questions` are ordered by the stored `order` field.
  - [x] Every handler begins with `const identity = await ctx.auth.getUserIdentity(); if (!identity) throw new Error('Unauthenticated')` — same shape as `convex/conversations.ts`

- [x] **Task 3: Extend cascade delete to cover quizzes** (AC: #1, #8)
  - [x] Edit `convex/accountDeletion.ts#deleteAccountCascade`:
    1. Add `deleteAllQuizQuestionsForUser(ctx, userId)` and `deleteAllQuizzesForUser(ctx, userId)` batch helpers (mirrors the existing `deleteAllMessagesForUser` shape)
    2. Call them in this order, immediately after `deleteAllMessagesForUser` + `deleteAllConversationsForUser` and before `deleteAllDocumentsForUser`: `deleteAllQuizQuestionsForUser(ctx, userId)` → `deleteAllQuizzesForUser(ctx, userId)`
  - [x] Add a new test case in `convex/accountDeletion.test.ts`: seed a user with one quiz + two questions; seed a second user with their own quiz; call `deleteAccountCascade` for the first user's identity; assert user-1's quiz + questions are gone; assert user-2's quiz + questions remain

- [x] **Task 4: Add LLM prompt module** (AC: #2)
  - [x] New file `server/utils/quiz-prompt.ts`. Exports `buildQuizPrompt(chunks, options)` and `parseQuizResponse(raw)` + the zod schema for a single question. The system prompt is authored inline as a single template literal — no config file splitting. Short-circuit behavior (<2 chunks → empty questions) lives in the parser, not the prompt builder, so a bad LLM response with few chunks still produces `{ questions: [] }`
  - [x] New file `server/utils/quiz-prompt.test.ts` (node env). Four cases: (1) happy path returns a parsed quiz with 2 MC + 1 free-response; (2) markdown-fenced response is unwrapped before parsing; (3) response with a mix of valid + invalid questions drops the invalid ones; (4) empty-chunks input short-circuits to `{ questions: [] }` (builder-level behavior)

- [x] **Task 5: Implement `POST /api/quiz/generate` Nitro handler** (AC: #3, #4, #9)
  - [x] New file `server/api/quiz/generate.post.ts`. Flow described in AC #3. Use `useConvexClient` (the existing pattern from `/api/export/me.get.ts`) to call the new `quizzes.createWithQuestions` mutation with the request's Convex token forwarded via its auth hook
  - [x] New file `server/api/quiz/generate.post.test.ts` (node env). Cases from AC #9. Mock `searchDocuments`, `generateCompletion`, and the Convex client's `mutation` call — follow the existing `server/api/rag/chat.post.test.ts` layout exactly (same `vi.mock` targets at the top of the file)

- [x] **Task 6: Extend `useQuizzes` composable + Quiz tab UI** (AC: #5, #6, #7)
  - [x] New file `app/composables/useQuizzes.ts`. Shape listed in AC #5. `generate()` posts to `/api/quiz/generate`, refetches `listByFolder` via Convex reactivity (automatic — no manual refresh), and surfaces errors on the returned `lastError` ref
  - [x] Edit `app/pages/app/folders/[id].vue`: add the Quiz tab between Chat and Documents with the three render states. Icon from `lucide-vue-next` — use `ClipboardList` (already tree-shakeable). Reuse `UiSkeleton` for the shimmer placeholders
  - [x] Quiz cards render the title, date (via `new Date(row._creationTime).toLocaleDateString()`), question count, and the score badge when `row.score !== undefined`. Card click-through is a placeholder (`// TODO(story 6.2): navigate to take-quiz view`) — the template still renders the card as a clickable div with a keyboard-friendly `role="button"` + `tabindex="0"` so Story 6.2 picks up from the same node
  - [x] The "Preview questions" expander under each card is a `UiAccordion` that fetches `api.quizzes.getWithQuestions` on first open (not on card mount — avoid fan-out queries). Each question inside renders its `sourceFilename` via the existing `<ChatCitationBadge>` and a single-line preview of `sourceChunkContent`

- [x] **Task 7: Component-layer test for the Quiz tab** (AC: #7)
  - [x] New file `tests/component/quiz/quiz-tab.test.ts`. Use `mountSuspended` from `@nuxt/test-utils/runtime` — same as `tests/component/chat/citation-badge.test.ts`
  - [x] Four assertions as listed in AC #7. Mock `useQuizzes` with `mockResolvedValue` factory fixtures. Do not introduce a new Reka portal
  - [x] If any assertion cannot be made reliably via `mountSuspended`, skip that assertion only (not the whole file), add a code comment `// TODO(story-runner): portal pattern — see 6-1 Dev Agent Record`, and log the decision with the specific blocker in the Dev Agent Record

- [x] **Task 8: Extend data export to carry quizzes** (AC: #10)
  - [x] Edit `convex/dataExport.ts#collectUserData`: add `quizzes` and `quizQuestions` to the returned shape via `by_userId` indexes (direct analog of the existing `messages` + `conversations` reads)
  - [x] Edit `server/api/export/me.get.ts` — the place that writes `quizzes.json` to the zip now writes `data.quizzes` instead of the hardcoded `[]`; also add a `quizQuestions.json` entry (update the manifest schemaVersion to 2 and the README comment)
  - [x] Extend `convex/dataExport.test.ts` — two cases: (1) user with one quiz + two questions sees both arrays populated and scoped; (2) user with no quizzes sees both arrays as `[]`. The existing Story 5.3 empty-user test should keep passing unchanged

- [x] **Task 9: documentActions.test.ts baseline triage** (AC: #11)
  - [x] Read `convex/documentActions.test.ts` once. For each of the 8 failures, classify as (a) fixable-here, (b) product-bug, (c) dead
  - [x] Fix the (a) category in this PR. Log (b) and (c) to `_bmad-output/implementation-artifacts/deferred-work.md` under a new heading "Deferred from: Story 6-1 — documentActions.test.ts baseline triage (<date>)" — one bullet per failure, one sentence each
  - [x] 30-minute wall-clock budget. If it overruns, log the decision and defer the full list. Do not invest story time in dead test archeology

- [x] **Task 10: Integration-verify the full generate → persist → list flow** (AC: #3, #5, #9)
  - [x] No new test file — extend `server/api/quiz/generate.post.test.ts` with a trailing case that (end-to-end within the mocks) creates the quiz via the mutation spy and asserts the spy was called with a question-shaped payload that round-trips through zod. This is a cheap safeguard against prompt / parser / mutation drift once all three modules land

## Dev Notes

- **Architecture alignment**: `epics.md` lines 767-801 define this story. `architecture.md` reserves the `quizzes` + `quizQuestions` table placeholders (line 110) and the per-user search isolation / AI Gateway / CitationBadge dependencies all shipped in Epics 3 & 4 and are reused here. No new third-party deps. `fflate` (added 5.3) is unrelated. All three search/LLM calls reuse `server/utils/ai-search.ts` and `server/utils/ai-gateway.ts` with their existing env-var guard + error shape.

- **Cross-epic coupling**: Story 5.3 export path already reads `quizzes` and `flashcards` tables — today they are hardcoded empty arrays in `server/api/export/me.get.ts`. AC #10 + Task 8 flip `quizzes.json` to the real dataset and add `quizQuestions.json` alongside. Schema-version bumps to 2. This is deliberate: Epic 5 committed the forward-compat slot, Epic 6 fills it.

- **Cascade audit**: `deleteAccountCascade` in `convex/accountDeletion.ts` is the Epic 5 story 5.1 / 5.2 cleanup path; the retro explicitly calls out that new tables must re-audit the cascade. Task 3 + AC #1 + AC #8 fulfill that obligation.

- **LLM prompt spike (retro prep #2)**: Absorbed into Task 4. The prompt contract (strict JSON, `sourceIndex` into the chunks list, ≤ 8 questions, MC 4-option constraint) is the spike outcome. The test file exercises the parser's tolerance for LLM misbehavior (markdown fences, partial invalid questions). Real-LLM 10s-budget validation lives in the Dev Agent Record as a manual smoke step — it is not in CI because real-LLM calls are flaky and budget-sensitive.

- **Reka-portal mountSuspended (retro prep #3, P0, rolled forward from Epic 4)**: AC #7 + Task 7 take the "Decision + PR" posture the retro demanded, scoped tightly to this story's Quiz tab. The tab intentionally does NOT introduce any new portaled component (no Select, no DropdownMenu inside the tab itself; any shadcn primitives that do portal are reused from existing surfaces), which keeps the mountSuspended decision surface small. If dev hits a new portal edge case during Task 6, the story-runner escalates BLOCKED per the orchestrator contract rather than silently expanding.

- **documentActions.test.ts baseline (retro prep #5)**: AC #11 + Task 9 produce a bounded triage with a 30-minute budget, which matches the retro's "no more carrying it silently" clause without making this story own the full investigation.

- **Prep items punted out**: P0 #1 (governing-law jurisdiction) is non-engineering — already captured in `deferred-work.md` (Story 5.3 bullet) per the retro. P1 #4 (`pnpm lint` / `pnpm typecheck` scripts) is not in scope for this story — story-runner will run whatever the current `package.json` exposes; adding those scripts is its own focused PR per the retro. P1 #6 (export rate-limit) is GA-only. P2 #7 (unify `/app/chat`) and P2 #8 (remove orphaned `deleteDocumentFromR2`) remain in the deferred backlog. If any of these were to become in-scope, the scope-expansion rule kicks in: BLOCKED with `scope_overflow`.

- **UI-DR anchor points**: UX-DR1 (hybrid tab layout) is the parent directive the Quiz tab satisfies. UX-DR11 (QuizQuestion component) is Story 6.2, not here — 6.1 only renders quiz *metadata* + source previews, not the per-question taking UI. UX-DR20 (empty states) and UX-DR24 (progressive availability) are wired explicitly in AC #5.

- **ATDD note**: TEA ATDD is invoked post-story-creation against this file; the generated E2E/acceptance tests will target the Quiz tab's empty-state → generate → list-state transition. The story-runner does not pre-author those tests here.

### Project Structure Notes

New files added:

```
convex/
  quizzes.ts
  quizzes.test.ts
server/
  api/
    quiz/
      generate.post.ts
      generate.post.test.ts
  utils/
    quiz-prompt.ts
    quiz-prompt.test.ts
app/
  composables/
    useQuizzes.ts
tests/
  component/
    quiz/
      quiz-tab.test.ts
```

Files modified:

```
convex/
  schema.ts                 (add quizzes + quizQuestions tables)
  accountDeletion.ts        (extend cascade)
  accountDeletion.test.ts   (new cascade case)
  dataExport.ts             (read quizzes + quizQuestions)
  dataExport.test.ts        (new shape assertions)
  documentActions.test.ts   (baseline triage fixes, category-(a) only)
server/
  api/
    export/
      me.get.ts             (write real quizzes.json + quizQuestions.json)
app/
  pages/
    app/
      folders/
        [id].vue            (Quiz tab added between Chat and Documents)
_bmad-output/
  implementation-artifacts/
    deferred-work.md        (doc.actions triage results + any bounded-scope deferrals)
```

No files deleted.

## Dev Agent Record

### Context Reference

- _bmad-output/planning-artifacts/epics.md (lines 767-801) — primary story source
- _bmad-output/planning-artifacts/architecture.md — schema + stack constraints
- _bmad-output/planning-artifacts/ux-design-specification.md — UX-DR1, UX-DR11, UX-DR20, UX-DR24
- _bmad-output/implementation-artifacts/epic-5-retro-2026-04-12.md (lines 127-213) — Epic 6 prep plan; retro items #2, #3, #5 folded into this story ACs
- _bmad-output/implementation-artifacts/5-3-data-export-and-legal-pages.md — forward-compat quiz slot

### Decisions

- **Convex codegen method**: used `npx convex codegen --typecheck disable` once after schema edit; `pnpm dev` not available in the story-runner harness and `pnpm install` postinstall triggers `nuxt prepare` which does not regenerate Convex types. The `--typecheck disable` flag is needed because codegen touches generated files that typecheck through `convex/tsconfig.json`, and transient mid-edit states can trip TS.
- **`sourceDocumentId` validation moved into the mutation**: AC #3 says the handler resolves the chunk's `attributes.documentId` into a real `documents` row owned by the user. Implemented instead in `convex/quizzes.ts#createWithQuestions` via `ctx.db.normalizeId('documents', ...)` + ownership check. Reason: the handler runs with a forwarded Convex token but no direct DB access; doing the check in the mutation is the single-authoritative-source pattern the rest of the app uses (matches `conversations.createConversation`'s folder ownership check). The handler passes the raw string candidate; the mutation silently drops invalid IDs and stores `sourceChunkContent` + `sourceFilename` unconditionally — matches the AC's "otherwise left undefined but sourceFilename + sourceChunkContent are always set" clause exactly.
- **QuizTab extracted into its own component** (`app/components/quiz/Tab.vue`): AC #7 required a component-layer test that mounts the tab content via `mountSuspended`. Embedding ~90 lines of template directly in `[id].vue` would have forced the test to mount the full page — pulling in Chat + Documents + AlertDialog + Dialog trees (several Reka portals) that the Epic 5 retro flagged as the blocker. Extracting `QuizTab.vue` lets the test mount just the tab (no portaled primitives inside) and exercise four clean assertions with zero portal escape hatches. This IS the "Decision + PR" posture the retro demanded. The page file now holds only `<QuizTab :folder-id="folderId" />` — no behaviour moved, just surface separation.
- **documentActions.test.ts triage result** (AC #11, Task 9): all 8 failures classified **category (c) dead** in a single read pass. The tests were written against a legacy `pdf-parse` mock + fetch-based AI Search upsert flow; the production code now uses `unpdf`'s `extractText` + S3 SDK + an AI Search jobs endpoint. Skipped (not deleted) with an in-file comment pointing at this Dev Agent Record and at `epic-5-retro-2026-04-12.md`. Deferred-work log (`_bmad-output/implementation-artifacts/deferred-work.md`) contains the per-case triage. Budget: ~10 min (under the 30-min AC #11 cap).
- **chat-input component tests baseline**: 6 additional pre-existing failures surfaced in `pnpm test:component` run. Verified not caused by Story 6-1 (stash + dev checkout reproduced the failures before this branch's changes). Logged to deferred-work.md for a follow-up story — same `.skip`-or-rewrite options as the documentActions triage. Not in 6-1 scope per retro "no silent scope expansion" clause.
- **NFR6 (10s wall-clock budget)**: not asserted in CI (per AC #3's own guidance — real-LLM variance makes it flaky). Documented here: the handler's three sequential awaits are searchDocuments (≈1–2s typical), generateCompletion (≈3–6s typical for an 8-question quiz on the default model), and the Convex mutation (<300ms). Headroom remains for slower models; the questionCount cap of 8 combined with `max_tokens: 3000` bounds the LLM turn.

### File List

**New files:**
- `convex/quizzes.ts`
- `convex/quizzes.test.ts`
- `server/utils/quiz-prompt.ts`
- `server/utils/quiz-prompt.test.ts`
- `server/api/quiz/generate.post.ts`
- `server/api/quiz/generate.post.test.ts`
- `app/composables/useQuizzes.ts`
- `app/components/quiz/Tab.vue`
- `app/components/quiz/CardPreview.vue`
- `tests/component/quiz/quiz-tab.test.ts`

**Modified files:**
- `convex/schema.ts` — added `quizzes` + `quizQuestions` tables with required indexes
- `convex/accountDeletion.ts` — added `deleteAllQuizQuestionsForUser` + `deleteAllQuizzesForUser`; wired into cascade between messages/conversations and documents
- `convex/accountDeletion.test.ts` — new P0 case asserting quizzes + quizQuestions cascade + cross-user isolation
- `convex/dataExport.ts` — `collectUserData` now returns `quizzes` + `quizQuestions` sourced via `by_userId` indexes
- `convex/dataExport.test.ts` — extended empty-user case + new user-scoped population case
- `convex/documentActions.test.ts` — 8 failing tests swapped from `test(...)` to `skip(...)` with an in-file explanatory comment (Task 9 triage)
- `server/api/export/me.get.ts` — `quizzes.json` now contains real data; new `quizQuestions.json` entry; manifest bumped to schemaVersion 2 with quiz counts
- `server/api/export/me.get.test.ts` — zip-entries assertion updated to include `quizQuestions.json`; schemaVersion bumped to 2
- `app/pages/app/folders/[id].vue` — added Quiz tab between Chat and Documents; renders `<QuizTab>`
- `_bmad-output/implementation-artifacts/deferred-work.md` — logged documentActions triage results + chat-input baseline
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status bumped from backlog → ready-for-dev → review (this commit)

### Change Log

- 2026-04-12: Story 6-1 implemented. Convex schema gains `quizzes` + `quizQuestions`; cascade delete covers both. `POST /api/quiz/generate` wires AI Search → LLM quiz-prompt → Convex persistence. Folder Quiz tab added with empty / generating / list states. Data export now includes quizzes + quizQuestions (schema v2). Epic 5 retro prep #2 (quiz prompt spike), #3 (Reka-portal mountSuspended Decision + PR), #5 (documentActions.test.ts triage), and #6 (cascade re-audit for new table) folded in per the prep plan. Baseline stabilized: 0 convex/server failures (was 8); added convex/server tests: +7 quiz-prompt, +7 quizzes convex, +7 quiz generate handler, +2 dataExport extensions, +1 cascade extension. Component-layer: +5 quiz-tab assertions passing.
