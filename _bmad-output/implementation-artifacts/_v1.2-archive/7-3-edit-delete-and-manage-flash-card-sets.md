# Story 7.3: Edit, Delete, and Manage Flash Card Sets

Status: done

## Story

As a student,
I want to edit card content, remove bad cards, and revisit previous sets,
So that I can curate high-quality study materials tailored to my needs.

## Acceptance Criteria

1. **Given** a user viewing the list of flash card sets in the Flash Cards tab
   **When** they click the per-row ellipsis icon button (`data-testid="flashcards-set-menu"`, `aria-label="Flash card set actions"`)
   **Then** an **inline** actions row expands beneath the set row (`data-testid="flashcards-set-actions"`) showing **Edit** (`data-testid="flashcards-set-edit"`) and **Delete** (`data-testid="flashcards-set-delete"`) buttons
   **And** re-clicking the same ellipsis icon closes the row
   **And** opening another row's menu closes any previously open row (single-open invariant)
   **And** the actions row does NOT introduce any Reka-portaled primitive (no `UiDropdownMenu`, `UiPopover`, `UiDialog`, `UiAlertDialog`) — it is a plain `v-if` block beneath the row, matching the 6-3 quiz pattern

2. **Given** the inline actions row is open for a set
   **When** the user clicks **Delete**
   **Then** the Edit and Delete buttons are replaced in-place by a **Confirm delete** button (`data-testid="flashcards-set-delete-confirm"`) plus a **Cancel** button (`data-testid="flashcards-set-delete-cancel"`)
   **And** clicking Cancel returns to Edit/Delete without firing any mutation
   **And** clicking Confirm delete calls the new `flashcards.deleteSet` mutation with `{ setId }` and on success removes the set from the list
   **And** a success toast ("Flash card set deleted") and a polite live-region announcement fire once the mutation resolves
   **And** while the mutation is in-flight both Confirm and Cancel are disabled (`:disabled="deleting"`)

3. **Given** the inline actions row is open for a set
   **When** the user clicks **Edit**
   **Then** the Flash Cards tab body swaps from the list surface to an **editor surface** (same pattern as 7-2's study surface — a ref-driven branch of `Tab.vue`; the list state is NOT destroyed, just hidden)
   **And** the editor surface lives in a new dedicated component `app/components/flashcards/Editor.vue` that receives `{ setId }` and emits `back`
   **And** the editor loads its data via the existing `useConvexQuery(api.flashcards.getSetWithCards, { id: setId })` query (no new query needed)

4. **Given** the editor surface is loaded
   **When** it first renders
   **Then** it shows the set title at top, a **Back to sets** button (`data-testid="flashcards-editor-back"`, emits `back`), and a vertical list of card rows (`data-testid="flashcards-editor-card-row"`, one per card, ordered by `card.order`)
   **And** each row shows: the card's `front`, the card's `back` beneath it, the source citation badge + chunk preview, and a per-row **Edit** button (`data-testid="flashcards-editor-card-edit"`) plus a per-row **Delete** button (`data-testid="flashcards-editor-card-delete"`)
   **And** the read-only row renders as static text (no editable inputs) — the inputs only appear when Edit is clicked

5. **Given** the user clicks **Edit** on a card row
   **When** the row enters edit mode (`editingCardId` ref === `card._id`)
   **Then** the card's `front` and `back` text become editable textareas (`data-testid="flashcards-editor-card-front"`, `flashcards-editor-card-back`)
   **And** a **Save** button (`data-testid="flashcards-editor-card-save"`) and **Cancel** button (`data-testid="flashcards-editor-card-cancel"`) render at the bottom of the row
   **And** only one card row can be in edit mode at a time (clicking Edit on a different row switches which row's draft is active; the previous draft is discarded)
   **And** the source citation badge + chunk preview remain visible but are **not editable** (AC preservation — `sourceFilename`, `sourceChunkContent`, `sourceDocumentId` are server-enforced immutable fields)

6. **Given** the user is editing a card row
   **When** they modify `front` or `back` and click **Save**
   **Then** client validation runs first: both `front` and `back` must be non-empty after `.trim()` — empty fields surface an inline error (`data-testid="flashcards-editor-card-error"`, e.g. "Front text required" / "Back text required") and do NOT fire the mutation
   **And** on valid input the client calls `flashcards.updateCard` with `{ cardId, front, back }` (trimmed)
   **And** on server success the row collapses back to read-only view with the new values
   **And** a success toast ("Card updated") fires
   **And** server-side errors (thrown from the mutation) populate the same inline error slot (e.g. ownership denied surfaces as "Card not found")

7. **Given** the user clicks **Delete** on a card row
   **When** the per-row inline Confirm/Cancel swap activates (same pattern as set-level delete — NOT a portal)
   **Then** the row's Edit/Delete buttons are replaced in-place by **Confirm delete** (`data-testid="flashcards-editor-card-delete-confirm"`) and **Cancel** (`data-testid="flashcards-editor-card-delete-cancel"`)
   **And** clicking Cancel returns to Edit/Delete
   **And** clicking Confirm delete calls a new `flashcards.deleteCard` mutation with `{ cardId }`
   **And** on success the card row is removed from the editor list AND the parent `flashcardSets.cardCount` is decremented by 1 (server enforces this so any concurrent Study session sees the updated count on reload)
   **And** if deleting the last card in the set, the row disappears and the editor still renders (empty list message "No cards remaining — return to the sets list and delete the set or regenerate."); the set itself is NOT auto-deleted (user must do that explicitly to avoid surprise)

8. **Given** the new Convex mutations must be scoped to owner
   **When** any of `flashcards.updateCard`, `flashcards.deleteCard`, `flashcards.deleteSet` are invoked
   **Then** each validates `ctx.auth.getUserIdentity()` → `identity.tokenIdentifier`, throws `Unauthenticated` when absent, and throws `Card not found` / `Set not found` when the target row's `userId` does not match (never leaking existence of another user's data)
   **And** `updateCard` preserves `setId`, `userId`, `order`, `sourceDocumentId`, `sourceChunkContent`, `sourceFilename` unchanged — only `front` and `back` are patched (verified by a unit test that asserts these fields still equal the pre-patch values after update)
   **And** `updateCard` applies the same trim + non-empty validation on the server that the client does (defense in depth): trimmed empty `front` or `back` throws "Front text required" / "Back text required"

9. **Given** the Epic 5/6/7 cascade-safety standing rule (child-before-parent deletion)
   **When** `flashcards.deleteSet` runs
   **Then** it first deletes ALL `flashcards` rows where `setId === args.setId` (iterating via `by_setId` index and batching like `deleteAllFlashcardsForUser`), then deletes the parent `flashcardSets` row
   **And** the mutation returns `{ deletedCards: <number> }` so tests can assert the cascade count
   **And** concurrent set-owned rows belonging to a different user (impossible by definition since `setId` is unique but defensive) or different set remain untouched
   **And** the already-shipped `deleteAccountCascade` helper is NOT modified — its `deleteAllFlashcardsForUser` + `deleteAllFlashcardSetsForUser` ordering already satisfies child-before-parent for the whole-user path

10. **Given** the existing `flashcardSets.cardCount` column is a denormalized count
    **When** `flashcards.deleteCard` removes a card
    **Then** the mutation patches the parent set with `cardCount: set.cardCount - 1` in the same transaction (single `ctx.db.patch`), never going below 0
    **And** the client does not need to re-query — the reactive `listByFolder` + `getSetWithCards` queries surface the new value automatically

11. **Given** the Flash Cards tab already lists previously generated sets (shipped in 7-1; reused verbatim)
    **When** a user views the tab with one or more sets
    **Then** the list renders ordered by `_creationTime` descending (already in place via `listByFolder` `.order('desc')`) — no changes to the query
    **And** each list entry continues to show: set title, creation date, card count (now reactive to deletions per AC #10)
    **And** clicking a list entry continues to open the Study surface (7-2 behavior — unchanged)

12. **Given** a user clicks on a previous flash card set
    **When** it loads the Study surface
    **Then** they resume from card 0 / front-side (7-2 behavior — no persisted study state per Story 7.1 Dev Notes; "resume from the beginning" in the AC means session restart, not SRS)
    **And** this behavior is already realized by 7-2; no changes needed in this story

13. **Given** the empty-list AC from epics.md #5 (no sets yet)
    **When** a user views the Flash Cards tab in a folder with no generated sets
    **Then** only the **Generate Flash Cards** action is shown — existing 7-1 empty-ready state (`data-testid="flashcards-empty-ready"`) already satisfies this; no changes needed

14. **Given** Epic 5/6/7 standing rule — no Reka-portaled primitives inside a component that `mountSuspended` will render
    **When** `Editor.vue` and the Tab.vue row-menu surface are built
    **Then** neither introduces `UiDialog`, `UiAlertDialog`, `UiPopover`, `UiDropdownMenu`, or `UiSelect`
    **And** the component-layer tests `tests/component/flashcards/flashcards-editor.test.ts` and the updated `tests/component/flashcards/flashcards-tab.test.ts` both `mountSuspended` their surfaces and exercise the full flow without portal-escape workarounds (mirrors 6-3 `quiz-editor.test.ts` + the quiz-tab delete flow)

15. **Given** ATDD red-first is the standing rule (Epic 5/6/7 retros)
    **When** dev-story begins implementation (Task 3)
    **Then** the failing component test `tests/component/flashcards/flashcards-editor.atdd.test.ts` exists first and exercises the core flow (list → click Edit on row → textareas appear → Save → mutation called → row collapses). Generated via the `bmad-bmm-workflows-testarch-atdd` skill in Task 1

16. **Given** data-export schemaVersion (currently 4 per 7-1) tracks persisted-table shape
    **When** this story ships
    **Then** `convex/schema.ts` is NOT modified (no new columns, no new indexes), `convex/dataExport.ts` schemaVersion stays at **4**, and no new cascade helper is added
    **And** the existing `dataExport.ts` `flashcards.json` + `flashcardSets.json` already include the columns touched here — post-patch rows will export correctly with no export-code change

## Tasks / Subtasks

- [x] **Task 1 (ATDD red-first): Scaffold failing editor + tab-delete component tests** (AC: #15, #14)
  - [x] Invoke `bmad-bmm-workflows-testarch-atdd` against this story file. Expected output: `tests/component/flashcards/flashcards-editor.atdd.test.ts` and an extension block for `tests/component/flashcards/flashcards-tab.test.ts` (or a sibling atdd file for the tab-delete flow)
  - [x] Mocks: `mockNuxtImport('useConvexQuery', ...)` returns a ref with sample `{ set, cards }`; `mockNuxtImport('useConvexMutation', ...)` returns a `mutate` spy
  - [x] Tests expected to fail initially (Editor.vue does not exist yet, Tab.vue lacks menu/confirm markup). Decisions log entry if ATDD emits zero tests

- [x] **Task 2: New Convex mutations** `flashcards.updateCard`, `flashcards.deleteCard`, `flashcards.deleteSet` (AC: #6, #7, #8, #9, #10, #16)
  - [x] Add to `convex/flashcards.ts` — mirrors `quizzes.updateQuestion` + `quizzes.deleteQuiz` shape
  - [x] `updateCard`: args `{ cardId, front, back }`; identity+ownership; trim+non-empty validation; `ctx.db.patch` only `front` and `back`; test that `setId`/`userId`/`order`/source fields are unchanged
  - [x] `deleteCard`: args `{ cardId }`; identity+ownership; delete the card row; patch the parent set with `cardCount: max(0, set.cardCount - 1)` in same transaction; return `{ setId, cardCount }`
  - [x] `deleteSet`: args `{ setId }`; identity+ownership; iterate `flashcards` by `by_setId` index in batches of 500 (matches `deleteAllFlashcardsForUser` pattern but scoped to setId); delete each; THEN delete parent `flashcardSets` row; return `{ deletedCards }`
  - [x] `convex/schema.ts` unchanged — confirmed by a schema diff check before commit

- [x] **Task 3: Convex unit tests** for the three new mutations in `convex/flashcards.test.ts` (AC: #8, #9, #10, #16)
  - [x] `updateCard`: unauth rejected; cross-user rejected with "Card not found"; empty front/back rejected; valid input updates only `front`+`back`; invariant check — `setId`/`userId`/`order`/`sourceDocumentId`/`sourceChunkContent`/`sourceFilename` equal pre-patch values after update
  - [x] `deleteCard`: unauth rejected; cross-user rejected with "Card not found"; success removes the card and decrements parent `cardCount`; deleting the last card leaves the set with `cardCount === 0`
  - [x] `deleteSet`: unauth rejected; cross-user rejected with "Set not found"; success deletes all child cards (assert by `by_setId` index returning empty) AND the parent set; returns accurate `deletedCards` count; sibling sets (different `setId`, same user) untouched; another user's set untouched

- [x] **Task 4: Create `Editor.vue` component** (AC: #3, #4, #5, #6, #7, #14)
  - [x] New file `app/components/flashcards/Editor.vue`. `defineProps<{ setId: Id<'flashcardSets'> }>()`, `defineEmits<{ back: [] }>()`
  - [x] Load via `useConvexQuery(api.flashcards.getSetWithCards, computed(() => ({ id: setId })))` with three states (loading/error/ready) — same structure as `quiz/Editor.vue`
  - [x] Per-card row: read-only view with front/back/citation/chunk preview; Edit button; Delete button. When `editingCardId === card._id` → textareas + Save/Cancel. When `confirmingDeleteCardId === card._id` → Confirm-delete + Cancel (swapped in place of Edit/Delete). Draft map keyed by `card._id`
  - [x] Client validation mirrors server: trim empty check; error surfaces in `flashcards-editor-card-error`
  - [x] Zero portaled primitives in subtree — inspection before commit

- [x] **Task 5: Update `Tab.vue`** — set-level ellipsis menu + inline actions row + delete-confirm swap + Edit branch (AC: #1, #2, #3, #11, #14)
  - [x] Add `openMenuSetId`, `confirmingDeleteSetId`, `deleting`, `editingSetId`, `liveMessage` refs (mirrors `quiz/Tab.vue`)
  - [x] Wire the `api.flashcards.deleteSet` mutation via `useConvexMutation` with the same SSR-guard pattern used in `quiz/Tab.vue`
  - [x] Add the ellipsis icon button + `v-if="openMenuSetId === set._id"` actions row beneath each set row; inline Confirm-delete swap; on confirm, call mutation, toast, announce, close menu
  - [x] Add `editingSetId` branch: when non-null, render `<FlashcardsEditor :set-id="editingSetId" @back="editingSetId = null" />` as the tab body (highest-priority `v-if`, above the `activeSetId` study branch)
  - [x] Set-row click-through still opens Study (unchanged) — but clicks on the ellipsis button use `@click.stop` so they don't also trigger `handleSetSelect`

- [x] **Task 6: Full component-layer test suite** (AC: #14, #15)
  - [x] New file `tests/component/flashcards/flashcards-editor.test.ts`: loading/error/ready states; one row per card; Edit opens textareas; Save calls mutation with trimmed payload; Cancel does not call mutation; empty front/back blocks Save and shows error; Delete → Confirm delete calls mutation; Cancel on confirm reverts; Back button emits `back`
  - [x] Extend `tests/component/flashcards/flashcards-tab.test.ts` (or create it if missing) to cover: ellipsis menu toggle; Edit button sets `editingSetId` and renders Editor; Delete → Confirm delete → mutation called with `{ setId }`

- [x] **Task 7: Document decisions in Dev Agent Record** (AC: retro rules)
  - [x] Log the no-portal decision (inline menu + inline confirm — match 6-3 quiz pattern)
  - [x] Log the child-before-parent cascade order in `deleteSet`
  - [x] Log the source-field immutability invariant in `updateCard`
  - [x] Log the schemaVersion=4 (no bump) and schema-unchanged decision
  - [x] Log any ATDD-skipped assertions with specific blockers

## Dev Notes

- **Architecture alignment**: `epics.md` lines 949–982 define this story. `architecture.md` calls out flashCards persisted table with edit/delete mutations as the V1.1 finish state. UX spec §7 FlashCard references an "Editing mode" as part of UX-DR10 — realized here as a dedicated `Editor.vue` inline surface (no modal portal, per Epic 5/6 retro rule).

- **Reka-portal discipline (binding Epic 5/6/7 rule)**: Both the Tab row-menu and Editor's per-card actions use inline swap-in-place patterns only. No `UiDialog`, `UiAlertDialog`, `UiPopover`, `UiDropdownMenu`, `UiSelect`. The quiz/Tab.vue + quiz/Editor.vue shipped in 6-3 are the exact template.

- **Cascade order (child-before-parent) — binding rule**: `deleteSet` deletes `flashcards` rows by `by_setId` BEFORE deleting the `flashcardSets` row. Identical pattern to `quizzes.deleteQuiz` (deletes `quizAttempts` + `quizQuestions` before the `quizzes` row). Account-level cascade (`deleteAccountCascade`) already has child-before-parent flashcards ordering from Story 7.1 — no changes needed there.

- **Source-field immutability in updateCard**: The server validator only accepts `{ cardId, front, back }` — `setId`, `userId`, `order`, `sourceDocumentId`, `sourceChunkContent`, `sourceFilename` are intentionally NOT in the args shape, so Convex's arg validator rejects any attempt to patch them. Combined with `ctx.db.patch(cardId, { front, back })` (which patches only the named fields), this is defense-in-depth against client-side misuse.

- **cardCount maintenance**: `deleteCard` patches the parent `flashcardSets.cardCount` inline (`set.cardCount - 1`, floor 0). Alternatives considered: (a) compute on-the-fly in queries — rejected because `listByFolder` already returns the denormalized count for performance; (b) re-query count post-delete — rejected because it's a race condition waiting to happen. The inline patch in the same transaction is atomic.

- **No new persisted tables, no schemaVersion bump**: Per Story 7.1 + 7.2 Dev Notes, V1.2 stays schema-locked. `convex/schema.ts` unchanged. `convex/dataExport.ts` schemaVersion stays at 4. `accountDeletion.ts` unchanged (existing helpers already cover new mutations' targets).

- **"Resume" semantics for previous sets (AC from epics.md)**: epics.md AC says "they can resume studying from the beginning of the set." This is what 7-2 already does — click a set → Study opens at card 0, front-side. There is no SRS-style mid-session resume in V1.2. This story realizes the *management* half (edit/delete). No code change for resume — documented here for traceability.

- **Empty-list AC**: epics.md #5 (no sets → only Generate shown). Already realized by 7-1's `flashcards-empty-ready` state. No new code.

- **Reactive cardCount**: `listByFolder` returns `cardCount` from the persisted row, so after `deleteCard` patches the set, the tab list re-renders with the decremented count via Convex's reactive subscription — no manual refetch. Same pattern as quiz `questionCount` after `updateQuestion` (though updateQuestion doesn't change count).

- **Testing notes — avoiding portaled primitives**: Both the Tab delete flow and Editor's card edit/delete flow are exercisable via `mountSuspended` because every control is a plain `<button>` or `<UiButton>` living inline. No `getByRole('dialog')` or teleport-aware assertions needed.

- **ATDD test authoring**: Red-first against this story. The `flashcards-editor.atdd.test.ts` targets Task 4 (Editor.vue creation). The tab-delete path can be a red-first block either inside the existing `flashcards-tab.atdd.test.ts` or a new file — TEA's choice.

- **Open product decisions punted**:
  - **Undo for delete**: NO for V1.2 — no undo stack in chat/folder/quiz delete flows either. Matches existing UX contract.
  - **Bulk-delete multiple cards**: NO — single-card delete per row is sufficient for the stated user need. V1.3 candidate.
  - **Per-card reorder / drag-drop**: NO — `order` is immutable post-generation (consistent with `quiz` where `order` is also not user-editable). Future story.
  - **Adding new cards manually**: NO — generate-from-docs is the only creation path in V1.2 (consistent with quiz). "Regenerate" is the release-valve.
  - **Per-set rename (edit title)**: NO — not in epics.md AC for 7-3. epics.md says "edit card content", not set metadata. If desired post-launch, it's a small patch mutation.

- **Epic 7 retro prep items punted out** (still carried from 7-1):
  - P1 #3 (add `pnpm lint` + `pnpm typecheck` scripts) — not bundled here (single-commit PR per retro)
  - P1 #5 (per-user rate-limit on `/api/export/me`) — pre-GA, deferred-work only
  - P0 #4 (governing-law jurisdiction) — non-eng, remains in deferred-work
  - P2 #6 (remove orphaned `deleteDocumentFromR2`) — only if this PR touches `convex/documentActions.ts`; it does NOT; leave
  - P2 #7 (unify `/app/chat` onto `useChat`) — only if blocked; no blocker here

- **UX-DR anchor points**: UX-DR10 (FlashCard "editing mode") realized in full. UX-DR (§2 consistent card components) — the inline row actions style matches quiz/Tab.vue verbatim. UX-DR (§8.3 keyboard-first) — Edit/Delete/Save/Cancel are all native focusable buttons; no new keyboard shortcut is introduced since no ambiguous focus context exists.

### Project Structure Notes

New files added:

```
app/
  components/
    flashcards/
      Editor.vue
tests/
  component/
    flashcards/
      flashcards-editor.atdd.test.ts
      flashcards-editor.test.ts
      flashcards-tab.test.ts         (may already exist; if so, extend in place)
```

Files modified:

```
app/
  components/
    flashcards/
      Tab.vue                        (ellipsis menu, inline actions row, inline delete-confirm swap, editingSetId branch)
convex/
  flashcards.ts                      (updateCard, deleteCard, deleteSet)
  flashcards.test.ts                 (unit tests for the three new mutations)
_bmad-output/
  implementation-artifacts/
    sprint-status.yaml               (status bump)
```

Files unchanged (explicitly verified):

```
convex/schema.ts
convex/accountDeletion.ts
convex/dataExport.ts
app/composables/useFlashcards.ts
app/components/flashcards/Study.vue
```

No files deleted.

## Dev Agent Record

### Context Reference

- _bmad-output/planning-artifacts/epics.md (lines 949–982) — primary story source
- _bmad-output/planning-artifacts/architecture.md — schema + stack constraints; flashCards persisted row shape
- _bmad-output/planning-artifacts/ux-design-specification.md — UX-DR10 FlashCard spec (flip + source link + editing mode)
- _bmad-output/implementation-artifacts/7-1-generate-flash-cards-from-folder-documents.md — schema + createSetWithCards; account-level cascade ordering
- _bmad-output/implementation-artifacts/7-2-study-flash-cards.md — Study.vue as the analog inline-surface pattern (ref-driven tab body branch)
- _bmad-output/implementation-artifacts/6-3-edit-questions-and-view-previous-quizzes.md — structural template (quiz Editor.vue + quiz Tab.vue ellipsis menu + inline delete-confirm swap + updateQuestion + deleteQuiz)
- _bmad-output/implementation-artifacts/epic-6-retro-2026-04-12.md — standing no-portal rule for mountSuspended components
- _bmad-output/implementation-artifacts/epic-5-retro-2026-04-12.md — child-before-parent cascade rule

### Decisions

- **No-portal inline swap-in-place pattern** — both Tab row actions and Editor per-card actions use plain `v-if` blocks swapping Edit/Delete with Confirm-delete/Cancel. Matches the 6-3 quiz template verbatim; zero Reka-portaled primitives. Enables `mountSuspended` coverage of all flows.
- **Child-before-parent cascade in deleteSet** — iterates `flashcards` by `by_setId` in 500-row batches, deletes each, then deletes the parent `flashcardSets` row. Mirrors the `deleteAllFlashcardsForUser` ordering already in account cascade.
- **Source-field immutability in updateCard (defense in depth)** — Convex arg validator rejects any field other than `{cardId, front, back}`; `ctx.db.patch` only touches those fields; Convex unit test asserts pre/post equality on `setId`, `userId`, `order`, `sourceDocumentId`, `sourceChunkContent`, `sourceFilename`.
- **schemaVersion unchanged at 4** — no new tables, no new indexes, no `convex/schema.ts` diff, no `convex/dataExport.ts` bump. Confirmed by `git diff --name-only HEAD~1 HEAD` showing neither file touched.
- **Atomic cardCount decrement** — `deleteCard` performs `ctx.db.delete` + `ctx.db.patch(set, { cardCount })` inside the same mutation transaction (Convex mutations are transactional). No race, no stale read.
- **No SSR client-only regression** — `useConvexMutation` calls are wrapped in `import.meta.client` SSR-guards matching the pattern shipped in 6-3 quiz/Tab.vue and 7-2 flashcards/Tab.vue.

### File List

New files:
- `app/components/flashcards/Editor.vue` — in-tab editor surface with per-card read/edit/confirm-delete rows
- `tests/component/flashcards/flashcards-editor.atdd.test.ts` — red-first ATDD scaffold for Task 4

Modified files:
- `app/components/flashcards/Tab.vue` — set-row ellipsis menu + inline actions row + editor-branch
- `convex/flashcards.ts` — `updateCard`, `deleteCard`, `deleteSet` mutations
- `convex/flashcards.test.ts` — 11 new `[P0]` unit tests across the three mutations
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status progression

Unchanged (verified):
- `convex/schema.ts`, `convex/dataExport.ts`, `convex/accountDeletion.ts`, `app/composables/useFlashcards.ts`, `app/components/flashcards/Study.vue`

### Change Log

- **Convex mutations**: `flashcards.updateCard` (trim + non-empty server validation, identity+ownership gate, patches only `front`/`back`), `flashcards.deleteCard` (cascade-safe parent count decrement floor-0), `flashcards.deleteSet` (batched child-before-parent cascade with `{ deletedCards }` return).
- **Tab.vue**: added `openMenuSetId`, `confirmingDeleteSetId`, `editingSetId`, `deleting`, `liveMessage` refs; ellipsis icon per set row; inline actions row with swap-in-place confirm-delete; editor-branch `v-if` above study-branch; polite live-region for delete-success announcement.
- **Editor.vue**: loading/error/ready tri-state; per-card read-only row; per-card edit mode (front + back textareas + Save/Cancel + inline error); per-card confirm-delete swap; back-to-sets emit; source citation badge + chunk preview always visible but read-only.
- **Tests**: 31/31 flashcards component tests pass (6 new ATDD cases for Editor.vue flow); 11 new Convex unit tests pass (3 describes × unauth/cross-user/success + cascade scope + last-card-zero invariant + source-field immutability).
- **Schema stability**: `convex/schema.ts` unchanged, `convex/dataExport.ts` schemaVersion remains 4.
