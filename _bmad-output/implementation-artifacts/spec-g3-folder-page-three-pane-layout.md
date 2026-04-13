---
title: 'G3 — Folder page 3-pane resizable layout'
type: 'feature'
created: '2026-04-13'
status: 'ready-for-dev'
context:
  - DESIGN.md
  - _bmad-output/implementation-artifacts/design-screens/g3-folder-page-three-pane-layout.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The folder page is a single column where Tabs span the full width and the citations panel slides over the chat. There is no spatial separation between folder context, primary work, and citations — and no room for the future Knowledge tree (G4) without further redesign.

**Approach:** Refactor `app/pages/app/folders/[id].vue` into a 3-pane resizable shell to the right of the existing 56px Atlas rail: Pane A (folder context, ~240px), Pane B (primary tabs, flex-1), Pane C (helper / citations, ~360px, hidden by default). Citations land in Pane C instead of overlaying. A flip-toggle (visible only when Helper is open) swaps Pane B ↔ Pane C order. Pane sizes, helperOpen, and flipped persist per-folder in `localStorage`.

## Boundaries & Constraints

**Always:**
- Use existing `UiResizablePanelGroup` / `UiResizablePanel` / `UiResizableHandle` (Reka Splitter). No new resize lib.
- Stay strictly inside Warm Focus tokens (DESIGN.md). No new colors, fonts, radii.
- Pane A min 200px, Pane B min 400px, Pane C min 280px.
- Defaults: paneA=240, paneB=flex, paneC=360, helperOpen=false, flipped=false.
- Flip toggle is rendered only when `helperOpen === true`.
- Source cards in Pane C are collapsible: snippet visible by default; expand reveals additional passages.
- Persistence is per-folder (`localStorage` key `budds:folder-layout:<folderId>`), SSR-safe (skip on server), debounced 250ms.
- Helper pane stays open across tab switches (Chat → Flashcards etc.) — only the user closes it.
- Mobile (`<768px`) keeps the existing inline citation-expand behavior (no Pane C).

**Ask First:**
- Any change to folder route URL or query params (currently `?conversationId=…&tab=…`).
- Adding a server-side persisted layout (current scope is localStorage-only).
- Replacing `ChatSourcePanel` with a different component (this spec hoists it, it does not rewrite it).

**Never:**
- No Knowledge tree implementation (G4 placeholder card only).
- No Members entry, no subfolder tree.
- No animation work beyond Tailwind defaults.
- No `pnpm build` while component tests run (mutates `.nuxt/`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First visit to folder, desktop | No localStorage entry | A=240, B=flex, C=hidden, flipped=false | N/A |
| Resize Pane A to 300px, reload | Stored `{paneA:300, ...}` | A renders at 300px on mount | If JSON parse fails: fall back to defaults, do not throw |
| Click inline `[1]` on desktop | Helper closed | Helper opens, scrolls to source 1, flip toggle becomes visible | N/A |
| Click X inside Pane C | Helper open | Helper closes, B re-fills, flip toggle hides | N/A |
| Click flip toggle | Helper open, flipped=false | Pane B and Pane C swap order; persisted | N/A |
| Switch tab Chat→Flashcards | Helper open | Helper stays open with prior sources | N/A |
| Visit a different folder | Different `folderId` | Loads that folder's layout, not the previous | N/A |
| Click `[1]` on mobile (`<768px`) | Helper N/A | Existing inline citation-expand fires | N/A |
| Tablet (768–1023px) | Helper opens | Pane C overlays as a right sheet (not splitter pane) | N/A |
| Source card collapse toggle | Card expanded | Hides extra passages, snippet remains | N/A |

</frozen-after-approval>

## Code Map

- `app/pages/app/folders/[id].vue` -- refactor: wrap content in `<UiResizablePanelGroup direction="horizontal">` with three `<UiResizablePanel>`s (A/B/C). Hoist current Tabs into Pane B. Hoist `ChatSourcePanel` into Pane C. Add flip-toggle button + Sources button to Pane B header. Wire `useFolderLayout(folderId)` for sizes/helperOpen/flipped/setSize/toggle/flip. Keep mobile branch using existing `expandedInlineCitation` flow.
- `app/components/folders/FolderContextPane.vue` -- NEW. Props: `folder`, `folderAncestors`. Renders folder badge + name (DM Sans 700 18px) + breadcrumb + ellipsis menu (Edit / New subfolder / Delete) + a `Knowledge tree (G4)` placeholder card with three muted skeleton rows.
- `app/components/folders/FolderHelperPane.vue` -- NEW. Props: `sources`, `activeIndex`. Renders "Sources" header + X close emit. Each source card uses local `expanded` ref: snippet always visible; chevron toggles extra passages. Uses existing `ChatSourcePanel` source-card markup or extracts a small `FolderHelperSourceCard.vue` if cleaner.
- `app/composables/useFolderLayout.ts` -- NEW. Returns `{ paneA, paneB, paneC, helperOpen, flipped, setSizes, openHelper, closeHelper, flip }`. SSR-safe (`import.meta.client` guard). Debounced (250ms) `localStorage` writes. Keyed by `budds:folder-layout:<folderId>`. Reactive — recomputes on `folderId` change.
- `tests/component/folders/folder-three-pane.test.ts` -- NEW. Covers I/O matrix entries: defaults on first visit, persisted sizes load on remount, flip swaps panel order, helper toggle hide/show, per-folder isolation (different folderId → different layout), graceful fallback on bad JSON.
- `tests/unit/composables/use-folder-layout.test.ts` -- NEW. Pure-logic tests for the composable: defaults, set/persist, reset on folderId change, SSR no-op.

## Tasks & Acceptance

**Execution:**
- [ ] `app/composables/useFolderLayout.ts` -- create composable with reactive state + debounced persistence -- foundation other files depend on
- [ ] `app/components/folders/FolderContextPane.vue` -- build Pane A component -- isolates left-pane markup before page refactor
- [ ] `app/components/folders/FolderHelperPane.vue` -- build Pane C wrapper with collapsible source cards -- isolates right-pane behavior
- [ ] `app/pages/app/folders/[id].vue` -- refactor template into `UiResizablePanelGroup` shell with three panes; add flip-toggle (only when helperOpen) and Sources button to Pane B header; wire composable -- delivers the layout
- [ ] `tests/unit/composables/use-folder-layout.test.ts` -- composable unit tests -- locks persistence/SSR contract
- [ ] `tests/component/folders/folder-three-pane.test.ts` -- component tests covering defaults, flip, toggle, per-folder load, fallback -- locks I/O matrix

**Acceptance Criteria:**
- Given a desktop user (`>=1024px`) lands on `/app/folders/<id>` for the first time, when the page renders, then Pane A is ~240px, Pane B fills the remainder, Pane C is hidden, and the flip toggle is not rendered.
- Given the user resizes Pane A to 300px, when they reload the same folder, then Pane A renders at 300px (loaded from localStorage).
- Given the user clicks inline citation `[1]` on desktop, when Pane C is closed, then Pane C opens, scrolls to source 1, and the flip toggle becomes visible.
- Given the user clicks the flip toggle with Helper open, when the click resolves, then Pane B and Pane C swap positions and the new order is persisted.
- Given the user is in folder A with a custom layout, when they navigate to folder B, then folder B uses defaults (or its own stored layout) — folder A's layout is not applied.
- Given tablet width (768–1023px), when Helper opens, then Pane C renders as an overlay sheet on the right, not a splitter pane.
- Given mobile width (`<768px`), when the user clicks an inline citation, then the existing inline-expand behavior fires (no Pane C).
- Given a source card is collapsed, when the user clicks its expand chevron, then additional passages become visible while the snippet remains.
- Given malformed JSON in `localStorage`, when the page loads, then defaults are used and no error is thrown.

## Spec Change Log

<!-- Empty until first review loopback. -->

## Design Notes

Helper pane is intentionally **closed by default**. Opening is user-driven (citation click or `Sources` button). Flip toggle hides when Helper is closed because flipping a hidden pane is meaningless and clutters the header.

`useFolderLayout` should expose individual size refs (not a single object) so `<UiResizablePanel :default-size="paneA">` is reactive without a wrapper. Persist via `watch([paneA, paneB, paneC, helperOpen, flipped], debouncedSave)`.

Pane order in DOM: always `[A, handle, B, handle, C]`. The flip is implemented by swapping the *rendered content* of B and C (not their DOM positions). This avoids resize-handle re-binding bugs and keeps the Reka Splitter group stable.

Source-card collapse: each card owns local `expanded` state — no need to lift into the composable. Snippet (the single excerpt currently shown) is always visible; expansion reveals any additional `passages[]` from the source, falling back to a "no further excerpts" caption if empty.

## Verification

**Commands:**
- `pnpm test:component tests/component/folders/folder-three-pane.test.ts` -- expected: all tests pass
- `pnpm test tests/unit/composables/use-folder-layout.test.ts` -- expected: all tests pass
- `pnpm test:component` -- expected: no NEW failures vs. baseline (7 pre-existing failures noted in `deferred-work.md` may persist)

**Manual checks:**
- Desktop ≥1024: open folder, verify A=240/B=flex/C=hidden; click `[1]` → C opens; resize A → reload → size restored; flip → B/C swap; switch tab → C stays open; close C → flip toggle hides.
- Tablet 768–1023: click citation → C overlays as right sheet.
- Mobile <768: click citation → inline expand (no Pane C).
- Visit folder A → resize → visit folder B → confirm B has its own (default) layout.
