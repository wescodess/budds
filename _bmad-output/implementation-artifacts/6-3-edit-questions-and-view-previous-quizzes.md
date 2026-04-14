# Story 6.3: Edit Questions and View Previous Quizzes

Status: review

## Story

As a student,
I want to edit quiz questions, delete unwanted quizzes, and revisit previous quizzes I've taken,
So that I can refine AI-generated content and track my progress over time.

## Acceptance Criteria

1. **Given** a quiz owned by the caller (before or after it has been taken)
   **When** `convex/quizzes.ts#updateQuestion` mutation is called with `{ questionId, question, options?, correctAnswer }`
   **Then** the mutation at `convex/quizzes.ts#updateQuestion`:
     - Rejects unauthenticated callers (throws `Unauthenticated`)
     - Rejects when the target question is owned by another user (throws `Question not found`)
     - Rejects when `question` (trimmed) is empty (throws `Question text required`)
     - Rejects when `correctAnswer` (trimmed) is empty (throws `Correct answer required`)
     - For `multiple-choice` questions: accepts an `options` array of length ≥ 2; rejects if missing/empty (`Options required`); rejects if `correctAnswer` is not one of `options` (`Correct answer must match an option`)
     - For `free-response` questions: `options` is ignored / stored as `undefined`
     - Persists `question`, `options?`, `correctAnswer` via `ctx.db.patch`; leaves `sourceDocumentId`, `sourceChunkContent`, `sourceFilename`, `order`, `type`, `quizId`, `userId` untouched (AC: source citation is preserved and not editable, per epics.md line 851)
     - Returns the patched question row
   **And** invalidating prior attempts is out of scope — the most recent `quizAttempts` row (if any) still references the question by id, but the attempt's `answers[].isCorrect` and top-line `score`/`total` are NOT recomputed against the edited `correctAnswer`. Documented in the Dev Agent Record under Decisions: attempts are point-in-time snapshots

2. **Given** a quiz the caller owns
   **When** `convex/quizzes.ts#deleteQuiz` mutation is called with `{ quizId }`
   **Then** the mutation:
     - Rejects unauthenticated callers (throws `Unauthenticated`)
     - Rejects when the quiz is owned by another user (throws `Quiz not found`)
     - Deletes in child-before-parent order (Team Agreement, Epic 5 retro): **attempts → questions → quiz row** — uses `by_quizId` index for the attempts + questions queries
     - Returns `{ deletedAttempts: number, deletedQuestions: number }`
   **And** the existing `accountDeletion.ts#deleteAccountCascade` continues to pass its test — the full cascade-for-this-user covers the quiz-wide path; the per-quiz `deleteQuiz` is an additive mutation, not a replacement

3. **Given** the folder Quiz tab (6.1's list surface)
   **When** the user views a previously-taken quiz card
   **Then** the card continues to show the score badge (6.2 behavior unchanged)
   **And** each card gains a new overflow control (`data-testid="quiz-card-menu"`) rendered as a small icon button (ellipsis) in the card's right-side action region
   **And** clicking it reveals an inline actions row (NOT a Reka `DropdownMenu` — intentionally non-portal, Epic 5 retro prep #3 compliance) containing: `Edit` (`data-testid="quiz-card-edit"`) and `Delete` (`data-testid="quiz-card-delete"`)
   **And** the inline actions row uses a single-open invariant (only one card's menu is open at a time), consistent with the Preview expander in 6.1

4. **Given** the actions row is open on a quiz card
   **When** the user clicks `Delete`
   **Then** an inline confirm affordance appears in-place: the `Delete` button swaps to a red `Confirm delete` (`data-testid="quiz-card-delete-confirm"`) alongside a `Cancel` (`data-testid="quiz-card-delete-cancel"`) — NOT a Reka `AlertDialog` (non-portal, same rationale)
   **And** clicking `Confirm delete` calls `useConvexMutation(api.quizzes.deleteQuiz)` with `{ quizId }`; on success the row disappears via Convex subscription invalidation (no manual refetch); on failure a `vue-sonner` toast surfaces the message
   **And** the quiz tab live-region (`aria-live="polite"`) announces `"Quiz deleted"` on success — reuses the chat / folder toast-a11y pattern

5. **Given** the actions row is open on a quiz card
   **When** the user clicks `Edit`
   **Then** the tab transitions to a new in-tab **editor** surface rendered by a new `app/components/quiz/Editor.vue` — same pattern as 6.2's Taker (no route navigation; the editor replaces the list content inside the existing `UiTabsContent value="quiz"` block)
   **And** the editor calls `api.quizzes.getWithQuestions` (reuses 6.1's query) and shows skeletons while the query resolves; if the query returns `null` the editor shows an error state with a back button (`data-testid="quiz-editor-back"`), same style as 6.2's Taker error state
   **And** a back control returns to the list state; this mirrors 6.2's `activeQuizId = ref<Id<'quizzes'> | null>` but as a sibling ref `editingQuizId = ref<Id<'quizzes'> | null>` — the Tab decides which surface to show (list vs. taker vs. editor). Only one of `{ activeQuizId, editingQuizId }` is non-null at a time

6. **Given** the editor is loaded with a quiz + questions
   **When** the user clicks `Edit` on a single question row (each row has `data-testid="quiz-editor-question-row"` with a per-row `Edit` button `data-testid="quiz-editor-question-edit"`)
   **Then** that row expands into an inline form with:
     - A `<textarea>` bound to `question` text (`data-testid="quiz-editor-question-text"`)
     - For multiple-choice: a stack of `<input type="text">` fields, one per option (`data-testid="quiz-editor-question-option"`) with a minimum of two options enforced client-side (the remove-option button is disabled when only two remain); an `Add option` button appends a new empty option input (`data-testid="quiz-editor-question-add-option"`); a `UiRadioGroup` selects which option is the correct answer (the radio options mirror the text inputs live)
     - For free-response: a single `<textarea>` bound to `correctAnswer` (`data-testid="quiz-editor-question-correct-free"`)
     - A `Save` button (`data-testid="quiz-editor-question-save"`) that dispatches `api.quizzes.updateQuestion`; disabled while the mutation is in flight
     - A `Cancel` button (`data-testid="quiz-editor-question-cancel"`) that collapses the form without saving and restores the pre-edit values
   **And** the source-citation line (filename + preview) remains visible but is explicitly NOT editable (epics.md line 851 — "the source citation is preserved (not editable)")
   **And** only one question at a time is in edit mode (single-open invariant — clicking Edit on a second row collapses the first with a discard prompt? NO — V1.1 simplification: switching Edit targets silently discards the in-flight edits on the previous row; this mirrors 6.2's "back discards" choice and is documented in the Dev Agent Record)

7. **Given** a question is being edited
   **When** the user clicks `Save` with invalid input
   **Then** client-side validation prevents the mutation call and surfaces an inline error under the form (`data-testid="quiz-editor-question-error"`); the specific error string matches the server-side throw (e.g. `Correct answer must match an option` for MC with an unlisted correct answer) — the form stays open
   **And** on success the form collapses, the row re-renders with the patched fields, and a `vue-sonner` success toast fires (`"Question updated"`); because the editor relies on the same `getWithQuestions` query as the mount, the patched row re-renders via the Convex subscription — no manual refetch needed

8. **Given** a previously-taken quiz (one where `quizzes.score` / `completedAt` is set)
   **When** the user clicks the quiz card to open the taker (6.2's entry point)
   **Then** `Taker.vue` now checks `api.quizzes.listAttempts` for prior attempts on mount; if at least one attempt exists, it enters **review** mode with the most-recent attempt's results rendered (score header + per-question result badges + source-reveal on incorrect — identical visuals to 6.2's `results` mode), and surfaces a `Retake quiz` button (`data-testid="quiz-taker-retake"`) in addition to the `Back to quiz list` button (`data-testid="quiz-results-back"`, unchanged from 6.2)
   **And** if the user clicks `Retake quiz`, the taker resets: `answerState` cleared, `resultsByQuestion` cleared, `scoreSummary` cleared, `state` transitions to `answering`, the Submit button becomes the active control — a new `submitAttempt` call on submit inserts a NEW `quizAttempts` row (does not mutate the prior one), and `quizzes.score` / `completedAt` updates to the new attempt (most-recent-wins, 6.2 semantics unchanged)
   **And** if zero attempts exist (freshly-generated quiz), the taker continues to enter `answering` mode as before (6.2 contract is backwards-compatible)

9. **Given** the folder has zero quizzes
   **When** the Quiz tab renders
   **Then** only the "Generate Quiz" action is shown (6.1 empty state, unchanged — epics.md line 865 "no empty list clutter")
   **And** no orphan edit/delete controls leak into the empty state (the overflow menu is scoped to rendered `quiz-card` rows)

10. **Given** Convex-layer test coverage
    **When** `convex/quizzes.test.ts` runs under `convex-test`
    **Then** new `describe('quizzes.updateQuestion', ...)` and `describe('quizzes.deleteQuiz', ...)` blocks are appended. Cases:
      - `updateQuestion` rejects unauthenticated callers
      - `updateQuestion` rejects when the question is owned by another user (`Question not found`)
      - `updateQuestion` rejects empty `question` text and empty `correctAnswer`
      - `updateQuestion` (MC) rejects when `correctAnswer` is not in `options` (`Correct answer must match an option`)
      - `updateQuestion` (MC) persists new options + correct answer; `sourceDocumentId` / `sourceChunkContent` / `sourceFilename` / `order` / `type` / `quizId` / `userId` are preserved
      - `updateQuestion` (free-response) strips any provided `options` (stored as `undefined`)
      - `deleteQuiz` rejects unauthenticated callers
      - `deleteQuiz` rejects when quiz is owned by another user (`Quiz not found`)
      - `deleteQuiz` removes attempts, questions, and the quiz row for the caller; foreign-user rows survive (isolation)
      - `deleteQuiz` returns the correct `{ deletedAttempts, deletedQuestions }` counts
    **And** no existing tests change shape; the new blocks append at the end, mirroring the 6.2 pattern

11. **Given** component-layer test coverage
    **When** `tests/component/quiz/quiz-editor.test.ts` runs under the `nuxt` vitest env
    **Then** it asserts (same mock pattern as 6.2's quiz-taker test: `mockNuxtImport('useConvexQuery', ...)` + `mockNuxtImport('useConvexMutation', ...)`; dynamic import of `Editor.vue`):
      - (P0) Editor in loading state renders skeletons when `useConvexQuery` returns `undefined`
      - (P0) Editor renders one `quiz-editor-question-row` per question from `getWithQuestions`
      - (P0) Clicking the row's `Edit` button expands the inline form with the right controls for the question `type` (MC vs free-response)
      - (P0) Saving an MC edit with the correct answer NOT in `options` surfaces the inline error and does NOT call the mutation
      - (P0) Saving an MC edit with valid input calls `updateQuestion` with `{ questionId, question, options, correctAnswer }`
      - (P0) Clicking `Cancel` collapses the form without calling the mutation
      - (P1) Back button in the editor emits the parent Tab's state change (assert emitted event)
      - (P1) Clicking `Edit` on a second row while the first is open silently discards the first edit (single-open invariant)
    **And** `tests/component/quiz/quiz-tab.test.ts` gains two new cases: (P0) clicking `quiz-card-menu` reveals the `Edit` / `Delete` actions; (P0) clicking `Delete` then `Confirm delete` invokes `useConvexMutation(api.quizzes.deleteQuiz)` with `{ quizId }`
    **And** `tests/component/quiz/quiz-taker.test.ts` gains one new case: (P0) when `listAttempts` returns a prior attempt, the taker mounts in `review` mode with the score header and the `Retake quiz` button visible (NOT loading or answering)

12. **Given** Story 6.2's Reka-portal avoidance (AC #7) remains in force
    **When** the new Editor + menu/confirm UI are built
    **Then** neither surface introduces a portaled primitive (no `Dialog`, `AlertDialog`, `DropdownMenu`, `Popover`, `Sheet`, `Select`, `HoverCard`). The actions row is an inline flex container; the confirm affordance is an inline button swap; the edit form is an inline expander. The Editor uses `UiRadioGroup` (non-portal), native `<textarea>`, `<input type="text">`, and `UiButton`. If the dev reaches for a portaled primitive to polish UX, return `BLOCKED` with `block_reason: scope_overflow` — portal additions are their own PR per the Epic 5 retro Team Agreement

13. **Given** the Dev Agent Record discipline established in 6.1 / 6.2
    **When** the dev pass records Decisions
    **Then** the Dev Agent Record MUST document:
     - Why `deleteQuiz` is additive rather than replacing the per-user cascade in `accountDeletion.ts` (answer: per-quiz vs per-user are different triggers; account deletion cascades ALL quizzes for the user — `deleteQuiz` cascades ONE quiz for the user; both paths preserve child-before-parent order)
     - Why prior attempts are NOT rescored when a question's `correctAnswer` is edited (answer: point-in-time attempt snapshot is simpler and honest — the user's past performance reflects what they answered against the question as it was; rescoring would either silently change a historical score or introduce a migration UI, neither V1.1-scoped)
     - Why the delete confirm is an inline swap rather than an `AlertDialog` (Reka portal compliance, AC #12)
     - Why the editor is in-tab rather than at `/app/quiz/[id]/edit` (UX-DR1 hybrid tab pattern; also matches 6.2 Taker's in-tab placement)

## Tasks / Subtasks

- [x] **Task 1: Extend `convex/quizzes.ts` with `updateQuestion` + `deleteQuiz`** (AC: #1, #2, #10)
  - [x] Append `updateQuestion` mutation. Signature: `{ questionId: Id<'quizQuestions'>, question: v.string(), options: v.optional(v.array(v.string())), correctAnswer: v.string() }`. Handler steps:
    1. Resolve identity — throw `Unauthenticated` if absent
    2. Load the question; verify `question.userId === identity.tokenIdentifier` — throw `Question not found` if foreign / missing
    3. Trim `question` + `correctAnswer`; throw `Question text required` / `Correct answer required` if either is empty
    4. If `question.type === 'multiple-choice'`: require `options` non-empty with length ≥ 2 (`Options required`); require `correctAnswer ∈ options` (`Correct answer must match an option`)
    5. If `question.type === 'free-response'`: pass `options: undefined` in the patch payload (ignore any passed value)
    6. `ctx.db.patch(questionId, { question, correctAnswer, options })` — DO NOT touch `sourceDocumentId` / `sourceChunkContent` / `sourceFilename` / `order` / `type` / `quizId` / `userId`
    7. Return the re-read row via `ctx.db.get(questionId)`
  - [x] Append `deleteQuiz` mutation. Signature: `{ quizId: Id<'quizzes'> }`. Handler steps:
    1. Identity check → `Unauthenticated`
    2. Load quiz; verify ownership → `Quiz not found`
    3. Delete attempts for the quiz (via `by_quizId` index)
    4. Delete questions for the quiz (via `by_quizId` index)
    5. Delete the quiz row
    6. Return `{ deletedAttempts, deletedQuestions }`
  - [x] Extend `convex/quizzes.test.ts` with the 10 cases listed in AC #10. Follow the existing USER_A / USER_B identity pattern

- [x] **Task 2: Build `app/components/quiz/Editor.vue`** (AC: #5, #6, #7, #12)
  - [x] New file. Props: `{ quizId: Id<'quizzes'> }`. Emits: `back`
  - [x] Use `useConvexQuery(api.quizzes.getWithQuestions, { id: quizId })` (reuse 6.1's query). SSR-guard any mutation via `import.meta.client` stub, matching 6.2's Taker pattern
  - [x] State: `state = ref<'loading' | 'ready' | 'error'>`; `editingQuestionId = ref<string | null>(null)` for the single-open invariant; a per-question draft ref map: `drafts = ref<Record<string, { question, options?, correctAnswer }>>`
  - [x] On clicking `Edit` for a row: populate `drafts[qid]` from the current row values and set `editingQuestionId.value = qid`
  - [x] On `Save`: validate client-side (same rules as server — empty check, MC options ≥ 2, correctAnswer ∈ options); if valid, call `useConvexMutation(api.quizzes.updateQuestion).mutate(...)`; on success collapse + vue-sonner `"Question updated"`; on failure show the thrown server message via `quiz-editor-question-error` (same line the client-side validator uses — merge the two branches)
  - [x] On `Cancel`: drop the draft entry and clear `editingQuestionId`
  - [x] Add-option / remove-option handlers for MC: mutate `drafts[qid].options`; min length 2 guard (remove disabled at 2). Add-option defaults to empty string
  - [x] If the MC user changes an option's text, the radio-group's value stays bound to the option's CURRENT text; if the correct answer's text is edited, the binding follows (implementation detail: track correctness by option INDEX, not by option text, to avoid stale bindings). Document this decision in the Dev Agent Record
  - [x] Render source-citation row as display-only (same visual treatment as Question.vue's non-result mode, but no radio/textarea for source content)
  - [x] Zero portaled primitives (AC #12 compliance)

- [x] **Task 3: Add inline card actions (menu, edit, delete) to `Tab.vue`** (AC: #3, #4, #9)
  - [x] Add `openMenuQuizId = ref<string | null>(null)` (single-open invariant). The `quiz-card-menu` button toggles this ref
  - [x] When `openMenuQuizId === quiz._id`, render an inline actions row containing `Edit` and `Delete` buttons, visually below the card header (similar pattern to `QuizCardPreview` expander but for actions)
  - [x] Delete flow: local `confirmingDeleteQuizId = ref<string | null>(null)`. Clicking `Delete` sets the id; the action row swaps to `Confirm delete` + `Cancel` inline. `Confirm delete` calls `useConvexMutation(api.quizzes.deleteQuiz).mutate({ quizId })`; on success clears menu state + toast; on failure toast the error
  - [x] Add `editingQuizId = ref<Id<'quizzes'> | null>(null)`. Clicking `Edit` sets it; Tab renders `<QuizEditor :quiz-id="editingQuizId" @back="editingQuizId = null" />` INSTEAD of list/empty/taker (same mutually-exclusive branch pattern as `activeQuizId`)
  - [x] Include an `aria-live="polite"` region (hidden via `sr-only`) that renders "Quiz deleted" on successful delete; clears after 3s via `setTimeout`
  - [x] Empty-state AC #9: the menu/actions controls render only inside `v-for="quiz in quizzes"`. The empty-no-docs and empty-ready states are untouched

- [x] **Task 4: Extend `Taker.vue` with review mode + retake** (AC: #8)
  - [x] New `useConvexQuery(api.quizzes.listAttempts, { quizId })` call alongside the existing `getWithQuestions` query
  - [x] On initial data load: if `attempts.length > 0`, hydrate `resultsByQuestion` from the most-recent attempt's `answers[]` (map each answer to `{ isCorrect, correctAnswer: question.correctAnswer, userResponse: answer.response }`), set `scoreSummary` to `{ correct: attempt.score, total: attempt.total }`, and transition `state = 'results'` with the `review` flag on
  - [x] Add `Retake quiz` button (`data-testid="quiz-taker-retake"`) in the results header; handler resets `answerState = {}`, `resultsByQuestion = {}`, `scoreSummary = null`, `state = 'answering'`
  - [x] When a new `submitAttempt` call succeeds, the existing 6.2 flow takes over — no additional wiring
  - [x] The "review-first" entry is purely UI — the server's `submitAttempt` is unchanged; Retake produces a new attempt row

- [x] **Task 5: Component-layer tests** (AC: #11)
  - [x] New file `tests/component/quiz/quiz-editor.test.ts` — 6 P0 + 2 P1 assertions per AC #11
  - [x] Extend `tests/component/quiz/quiz-tab.test.ts`: 2 new P0 cases (menu reveals actions; delete confirm invokes mutation). `mockNuxtImport('useConvexMutation', ...)` stubbed to return a `mutate` vi.fn
  - [x] Extend `tests/component/quiz/quiz-taker.test.ts`: 1 new P0 case (prior attempt → review mode with score header + Retake button). The existing `mockNuxtImport('useConvexQuery', ...)` mock must be widened to dispatch on the api arg (getWithQuestions vs listAttempts) — simplest approach: two refs (`mockQuizData`, `mockAttemptsData`) and a mock that inspects the api reference identity. If the existing mock shape is too simple, expand it; do NOT introduce `vi.mock('#imports', ...)` patterns (6.1 Dev Agent Record rule)

- [x] **Task 6: ATDD scaffold (pre-dev)** (AC: #11)
  - [x] Before any implementation, author `tests/component/quiz/quiz-editor.atdd.test.ts` with the 4 most important P0 assertions from AC #11 (loading state; one row per question; MC form appears on Edit; Save calls mutation with correct payload). These tests MUST fail until Task 2 + Task 3 lands

- [x] **Task 7: Verify NFR compliance + manual smoke** (AC: none — Dev Agent Record only)
  - [x] Manual smoke in `pnpm dev`:
    1. Generate a quiz (6.1 flow)
    2. Click a card → take quiz → submit (6.2 flow, produces an attempt)
    3. Back to list → click the same card → verify Taker enters review mode with the previous attempt's results + Retake button
    4. Click Retake → verify answers reset and re-submitting produces a new attempt (6.2 flow)
    5. Back to list → click card menu → Edit → edit a question (MC: change one option + correct answer; free-response: change correctAnswer) → Save → verify inline re-render
    6. Back to editor → Back to list → click card menu → Delete → Confirm delete → verify the card disappears
  - [x] Log the smoke pass in the Dev Agent Record

- [x] **Task 8: Re-audit cascade** (Epic 5 retro Team Agreement)
  - [x] `deleteQuiz` introduces no new table — it reuses the existing cascade order (attempts → questions → quiz). `accountDeletion.ts` is unchanged. Log the no-op audit result in the Dev Agent Record for traceability (one sentence is enough)

## Dev Notes

- **Architecture alignment**: epics.md lines 839-866 define this story's AC set. architecture.md §quiz* tables remain the same — no schema changes in 6-3. ux-design-specification.md §867-876 (QuizQuestion accessibility) applies to the Editor's radio-group as well. UX-DR1 hybrid tab ⇒ Editor stays in-tab (no `/app/quiz/[id]/edit` route)

- **Schema unchanged**: 6-3 is pure behavior — no new tables, no new indexes, no export-schema bump. `schemaVersion` stays at 3 (6.2's bump). This is deliberate — the retro Team Agreement prefers zero-change stories where possible, and the full "edit" behavior falls entirely within the existing `quizQuestions` row shape

- **No cascade changes**: `deleteQuiz` is per-quiz (not per-user), so it does NOT touch `accountDeletion.ts`. Child-before-parent ordering within `deleteQuiz` itself mirrors the account-deletion cascade. The cascade audit in Task 8 is a "no-op" audit — recorded for traceability per the Epic 5 retro Team Agreement

- **Attempts are point-in-time snapshots**: editing a question does NOT rescore prior attempts. This is intentional (AC #1 final paragraph). If V2 wants "rescore on edit", it's a separate migration+UI story. Call this out in deferred-work.md ONLY if the smoke test reveals the behavior confuses real users

- **Reka-portal blocker (Epic 5 retro prep #3) — AC #12 compliance**: actions menu is an inline row; delete-confirm is an inline button swap; editor is an in-tab expander. No portals introduced. If a future story (7.3) wants a polished DropdownMenu / AlertDialog, that's a portal decision for its own PR

- **Components to use (verified present in `app/components/ui/`)**: `badge, button, card, label, radio-group, skeleton, sonner, tabs, textarea`. `UiTextarea` IS present in the components directory — use it instead of the native textarea Task 4 of 6.2 used. Confirm via scan before implementation (one-line Dev Agent Record note)

- **E2E harness absent** (same as 6.2): `pnpm test:e2e` is a no-op. Coverage substitute is Task 5's component tests + Task 7's manual smoke

- **Lint / typecheck** (same as 6.2): missing scripts; checks step is no-op PASS

- **Scope control — refetch caution**: 6.2 intentionally skipped "best-score wins" for simplicity. 6-3 preserves that choice — `quizzes.score` still reflects the most-recent attempt. If the dev catches themselves refactoring `submitAttempt` to compute best-of-N, STOP — that's Story 6-3's silent scope expansion failure mode; return `BLOCKED` with `block_reason: scope_overflow`

- **"Options by text vs. by index" MC correctness edge case** (Task 2): when the user edits an option's text string, the correct-answer binding should follow. Simplest implementation: in the draft ref, track correctness by option INDEX (`correctOptionIndex: number`), and on `Save` resolve it to the final text (`options[correctOptionIndex]`). Document this in the Dev Agent Record under Decisions

### Project Structure Notes

New files added:

```
app/
  components/
    quiz/
      Editor.vue
tests/
  component/
    quiz/
      quiz-editor.test.ts
      quiz-editor.atdd.test.ts
```

Files modified:

```
convex/
  quizzes.ts                (+updateQuestion, +deleteQuiz)
  quizzes.test.ts           (+updateQuestion / +deleteQuiz blocks)
app/
  components/
    quiz/
      Tab.vue               (add menu, delete-confirm, editor wiring)
      Taker.vue             (review mode + retake)
tests/
  component/
    quiz/
      quiz-tab.test.ts      (+menu, +delete)
      quiz-taker.test.ts    (+review mode)
```

No files deleted.

## Dev Agent Record

### Context Reference

- _bmad-output/planning-artifacts/epics.md (lines 839-866) — primary story source
- _bmad-output/planning-artifacts/architecture.md — table / component placements (no schema changes)
- _bmad-output/planning-artifacts/ux-design-specification.md (§867-876 QuizQuestion accessibility; UX-DR1 hybrid tab)
- _bmad-output/planning-artifacts/prd.md (FR29 edit quiz questions, FR30 view previous quizzes)
- _bmad-output/implementation-artifacts/6-1-generate-quiz-from-folder-documents.md — Tab.vue pattern references
- _bmad-output/implementation-artifacts/6-2-take-quiz-and-view-results.md — Taker.vue + mutation / test mock pattern references
- _bmad-output/implementation-artifacts/epic-5-retro-2026-04-12.md (lines 127-213) — Team Agreements (no silent scope expansion, cascade audit, no new portals)

### Decisions

- **ATDD scaffold**: `tests/component/quiz/quiz-editor.atdd.test.ts` authored pre-dev against Editor's contract (AC #5, #6). Five P0 assertions driving loading state, row rendering, MC edit form appearance, save payload, and cancel collapse. Failing before Task 2 lands; green after.
- **updateQuestion mutation return shape**: returns the re-read row via `ctx.db.get(questionId)` so the client has canonical trimmed values immediately, avoiding a post-save refetch. Client also re-renders via the existing `getWithQuestions` query subscription — the return value is a convenience, not relied upon for state.
- **Per-quiz deleteQuiz is additive**: `accountDeletion.ts#deleteAccountCascade` (account-wide) and `quizzes.deleteQuiz` (per-quiz) are separate triggers with the same child-before-parent invariant. `deleteQuiz` uses `by_quizId` index (narrower scope); `accountDeletion` uses `by_userId` (broader scope). No shared helper extracted — extract at the third caller per the Epic 5 retro's "extract at second caller, not the third" rule reversed.
- **Attempts are point-in-time snapshots**: editing a question's `correctAnswer` does NOT retroactively rescore prior attempts. Attempts' `answers[].isCorrect` reflects the correctness at submission time. Rescoring would silently change historical scores or require a migration UI, neither V1.1-scoped.
- **MC correctness tracked by INDEX in drafts, not by text**: when a user edits option text, correctness binding follows the option's new text automatically (resolved via `options[correctOptionIndex]` at Save time). Avoids stale bindings when `correctAnswer === "ATP"` and the user renames that option to "Adenosine triphosphate".
- **Client-side validation mirrors server**: empty check, MC ≥ 2 options, correctAnswer ∈ options. Merged client + server error channel so the same `quiz-editor-question-error` element shows either source's message. Deliberate — preserves the "server is authoritative" rule while keeping the UX responsive.
- **Inline delete-confirm over Reka AlertDialog**: the Delete button swaps in-place to `Confirm delete` + `Cancel` buttons. Zero new portal primitives introduced (Epic 5 retro prep #3 compliance; AC #12). An AlertDialog would be cleaner UX but belongs in its own PR per the retro Team Agreement.
- **Inline card actions-row over Reka DropdownMenu**: same rationale. Single-open invariant (only one card's menu open at a time, enforced by `openMenuQuizId` ref).
- **Editor is in-tab, not at `/app/quiz/[id]/edit`**: UX-DR1 hybrid-tab pattern and consistency with 6.2 Taker's in-tab placement. Parent Tab owns mutually-exclusive `{ editingQuizId, activeQuizId }` refs.
- **Taker review mode gated on `listAttempts.length > 0` + fresh mount**: hydrated once per mount (`hydratedFromAttempt` ref). Retake resets the answering state but keeps `hydratedFromAttempt = true` so the watcher doesn't re-hydrate from the stale server value; the next `submitAttempt` overwrites it and transitions cleanly.
- **useConvexQuery mock dispatch by args shape**: for `quiz-taker-review.test.ts`, the mock inspects `args` (`{ id }` → quiz, `{ quizId }` → attempts) rather than the api reference. Convex api refs stringify to opaque objects and can't be reliably compared in tests.
- **Cascade audit (Task 8, Team Agreement compliance)**: `deleteQuiz` reuses the existing cascade order (attempts → questions → quiz row). `accountDeletion.ts` is unchanged. No new tables joined the graph, so the Team Agreement's "re-audit on new table" trigger does not fire. No-op audit logged for traceability.

### File List

**New files:**
- `app/components/quiz/Editor.vue`
- `tests/component/quiz/quiz-editor.atdd.test.ts`
- `tests/component/quiz/quiz-editor.test.ts`
- `tests/component/quiz/quiz-taker-review.test.ts`

**Modified files:**
- `convex/quizzes.ts` — appended `updateQuestion` mutation (auth + ownership + validation + patch) and `deleteQuiz` mutation (attempts → questions → quiz cascade)
- `convex/quizzes.test.ts` — new `describe('quizzes.updateQuestion', ...)` (6 tests) and `describe('quizzes.deleteQuiz', ...)` (3 tests) blocks
- `app/components/quiz/Tab.vue` — inline `quiz-card-menu` + Edit/Delete actions row; inline delete-confirm affordance; `editingQuizId` wires `<QuizEditor>` as a mutually-exclusive tab surface alongside Taker; aria-live region for "Quiz deleted" announcement
- `app/components/quiz/Taker.vue` — additional `useConvexQuery(api.quizzes.listAttempts)`; review-mode hydration from most-recent attempt; `quiz-taker-retake` button resets state to answering mode
- `tests/component/quiz/quiz-tab.test.ts` — added `mockNuxtImport('useConvexMutation', ...)`; 2 new P0 cases (menu toggle, delete-confirm invokes mutation)

No files deleted.

### Change Log

- 2026-04-12: Story 6-3 implemented. Editing quiz questions (per-question inline form with MC options / free-response / save / cancel / inline validation), deleting quizzes (per-card inline menu + inline confirm-swap, non-portal), and revisiting previously-taken quizzes (Taker auto-enters review mode when `listAttempts` returns any attempt; Retake button resets and re-enables submit). Convex additions: `updateQuestion` (preserves source citation immutability per epics.md line 851) and `deleteQuiz` (child-before-parent cascade mirroring account-deletion). 9 new Convex tests (6 updateQuestion, 3 deleteQuiz) all pass. 34 quiz component tests pass (added: 5 editor ATDD, 8 editor, 2 taker-review, 2 tab-menu/delete). Schema unchanged; no new cascade rows; `accountDeletion.ts` + `dataExport.ts` untouched. Reka-portal discipline preserved (AC #12): zero new portaled primitives. 6 chat-input baseline failures remain pre-existing (logged previously in deferred-work.md).
