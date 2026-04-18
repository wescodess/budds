---
title: 'Audio Overview Phase 5A.2 — unified 2-pane UI + Customize scope section + chat-input chip'
type: 'feature'
created: '2026-04-18'
status: 'ready-for-dev'
context:
  - 'roadmap-chat-podcast-unification.md'
  - 'spec-audio-overview-phase-5a-foundation.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Phase 5A landed the data foundation (scope persistence, preferredMainPane, mobile route) but the folder page still renders Chat and Audio Overview as separate tabs. Users can't listen + chat side-by-side, and the chat input / Customize dialog don't yet show or consume the persisted `folders.referenceScope`.

**Approach:** Collapse the Chat + Audio Overview tabs into a single **Conversation** tab that hosts a resizable 2-pane surface (Chat + Podcast). Pane orientation driven by `folders.preferredMainPane`; flip reuses G3's existing handle. Helper pane gets a small **Podcast | Sources** tab row — Podcast default; citation clicks auto-switch to Sources. Chat input replaces its ephemeral `useReferenceScope()` with the persisted `useFolderReferenceScope`. Customize dialog gains a Scope section (collapsed default = "Using folder default · N docs"; Override expands an inline `DirectoryPicker` the generation submits as an ephemeral `scopeDocIds` override). Empty-scope "No documents yet" card renders in the picker dropdown when the folder has zero indexed docs.

## Boundaries & Constraints

**Always:**
- The Chat tab and the Audio Overview tab MUST collapse into a single tab (keep URL `?tab=chat` for backward compat; `?tab=audio-overview` triggers a one-time router.replace to `?tab=chat` and ensures `preferredMainPane='podcast'`). Flashcards / Quiz / Documents tabs stay unchanged.
- New `UnifiedConversationPane.vue` renders the 2-pane layout on desktop using the existing `ResizablePanelGroup` + `ResizableHandle` + `ArrowLeftRight` flip handle (extend G3's existing `sourcePanelSide` persistence). On mobile, the component collapses to chat full-screen; podcast lives in the sticky mini-player (Phase 2 infra).
- Helper pane content switcher (`UnifiedHelperPaneTabs.vue`): two small tabs at the top of the helper — `Podcast` (default) and `Sources`. Citation clicks in chat auto-set helper to `Sources`. User can toggle back to `Podcast`. Persisted per-folder via an existing localStorage slot (or `sessionStorage` for now — decision inside).
- Chat input MUST accept a persisted scope via `useFolderReferenceScope` (foundation composable from 5A). Empty scope = "All docs · folder + subfolders" chip. Narrowed = "N of M docs" amber chip. Scope chip's menu shows a folder-tree picker (reuses `DirectoryPicker`). Empty-folder state: "No documents yet" card with "Go to Documents tab" CTA.
- `AudioOverviewCustomize.vue` gains a **Scope** section at the top. Collapsed default: "Using folder default · N docs" + Override ghost button. Override: expands an inline picker bound to an ephemeral `useReferenceScope` that clones the folder scope as a starting point. Submit includes resolved `scopeDocIds` only when override is active; otherwise the Shell resolves folder scope + passes to the server.
- Flip is purely visual. Audio never pauses.
- No schema changes. No server route changes. Pure UI + wiring.

**Ask First:**
- Any schema change (none expected).
- Any server route change (none expected).
- Any cascade behavior on `folders.referenceScope` deletion/archive of docs.

**Never:**
- No data migration in 5A.2 (multi-chat archive is 5C).
- No ask-via-chat flow (5B).
- No regen scope intersection (5C).
- No PR targeting `main`. No Claude attribution. No `--no-verify`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Land on folder with `preferredMainPane=chat` | First visit after 5A | Chat main + Podcast helper | — |
| Land on folder with `preferredMainPane=podcast` | User created Podcast void | Podcast main + Chat helper | — |
| Land on folder with preferredMainPane undefined | Legacy folder | Defaults to chat-main | — |
| Flip panes | User clicks flip handle | Chat ↔ Podcast swap; audio keeps playing | — |
| Click citation in chat | `[1]` chip clicked | Helper auto-switches to Sources; citation focused | — |
| Chat input scope chip click | Empty folder scope | Dropdown opens with full directory tree + "Select all" | — |
| Chat input scope chip click | Narrowed scope | Dropdown pre-filled with current selection; amber "Clear" button active | — |
| Chat input scope chip click | Folder has 0 indexed docs | Dropdown shows "No documents yet" card instead of tree | — |
| Customize dialog open | Folder scope default | Scope row shows "Using folder default · N docs" + Override button | — |
| Customize Override toggle | User clicks Override | Inline picker expands; "Cancel override" revert link | — |
| Customize submit with override | Override active | Generate POST includes `scopeDocIds` = override's resolved docs | folder.referenceScope NOT modified |
| Customize submit without override | Override inactive | Generate POST includes `scopeDocIds` = folder scope's resolved docs | — |
| Visit `?tab=audio-overview` legacy URL | Old bookmark | `router.replace({tab:'chat'})` + `setPreferredMainPane('podcast')` | — |
| Mobile viewport (<768px) | Any load | Chat full-screen; sticky mini-player at bottom; no flip handle | — |

</frozen-after-approval>

## Code Map

**New:**
- `app/components/folder-shell/UnifiedConversationPane.vue` — renders the 2-pane layout (desktop) or chat full-screen (mobile). Accepts `folderId`, `activeConversationId`, plus slotted children for Chat content and Podcast content. Internally wires G3's flip handle + resize persistence.
- `app/components/folder-shell/UnifiedHelperPaneTabs.vue` — top-of-helper tab row toggling `Podcast` / `Sources`. Emits `tabChange`. Listens for a `request-sources-panel` document event to auto-flip to Sources on citation click.

**Modified:**
- `app/pages/app/folders/[id].vue` — (a) merge `chat` and `audio-overview` tabs into a single `chat` tab; (b) tab content renders `UnifiedConversationPane` with chat + podcast slots; (c) `?tab=audio-overview` query redirect + `setPreferredMainPane('podcast')` on first land; (d) swap local `useReferenceScope()` for `useFolderReferenceScope({ folderId })`; (e) watch `preferredMainPane` from folder doc to decide initial orientation; (f) pass `preferredMainPane` as a prop to `UnifiedConversationPane`.
- `app/components/chat/Input.vue` — no signature change (still accepts `scope` prop). Scope chip label becomes: if `hasSelection=false` render "All docs · folder + subfolders" with a folder-tree icon; if `hasSelection=true` render "N of M docs" amber. Empty-folder state (folder has `documentCount === 0` AND no indexed docs) renders the "No documents yet" card inside the picker dropdown instead of the tree. New prop `hasIndexedDocs: boolean` for empty-state detection.
- `app/components/chat/DirectoryPicker.vue` — add empty-state rendering when `hasIndexedDocs === false` is passed down.
- `app/components/audio-overview/AudioOverviewCustomize.vue` — add Scope section at the top of the dialog body. Collapsed: "Using folder default · N docs" + Override button. Override: inline `DirectoryPicker` bound to an ephemeral `useReferenceScope` seeded from `folders.referenceScope`. On submit, pass `scopeDocIds` via emit; Shell wires to generate call.
- `app/components/audio-overview/AudioOverviewShell.vue` — on Customize submit, if override active, resolve the override's `scopeDocIds` via `api.folders.resolveScope` query; pass into `$fetch('/api/audio-overview/generate', { scopeDocIds })`. If no override, resolve folder scope the same way.

**Tests:**
- `tests/component/folder-shell/unified-conversation-pane.test.ts` — flip smoke; helper tab toggle; mobile layout collapse.
- `tests/component/audio-overview/customize-scope.test.ts` — collapsed default; override expansion; submit payload shape.

## Tasks & Acceptance

**Execution:**
- [ ] `app/components/folder-shell/UnifiedConversationPane.vue` — 2-pane layout, flip reuse, mobile collapse
- [ ] `app/components/folder-shell/UnifiedHelperPaneTabs.vue` — Podcast/Sources toggle
- [ ] `app/pages/app/folders/[id].vue` — tab collapse, routing redirect, useFolderReferenceScope swap, initial orientation from `preferredMainPane`
- [ ] `app/components/chat/Input.vue` — new "All docs · folder + subfolders" default chip; "N of M" amber narrowed chip; hasIndexedDocs prop; empty-state bypass
- [ ] `app/components/chat/DirectoryPicker.vue` — empty-state card ("No documents yet" + Go-to-Documents CTA)
- [ ] `app/components/audio-overview/AudioOverviewCustomize.vue` — Scope section (collapsed + override expanded)
- [ ] `app/components/audio-overview/AudioOverviewShell.vue` — resolve scope via `api.folders.resolveScope`; pass `scopeDocIds` to generate POST
- [ ] `tests/component/folder-shell/unified-conversation-pane.test.ts`
- [ ] `tests/component/audio-overview/customize-scope.test.ts`

**Acceptance Criteria:**
- Given a folder with `preferredMainPane='chat'` (or undefined), when the user lands on the folder page, then the Chat pane is on the main side and the Podcast pane is on the helper side; audio controls are visible in the helper.
- Given `preferredMainPane='podcast'`, when the user lands, then Podcast is main and Chat is helper.
- Given either orientation, when the user clicks the flip handle, then the panes swap orientation; audio playback does not pause.
- Given a chat message with citations, when the user clicks a `[1]` chip, then the helper tab switches from Podcast to Sources and the cited passage is focused.
- Given the chat input scope chip, when the folder has docs and scope is empty, then the chip shows "All docs · folder + subfolders"; clicking opens a picker with the full tree.
- Given a narrowed scope, when the chip is clicked, then the dropdown shows the current selection pre-filled; an "X" icon on the chip clears back to default.
- Given a folder with 0 indexed docs, when the scope picker opens, then the "No documents yet" card renders instead of the folder tree.
- Given the Customize dialog, when opened, then the Scope section shows "Using folder default · N docs" with an Override button; clicking Override expands an inline picker seeded from the folder scope.
- Given Override active, when the user submits, then the generate POST body carries `scopeDocIds` matching the override selection; `folders.referenceScope` is NOT modified.
- Given `?tab=audio-overview` URL, when the user navigates, then the page redirects to `?tab=chat` and persists `preferredMainPane='podcast'`.

## Spec Change Log

### Mid-implementation scope adjustment (2026-04-18)

Landing in 5A.2 (tight — scope-persistence wiring only):
- Chat input: swap ephemeral `useReferenceScope()` for persisted `useFolderReferenceScope({ folderId })` in `folders/[id].vue`. Chat scope selections now survive reload and are cross-device.
- `AudioOverviewShell`: resolves folder scope via `api.folders.resolveScope` and passes `scopeDocIds` to the generate POST. Podcast generation now honors the same scope as chat.
- `AudioOverviewCustomize`: informational Scope row ("Using folder default · N docs") rendered above Length/Complexity/Voices. Read-only in 5A.2.

**Deferred to Phase 5A.3 (next PR):**
- Chat input scope chip visual redesign (text chip vs current Crosshair icon button).
- `DirectoryPicker` empty-state "No documents yet" card.
- Customize Override expanded picker (inline tree + ephemeral override).
- **Podcast as helper-pane tab on Chat** (Podcast | Sources toggle).
- Full tab collapse (`chat` + `audio-overview` → one).
- `UnifiedConversationPane` component.
- `preferredMainPane`-driven orientation swap.
- `?tab=audio-overview` → `?tab=chat` redirect.

**Rationale:** The approved designs assumed a redesigned chat composer (text chip instead of the current icon button) and a substantial folder-page refactor. Without a parallel chat composer rewrite, the visual-design delivery would be a half-measure. Shipping this minimal slice preserves the design north star for 5A.3 while locking in the most concrete user-value today — **scope persists across sessions and applies to podcast generation** — with low regression risk.


## Design Notes

`UnifiedConversationPane` reuses the existing `ResizablePanelGroup` pattern from the current Chat tab's source-panel layout. The G3 flip direction persistence (`SOURCE_PANEL_SIDE_KEY`) is repurposed to mean "helper on left vs right"; no new localStorage key. `preferredMainPane` is orthogonal to flip: `preferredMainPane='chat'` + flip-left means Chat is main and Podcast helper is on the left. `preferredMainPane='podcast'` + flip-right means Podcast is main and Chat helper is on the right. The flip handle swaps `sourcePanelSide` which visually repositions the helper; orientation (which pane is main) follows `preferredMainPane`.

The Customize Override uses a local `useReferenceScope` instance that is seeded from the current folder scope on mount. The dialog's submit emit carries `{ lengthMinutes, complexity, voiceProfile, scopeOverride?: { folderIds, fileIds } }`. The Shell resolves the selection into `scopeDocIds` via `api.folders.resolveScope` before POSTing. If no override, the Shell resolves the folder's persisted scope the same way.

Empty-state detection: if the folder's document count > 0 but none are in `success` status, the picker still shows the tree but each doc renders disabled. If the folder has 0 documents at all, the "No documents yet" card renders. Subfolders with docs are always browsable regardless.

Helper tab persistence: store active helper tab in `sessionStorage` keyed by `helper-content-<folderId>`. Session scope is intentional — users who explicitly switch to Sources likely want to stay on Sources during that session, but a fresh visit should default to Podcast.

## Verification

**Commands:**
- `pnpm test` — expect: main tests unchanged (no backend changes)
- `pnpm test:component` — expect: baseline + 2 new test files green

**Manual checks:**
- Desktop: land on folder with `preferredMainPane='chat'` → chat main + podcast helper. Flip → swap.
- Create Podcast Void → `preferredMainPane='podcast'` → next load shows podcast main.
- Chat scope chip: empty = "All docs · folder + subfolders". Narrow to 3 → amber "3 of N docs" with X. Click X → back to default.
- Customize dialog: collapsed scope row → "Using folder default · N docs" + Override. Override expanded → picker seeded from folder scope. Submit with override → server receives `scopeDocIds`.
- Empty folder: scope chip click → "No documents yet" card with Documents-tab link.
- Citation click in chat → helper flips to Sources; click the helper's Podcast tab → flips back.
- Mobile: chat full-screen; sticky mini-player visible; no flip handle.
- Legacy `?tab=audio-overview` URL → redirects to `?tab=chat` + persists `preferredMainPane='podcast'`.
