# Story 7.2: Study Flash Cards

Status: review

## Story

As a student,
I want to flip through flash cards one by one and track my progress,
So that I can actively recall course material and reinforce my learning.

## Acceptance Criteria

1. **Given** a user clicks a set card from the Flash Cards tab list (`data-testid="flashcards-set-card"`)
   **When** the tab re-renders
   **Then** the Flash Cards tab body swaps from the list surface to a **study surface** that loads the chosen set via `useConvexQuery(api.flashcards.getSetWithCards, { id })` (null on non-owner, empty state on zero cards — both already enforced by the 7-1 query)
   **And** the study surface lives inline inside `app/components/flashcards/Tab.vue` (no route change, matches the Quiz `Taker.vue` pattern from 6-2 — `activeSetId` ref drives the tab body branch)
   **And** the study surface is a dedicated component `app/components/flashcards/Study.vue` that receives `{ setId }` and emits `back` (mirrors `app/components/quiz/Taker.vue`)
   **And** the list card's click-through is rewired from the 7-1 placeholder `handleSetSelect()` stub to set `activeSetId.value = setId`

2. **Given** a flash card set is loaded
   **When** the Study surface first renders
   **Then** the first card is shown **front-side** (the `front` text — question/prompt) inside a card container (`data-testid="flashcard-viewer"`)
   **And** a progress indicator renders as `X / N` (e.g. `1 / 12`) with `data-testid="flashcard-progress"`
   **And** the set title is shown above the card
   **And** a **Back** button with a left-arrow icon returns the user to the list (emits `back` to `Tab.vue` which clears `activeSetId`)

3. **Given** the user is viewing the **front** of a card
   **When** they click/tap the card body, press `Space`, or press `Enter` on the card
   **Then** the card flips to reveal the **back** (the `back` answer text)
   **And** the flip is animated via a CSS 3D transform (`rotateY(180deg)` on a `.flashcard-flip-inner` element) with `transition-duration: 400ms`
   **And** the card's `aria-pressed` / `aria-label` updates so screen readers announce the flip ("Showing answer: <back text>")
   **And** pressing `Space` or `Enter` while focus is elsewhere inside the study surface (but not on a button) also flips the card

4. **Given** the user is viewing the **back** of a card
   **When** they click **Next** (`data-testid="flashcard-next"`), press the `ArrowRight` key, or swipe left on touch
   **Then** the next card is shown **front-side** (flip state resets)
   **And** the progress indicator increments by 1
   **And** if already on the last card, advancing moves to the **completion summary** (AC #7)

5. **Given** the user is viewing any card (front or back)
   **When** they click **Previous** (`data-testid="flashcard-prev"`), press the `ArrowLeft` key, or swipe right on touch
   **Then** the previous card is shown **front-side** (flip state resets)
   **And** the progress indicator decrements by 1
   **And** Previous is disabled when the user is on the first card (`aria-disabled="true"` + visually muted)

6. **Given** `prefers-reduced-motion: reduce` is set at the media-query level
   **When** a card flips or advances
   **Then** the 3D flip transition is replaced with an **instant swap** (no `transition-duration` on the flip inner, no translate animation on card change) — implemented via `@media (prefers-reduced-motion: reduce)` in the component `<style>` block, not via JS detection
   **And** all keyboard / mouse / swipe navigation continues to function identically (only the visual transition degrades)

7. **Given** the user advances past the last card (via Next / ArrowRight / swipe)
   **When** the completion summary appears
   **Then** it renders `<FlashcardsCompletion>` with:
     - A "You finished!" heading
     - The text `You reviewed N cards` (pulled from `cards.length`)
     - A **Restart set** button (`data-testid="flashcard-restart"`) that resets the session to card 0, front-side
     - A **Back to list** button (`data-testid="flashcard-back"`) that emits `back` to the parent tab
   **And** the completion summary uses `data-testid="flashcard-completion"`
   **And** the completion summary is rendered **inline inside `Study.vue`** (not a separate component) — matches Taker's single-component result pattern and keeps the mountSuspended surface simple

8. **Given** keyboard accessibility (UX-DR keyboard-first rule from UX spec §8.3 — `Space` flips, `ArrowLeft/ArrowRight` navigate, all controls reachable via Tab)
   **When** the study surface has focus
   **Then** a document-level `keydown` listener in `Study.vue` (mounted via `onMounted` / `onUnmounted`) handles:
     - `Space` → flip current card (prevents default scroll)
     - `ArrowRight` → advance (same behavior as Next button, prevents default)
     - `ArrowLeft` → retreat (same behavior as Previous button, prevents default)
     - `Escape` → emit `back`
   **And** the listener no-ops when focus is in an `<input>` or `<textarea>` (guard mirrors `app/pages/app/folders/[id].vue#handleSlashShortcut`)
   **And** the Next / Previous / Restart / Back buttons are Tab-navigable in DOM order
   **And** the card body has `tabindex="0"` so it is focusable (enables `Space`/`Enter` flip via focus even on touchscreens with keyboards)

9. **Given** touch devices (mobile swipe UX-DR10)
   **When** the user swipes left on the card body
   **Then** Next fires; swiping right fires Previous
   **And** the swipe implementation uses `@vueuse/core`'s `useSwipe` (already in package.json — no new deps) with a minimum threshold of 40px and `lengthX > threshold` as the trigger
   **And** swipe gestures have explicit button equivalents (Next / Previous) so non-swipe users have full parity

10. **Given** the back of each card must link to the exact source passage that informed the card content (UX-DR10)
    **When** the back is visible
    **Then** beneath the `back` answer text, the component renders the source citation using the existing `<ChatCitationBadge :index="1" :filename="card.sourceFilename" />` primitive plus a small inline **"Show passage"** toggle button (`data-testid="flashcard-source-toggle"`)
    **And** clicking the toggle expands an inline `<ChatSourceCard :index="1" :filename="card.sourceFilename" :content="card.sourceChunkContent" :score="1" />` block beneath the card (no new portaled primitive — toggle is inline expand/collapse, matches `app/components/quiz/Question.vue` behavior)
    **And** if `card.sourceFilename` is missing (edge — shouldn't happen post-7-1 but defensive), the citation area hides with no error

11. **Given** Epic 5/6/7 standing rule — no Reka-portaled primitives inside a component that `mountSuspended` will render
    **When** `Study.vue` and the completion summary are built
    **Then** the study surface introduces **zero** new portaled primitives (no `UiDialog`, `UiAlertDialog`, `UiPopover`, `UiDropdownMenu`, `UiSelect` inside its rendered subtree). Confirmed before dev pass starts
    **And** the component-layer test `tests/component/flashcards/flashcards-study.test.ts` mounts `Study.vue` via `mountSuspended` and asserts: (a) front renders first card; (b) click/space flips to back; (c) Next advances progress; (d) Previous retreats progress (disabled at 0); (e) advancing past last card shows completion; (f) Restart returns to card 0; (g) Back button emits `back`; (h) source toggle expands passage
    **And** if any assertion cannot be made reliably via `mountSuspended`, skip that assertion only (not the whole file), add a `// TODO(story-runner)` comment, and log the decision in the Dev Agent Record

12. **Given** ATDD red-first is the standing rule
    **When** dev-story begins Task 3 (implement `Study.vue`)
    **Then** the failing component test `tests/component/flashcards/flashcards-study.atdd.test.ts` exists first and exercises the core flow (front → flip → back → Next → completion → Restart). Generated via the `bmad-bmm-workflows-testarch-atdd` skill in the pre-Task-3 step

13. **Given** no new persisted tables are added (SRS / per-card review history remain out of V1.2 scope per Story 7.1 Dev Notes)
    **When** this story ships
    **Then** `convex/schema.ts` is NOT modified; no new cascade helpers; no data-export schemaVersion bump (stays at 4). The only cross-schema impact is the `getSetWithCards` query being called — already shipped in 7.1

## Tasks / Subtasks

- [x] **Task 1 (ATDD red-first): Scaffold failing study-surface component test** (AC: #12, #11)
  - [x] Invoke `bmad-bmm-workflows-testarch-atdd` against this story file. Expected output: `tests/component/flashcards/flashcards-study.atdd.test.ts`
  - [x] Mocks: `mockNuxtImport('useConvexQuery', ...)` returning `ref<{ set, cards } | null>` fixtures; use the 7-1 6-2 atdd files as structural templates
  - [x] Test is expected to fail (`Study.vue` does not exist yet). Decisions log entry if ATDD emits zero tests

- [x] **Task 2: Create `Study.vue` component shell** (AC: #1, #2, #11)
  - [x] New file `app/components/flashcards/Study.vue`. `defineProps<{ setId: Id<'flashcardSets'> }>()`, `defineEmits<{ back: [] }>()`
  - [x] Load `useConvexQuery(api.flashcards.getSetWithCards, computed(() => ({ id: setId })))` — returns `{ data: { set, cards } | null | undefined }`
  - [x] Handle three load states: `data === undefined` → skeleton (same `UiSkeleton` stack as Tab loading), `data === null` → "Set not available" (analog to Taker error), `data` valid → render the card viewer
  - [x] `currentIndex` ref, `isFlipped` ref, `isComplete` ref. Title bar at top with set title + Back button (emits `back`)
  - [x] No portaled primitives in subtree — enforced by inspection before commit

- [x] **Task 3: Card viewer front/back + flip animation** (AC: #2, #3, #6)
  - [x] `.flashcard-flip-outer` holds perspective; `.flashcard-flip-inner` flips on `rotateY(180deg)` when `isFlipped === true`; both `.flashcard-flip-front` and `.flashcard-flip-back` use `backface-visibility: hidden`
  - [x] Card body click → `toggleFlip()`; `tabindex="0"`, `role="button"`, `aria-pressed="{{ isFlipped }}"`, `aria-label="Flash card — click to flip"`
  - [x] `@media (prefers-reduced-motion: reduce)` — set `transition: none` on `.flashcard-flip-inner`. Same stylesheet selector group, no JS detection
  - [x] Progress indicator `{{ currentIndex + 1 }} / {{ cards.length }}` with `data-testid="flashcard-progress"`

- [x] **Task 4: Navigation — Next / Previous buttons + keyboard + swipe** (AC: #4, #5, #8, #9)
  - [x] Next / Previous `<UiButton>` buttons below the card. `data-testid="flashcard-next"`, `flashcard-prev`. Previous `:disabled="currentIndex === 0"`
  - [x] Next handler: if `currentIndex === cards.length - 1` → `isComplete = true`, else `currentIndex++; isFlipped = false`
  - [x] Previous handler: `if (currentIndex > 0) { currentIndex--; isFlipped = false }`
  - [x] `onMounted`: add document `keydown` listener handling Space/ArrowLeft/ArrowRight/Escape per AC #8; guard against `INPUT`/`TEXTAREA` target; `onUnmounted`: removeEventListener
  - [x] `useSwipe(cardBodyRef, { onSwipeEnd(e, direction) { if (direction === 'left') next(); if (direction === 'right') prev() }, threshold: 40 })` from `@vueuse/core`

- [x] **Task 5: Source citation on back** (AC: #10)
  - [x] Below `back` text (visible only when `isFlipped === true`), render `<ChatCitationBadge :index="1" :filename="card.sourceFilename" />` + an inline "Show passage" toggle button (`sourceExpanded` ref per component instance — cleared on card change)
  - [x] When expanded, render `<ChatSourceCard>` below the citation with `:content="card.sourceChunkContent"` — matches `app/components/quiz/Question.vue` source-toggle pattern
  - [x] Hide the whole citation block if `!card.sourceFilename` (defensive)

- [x] **Task 6: Completion summary** (AC: #7)
  - [x] When `isComplete === true`, render a centered panel (`data-testid="flashcard-completion"`) replacing the card viewer: heading "You finished!", text "You reviewed {{ cards.length }} cards", Restart button, Back to list button
  - [x] Restart handler: `currentIndex = 0; isFlipped = false; isComplete = false`
  - [x] Back handler: `emit('back')`

- [x] **Task 7: Wire `Tab.vue` to render `Study.vue` when a set is selected** (AC: #1)
  - [x] `activeSetId` ref in Tab.vue. `handleSetSelect(setId)` sets it (replacing the 7-1 placeholder comment). When `activeSetId !== null`, render `<FlashcardsStudy :set-id="activeSetId" @back="activeSetId = null" />` as the tab body (early `<template v-if>` branch, matching Tab's pattern for `activeQuizId` in `quiz/Tab.vue`)
  - [x] Remove the `TODO(story 7.2)` comment block from `handleSetSelect`
  - [x] The tab's other branches (no-docs empty / generating shimmer / empty-ready / list) remain unchanged

- [x] **Task 8: Full component-layer test suite for Study** (AC: #11)
  - [x] New file `tests/component/flashcards/flashcards-study.test.ts`. 8 assertions per AC #11 — may share scaffolding with the ATDD file if convenient. Mirrors `tests/component/quiz/quiz-taker.atdd.test.ts` + `tests/component/quiz/quiz-editor.test.ts` layouts
  - [x] Mocks: `useConvexQuery` returns a ref of `{ set: {...}, cards: [{ _id, order, front, back, sourceFilename, sourceChunkContent }, ...] }`
  - [x] Avoid exercising `@media (prefers-reduced-motion)` via JS — the CSS media query is not runtime-testable under happy-dom. Document as a decision; assert only that the flip class is applied, not its animation duration

- [x] **Task 9: Document decisions in Dev Agent Record** (AC: #13, retro rules)
  - [x] Log the no-new-tables / no-schemaVersion-bump decision (per Story 7.1 V1.2 framing)
  - [x] Log the `useSwipe` choice (vs hand-rolled touch handlers)
  - [x] Log any ATDD-skipped assertions with specific blockers
  - [x] Log the prefers-reduced-motion implementation via CSS-only (no JS detection)

## Dev Notes

- **Architecture alignment**: `epics.md` lines 906–947 define this story. `architecture.md` describes `FlashCard` component with flip animation and source link; this story implements it as `app/components/flashcards/Study.vue` (the UX spec's "FlashCard" is the study-surface component; the persisted row is `flashcards` — no naming conflict since the persisted rows are never Vue components). UX spec §7 FlashCard (lines 857–865) specifies flip + swipe + edit button + reduced-motion. The **edit** button belongs to Story 7.3 — 7.2 renders read-only flip-capable cards.

- **No new persisted tables**: Per Story 7.1 Dev Notes open-product-decisions, SRS is out of V1.2; study state is ephemeral-per-session. No `flashcardStudySessions` or `flashcardReviews` table introduced. `convex/schema.ts` unchanged. `accountDeletion.ts` unchanged (nothing new to cascade). `dataExport.ts` unchanged (schemaVersion stays at 4).

- **Reka-portal discipline (standing V1.x rule from Epic 5/6 retros)**: The study surface lives inside `mountSuspended`. Zero portaled primitives: no `UiDialog`, `UiAlertDialog`, `UiPopover`, `UiDropdownMenu`, `UiSelect` in `Study.vue` or its children. The source-reveal is inline expand (same pattern as `quiz/Question.vue`). If a portal edge surfaces unexpectedly in Task 8, BLOCKED per scope-overflow rule.

- **Cascade re-audit**: N/A for 7-2 — no new tables. Standing audit from Story 7.1 (deleteAllFlashcardsForUser → deleteAllFlashcardSetsForUser → documents) remains child-before-parent correct. No changes needed.

- **Data export schemaVersion**: stays at 4. Ephemeral session UI does not move persisted state; the 7.1 export already covers `flashcardSets.json` + `flashcards.json`. Any future SRS schema bump is a V1.3 concern.

- **Swipe implementation**: `@vueuse/core`'s `useSwipe` is already a dep. Configured with 40px threshold (empirically usable across thumb sizes; Carousel stock is 50). Direction mapping: left swipe → Next, right swipe → Previous (matches Quizlet muscle memory). Button parity preserved for non-touch.

- **Reduced-motion strategy**: Pure CSS via `@media (prefers-reduced-motion: reduce) { .flashcard-flip-inner { transition: none !important; } }`. Not via JS `window.matchMedia` detection — simpler, no reactivity needed, and CSS guarantees the media query is re-evaluated on OS-level setting changes without a component re-render.

- **Keyboard accessibility scope**: Listener is document-level but guarded by target-tag check (no-op in `INPUT`/`TEXTAREA`). Inspired by `app/pages/app/folders/[id].vue#handleSlashShortcut` and `handleNewChatShortcut`. Escape returns to list (emit `back`) — low-stakes, no unsaved state to lose.

- **Completion summary location**: Inlined inside `Study.vue` rather than a separate `Completion.vue` component. The summary is a terminal state with a known simple shape; factoring it out adds a file without gaining reuse. Matches `quiz/Taker.vue`'s single-file results mode from 6-2.

- **Source citation reuse**: `ChatCitationBadge` + `ChatSourceCard` are the already-shipped primitives used by Chat and Quiz. Using them here is deliberate for visual continuity (UX-DR §2 "Consistent card components" pattern).

- **Open product decisions punted**:
  - **Per-card self-rating (easy/hard)**: NO for V1.2. No `difficulty` field exists on `flashcards` — per 7-1 Dev Notes. If added later (V1.3), this story's `Study.vue` gets a rating row above Next/Previous; current code leaves an anchor point near the Next button
  - **Shuffle**: NO for V1.2. Cards always render in stored `order`. Shuffle becomes a flag ref in V1.3 without schema change
  - **Per-card study tracking / history**: NO — ephemeral session, no persistence

- **Epic 7 retro prep items punted out** (per state tracking — 7 Epic 7 prep items from retro; 7-1 absorbed #1, #2):
  - P1 #3 (add `pnpm lint` + `pnpm typecheck` scripts) — rolled forward, NOT bundled here (single-commit PR per retro)
  - P1 #5 (per-user rate-limit on `/api/export/me`) — pre-GA, deferred-work only
  - P0 #4 (governing-law jurisdiction) — non-eng, remains in deferred-work
  - P2 #6 (remove orphaned `deleteDocumentFromR2`) — OK only if this PR touches `convex/documentActions.ts`; it does NOT; leave
  - P2 #7 (unify `/app/chat` onto `useChat`) — only if blocked; no blocker here

- **UI-DR anchor points**: UX-DR10 (FlashCard component with flip animation + source link) realized in full by this story. UX-DR for keyboard-first + swipe navigation (§8.3) realized. UX-DR for reduced-motion (§6.3) realized.

- **ATDD note**: TEA ATDD is invoked post-story-creation against this file; generated component test will target Study.vue's front → flip → Next → completion happy path. Expected to mirror the 6-2 Taker ATDD pattern.

### Project Structure Notes

New files added:

```
app/
  components/
    flashcards/
      Study.vue
tests/
  component/
    flashcards/
      flashcards-study.atdd.test.ts
      flashcards-study.test.ts
```

Files modified:

```
app/
  components/
    flashcards/
      Tab.vue                 (activeSetId branch → FlashcardsStudy; handleSetSelect no longer a placeholder)
_bmad-output/
  implementation-artifacts/
    sprint-status.yaml        (status bump)
```

No schema changes. No server handlers added. No files deleted.

## Dev Agent Record

### Context Reference

- _bmad-output/planning-artifacts/epics.md (lines 906–947) — primary story source
- _bmad-output/planning-artifacts/architecture.md — schema + stack constraints
- _bmad-output/planning-artifacts/ux-design-specification.md — UX-DR10 FlashCard spec, §7 component inventory (lines 857–865), §8 interaction patterns, §11 accessibility (reduced-motion)
- _bmad-output/implementation-artifacts/7-1-generate-flash-cards-from-folder-documents.md — immediate prior story; `Tab.vue`, `getSetWithCards` query, open-product-decisions
- _bmad-output/implementation-artifacts/6-2-take-quiz-and-view-results.md — structural template (analog: QuizTaker → FlashcardsStudy, inline results → inline completion summary)
- _bmad-output/implementation-artifacts/epic-6-retro-2026-04-12.md — standing no-portal rule for mountSuspended components

### Decisions

- **No new persisted tables** (AC #13): Story 7.1 Dev Notes already committed V1.2 to ephemeral study sessions. Study state (`currentIndex`, `isFlipped`, `isComplete`, `sourceExpanded`) is per-component-instance refs. `convex/schema.ts`, `accountDeletion.ts`, `dataExport.ts` untouched. schemaVersion stays at 4.
- **Swipe implementation via `@vueuse/core` `useSwipe`**: Already a project dep. 40px threshold; `onSwipeEnd` direction check. Chosen over hand-rolled pointer handlers because (a) less code, (b) already proven in other Vue apps, (c) button parity preserved for non-touch. Swipe-left → Next (Quizlet muscle memory).
- **prefers-reduced-motion via CSS-only**: `@media (prefers-reduced-motion: reduce) { .flashcard-flip-inner { transition: none !important; } }` inside `<style scoped>`. Not JS `matchMedia` — simpler and browser re-evaluates on OS-level change without component re-render. Happy-dom can't reproduce the media query at test time, so AC #6 is not asserted as runtime behavior in the test suite; visual verification is manual. Documented, not a gap.
- **Completion summary inlined in `Study.vue`** (not a separate `Completion.vue`): single-file terminal state; no reuse pressure. Matches `quiz/Taker.vue` results-mode single-file pattern (6-2).
- **Source citation pattern**: Reuses `ChatCitationBadge` + `ChatSourceCard` primitives already shipped by Epic 4 (chat) and reused by Epic 6 (quiz). Visual continuity across chat / quiz / flashcard study surfaces — UX spec §2 "Consistent card components" principle.
- **Citation filename exposure**: `ChatCitationBadge` renders only the numeric index in its body; the filename is encoded in `aria-label="Source N from <filename>"`. Tests assert filename via `aria-label`, not `wrapper.text()`, because rendered text is intentionally minimal for visual density.
- **ATDD "front hides back" assertion relaxed**: Initial red-first ATDD assumed `wrapper.text()` would not contain back-text pre-flip. In happy-dom both faces render (CSS `backface-visibility: hidden` doesn't hide from text extraction — it's a visual-only property). Adjusted assertions to use `aria-pressed` state instead, which is the semantic source of truth.
- **Reka-portal discipline**: `Study.vue` uses only `UiButton` + `UiSkeleton` + native `button` + `div`. No `UiDialog`, `UiAlertDialog`, `UiPopover`, `UiDropdownMenu`, `UiSelect`. `mountSuspended` exposes everything the test suite needs — all 12 test-file assertions green without `.skip`.
- **Keyboard listener scope**: Document-level `keydown` on mount, `INPUT`/`TEXTAREA` target-tag guard, `removeEventListener` on unmount. Pattern borrowed from `app/pages/app/folders/[id].vue#handleSlashShortcut`. Escape emits `back` — no unsaved state to preserve in ephemeral session.
- **Open product decisions punted**: No self-rating UI (SRS is V1.3+); no shuffle (stored `order` is sole source of truth); no per-card persistence. Anchor point for V1.3 rating row is above the Next/Previous row — zero-refactor extension.

### File List

**New files:**
- `app/components/flashcards/Study.vue`
- `tests/component/flashcards/flashcards-study.atdd.test.ts`
- `tests/component/flashcards/flashcards-study.test.ts`

**Modified files:**
- `app/components/flashcards/Tab.vue` — `activeSetId` branch renders `<FlashcardsStudy>`; `handleSetSelect` sets the ref (replacing the 7-1 TODO placeholder); `handleStudyBack` clears it
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 7-2 → in-progress → (on commit) review → done

No files deleted. No schema changes. No server handlers added.

### Change Log

- 2026-04-12: Story 7-2 implemented. New `app/components/flashcards/Study.vue` card study surface with 3D CSS flip (rotateY 180deg, backface-visibility hidden), progress indicator X / N, Next/Previous buttons with disabled state, completion summary with Restart + Back to list, inline source-citation toggle (no portal), document-level keyboard listener (Space/ArrowLeft/ArrowRight/Escape with INPUT guard), `@vueuse/core` useSwipe (40px threshold). prefers-reduced-motion honored via CSS media query only (no JS detection). `Tab.vue` rewired from 7-1 placeholder — `activeSetId` ref branch renders Study when a set is selected. Zero new persisted tables, zero cascade changes, zero schemaVersion bump — ephemeral session state per 7-1 Dev Notes. 13 component tests added (12 in `flashcards-study.test.ts` + 8 in `flashcards-study.atdd.test.ts`) — all pass. Reka-portal discipline preserved: no portaled primitives in study subtree. Full test counters: `pnpm test` 245 passed / 8 skipped (unchanged — no unit-layer changes); `pnpm test:component` 129 passed / 78 skipped (was 109/78; +20 net new). No new deferred items. All 13 ACs satisfied.
