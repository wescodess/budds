---
title: 'Audio Overview Phase 5A Foundation — unified Chat + Podcast folder surface + shared scope picker'
type: 'feature'
created: '2026-04-18'
status: 'ready-for-dev'
context:
  - 'roadmap-chat-podcast-unification.md'
  - 'DESIGN.md'
  - 'spec-audio-overview-phase-4-interjection.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Chat and Podcast live on separate folder tabs today; users can't listen + type without switching tabs. Directory scope is per-chat-session and doesn't reach podcast generation.

**Approach:** Collapse the Chat and Audio Overview tabs into a single **unified 2-pane surface** (desktop) / stacked chat + sticky mini-player (mobile). Both "Create Chat Void" and "Create Podcast Void" now route here — the only difference is the initial `preferredMainPane`. Persist a folder-level `referenceScope` consumed by both chat queries and podcast generation. Mobile gets a dedicated `/app/folders/[id]/podcast` expand route. Ask flow stays on the Phase-4 InterjectModal in 5A; 5B replaces it. Multi-chat migration stays in 5C.

## Boundaries & Constraints

**Always:**
- Folder page unifies the Chat and Audio Overview tabs. On desktop, the main "Conversation" tab renders a resizable 2-pane layout: one pane = Chat, other pane = Podcast. `folders.preferredMainPane` controls initial orientation; user flips via existing G3 `ArrowLeftRight` handle; flip is visual only (audio keeps playing). Flashcards / Quiz / Documents tabs stay unchanged.
- `folders.referenceScope` is the ONLY persisted scope state. Empty/undefined = "all docs in folder + all descendant subfolders, recursive."
- Chat input's scope chip and Customize dialog's scope section both read from / write to the same folder-level scope. Customize can override per-generation without touching `folders.referenceScope`.
- `audioOverviews.scopeDocIds` snapshotted at `createWithTurns` time so old podcasts keep their scope for 5C regen-pre-fill.
- Recursive subfolder inclusion walks the folders tree via `useFolders` — descendants aggregated on the client; `server/api/audio-overview/generate` resolves them into an expanded docId list before calling `searchDocuments`.
- Helper pane hosts exactly one content type at a time: **Podcast** (new default) or **Sources** (existing `ChatSourcePanel` for citations). Small tab row at the top of the helper toggles between the two. Citation click auto-switches helper to Sources.
- Mobile: no 2-pane. Chat full-screen + Phase-2 sticky mini-player. Tapping the mini-player's Expand routes to `/app/folders/[id]/podcast` — a standalone page with `layout: false, auth: user`, showing the full Player surface.
- Existing Phase-4 InterjectModal stays intact. Ask button wiring unchanged. 5B replaces it.
- CreateVoidDialog's Chat and Podcast tiles both route to `/app/folders/<id>` but set `folders.preferredMainPane` before navigating. No void row is created for chat/podcast types. Flashcards and Quiz tiles unchanged.

**Ask First:**
- Any schema change beyond `folders.preferredMainPane`, `folders.referenceScope`, `audioOverviews.scopeDocIds`.
- Any new Convex env var (none expected).
- Any change to `accountDeletion.ts` / `dataExport.ts` (new fields need export parity).

**Never:**
- No multi-chat-per-folder migration in 5A — deferred to 5C (data loss decision already locked).
- No ask-via-chat flow in 5A — deferred to 5B. InterjectModal stays.
- No regen scope intersection logic in 5A — deferred to 5C.
- No sidebar void counter simplification in 5A — deferred to 5C.
- No PR targeting `main`. No Claude attribution. No `--no-verify`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Open folder first time | `preferredMainPane` undefined | Defaults to `chat` main + podcast helper | — |
| Create Chat Void on fresh folder | CreateVoidDialog submits `chat` tile | `setPreferredMainPane(folderId, 'chat')` then `navigateTo(/app/folders/<id>)` | — |
| Create Podcast Void | Podcast tile | `setPreferredMainPane(folderId, 'podcast')` then nav | — |
| Flip panes during playback | Audio playing, user clicks flip | Pane orientation swaps; audio keeps playing; persistence updates via existing G3 logic | — |
| Chat sent with default scope | `referenceScope` empty | Server expands to all-docs-in-folder-recursive | — |
| Chat sent with narrowed scope | 3 fileIds selected | Server honors; no recursion expansion | — |
| Podcast generated with folder scope | `referenceScope` set, Customize uses default | `audioOverviews.scopeDocIds` = current scope | — |
| Podcast generated with override | Customize override picker | `audioOverviews.scopeDocIds` = override; `folders.referenceScope` unchanged | — |
| Folder with 0 indexed docs | Scope picker opened | Shows empty-state "No documents yet" + Go-to-Documents-tab CTA | — |
| Citation clicked in chat | User taps `[1]` | Helper switches from Podcast → Sources with citation focused | Falls back silently if no citation metadata |
| Mobile user taps mini-player expand | On any non-podcast route | Routes to `/app/folders/<id>/podcast` | Back button returns to chat |
| Desktop user taps mini-player expand | Already on folder | Scrolls Podcast pane into view (no route change) | Mobile-only route otherwise |
| Folder scope includes deleted doc | User changes scope, then deletes doc | Scope row NOT auto-cleaned in 5A; server filters out on next query | 5C adds cleanup |
| preferredMainPane + old voids | Folder had Chat + Podcast voids before 5A | Voids preserved in DB, hidden in 5A UI. Users see unified surface. | 5C does proper migration |

</frozen-after-approval>

## Code Map

**New:**
- `convex/folders.ts` — add mutations `setPreferredMainPane({ folderId, pane })` and `setReferenceScope({ folderId, scope })`; auth + owner-gated. Extend `updateFolder` to accept both fields.
- `convex/folders.test.ts` — auth, ownership, pane + scope persistence round-trip.
- `app/components/folder-shell/UnifiedConversationPane.vue` — the 2-pane composite that hosts Chat (main or helper) + Podcast (main or helper) via G3's `ResizablePanelGroup`. Flip state persisted per-folder via existing source-panel-flip pattern (extend `SOURCE_PANEL_SIDE_KEY` to carry an extra `helper-content` value).
- `app/components/folder-shell/UnifiedHelperPaneTabs.vue` — small tab row at the top of the helper slot toggling `Podcast` ↔ `Sources`. Citation clicks in chat dispatch to switch to Sources.
- `app/composables/useFolderReferenceScope.ts` — bridges the existing `useReferenceScope` (local transient state) to Convex-persisted `folders.referenceScope`. Loads initial state from folder doc; pushes debounced writes via `setReferenceScope` mutation. Resolves "all docs recursive" default by walking `useFolders` on the client.
- `app/pages/app/folders/[id]/podcast.vue` — mobile expand route. `definePageMeta({ layout: false, auth: 'user' })`. Header with "← Back to chat" chevron + title. Mounts the existing authenticated `AudioOverviewShell` standalone.
- `app/components/folder-shell/UnifiedPaneFlipHandle.vue` — wraps the G3 flip handle with tooltip/label for the new "Flip chat ↔ podcast" action. Reuses `ArrowLeftRight` icon + existing `handlePanelFlipClick`.

**Modified:**
- `convex/schema.ts` — `folders.preferredMainPane?: v.union(v.literal('chat'), v.literal('podcast'))`; `folders.referenceScope?: v.object({ folderIds?: v.array(v.id('folders')), fileIds?: v.array(v.id('documents')) })`; `audioOverviews.scopeDocIds?: v.array(v.id('documents'))`.
- `convex/audioOverviews.ts` — `createWithTurns` accepts optional `scopeDocIds`, persists on row. No auth change.
- `app/pages/app/folders/[id].vue` — **collapse** the separate `chat` + `audio-overview` tabs into a single "Conversation" tab (URL `?tab=chat` remains for backward compat; `?tab=audio-overview` redirects to `?tab=chat` + sets `preferredMainPane=podcast`). The tab renders `UnifiedConversationPane`. Citation click in chat dispatches to helper's Sources tab. Helper `sourcePanelSide` flip reuses G3's existing state; `SOURCE_PANEL_SIDE_KEY` continues to persist flip direction.
- `app/components/voids/CreateVoidDialog.vue` — `onCreate` for `chat` and `audio-overview` types calls `setPreferredMainPane` before emitting navigation. No void row created.
- `app/components/chat/Input.vue` — pull scope from `useFolderReferenceScope` (persisted) instead of local ephemeral `useReferenceScope`. Scope chip renders "All docs · folder + subfolders" when empty, "N of M docs" when narrowed. Empty-state picker shows "Upload something first" with Documents-tab link when folder has 0 indexed docs.
- `app/components/audio-overview/AudioOverviewCustomize.vue` — new Scope section at the top: collapsed default shows "Using folder default · N docs" + Override ghost button. Expanded reveals the existing `DirectoryPicker` components bound to a local `useReferenceScope` overlay. On submit, if override active, pass overlay's scopeDocIds to the generate endpoint; else pass the folder scope.
- `app/components/audio-overview/AudioOverviewShell.vue` — accept `scopeOverride?: Id<'documents'>[]` prop from the Customize dialog's submit handler; fall through to `folders.referenceScope` when absent. POST to `/api/audio-overview/generate` includes `scopeDocIds`.
- `server/api/audio-overview/generate.post.ts` — accepts optional `scopeDocIds: string[]` in body. If present, passes to `searchDocuments({ userId, folderId, scopeDocIds })` as an additional filter. If absent/empty, resolves to "all docs in folder + recursive descendants" via a new helper `expandFolderScope(folderId)` that walks subfolders and returns docId union. Scope snapshot written to `createWithTurns` call as `scopeDocIds`.
- `server/utils/ai-search.ts` — extend `searchDocuments` to accept an optional `filterDocIds?: string[]` kwarg; applied as a post-filter on results (AI Search doesn't natively support doc-id filtering — we filter client-side after retrieval).
- `app/components/audio-overview/StickyMiniPlayer.vue` — Expand button behavior: on mobile (`useMediaQuery('(max-width: 767px)')` = true) navigate to `/app/folders/<fid>/podcast`; on desktop, keep current behavior (navigate to folder page).

**Deleted:** None. Existing components preserved.

**Tests (new):**
- `convex/folders.test.ts` — new block for `setPreferredMainPane` + `setReferenceScope`.
- `server/api/audio-overview/generate.scope.test.ts` — OR extend existing — scope expansion (recursive), override respected, empty scope fallback.
- `tests/component/folder-shell/unified-conversation-pane.test.ts` — flip behavior smoke test; helper tab toggle.

## Tasks & Acceptance

**Execution:**
- [ ] `convex/schema.ts` — add `folders.preferredMainPane`, `folders.referenceScope`, `audioOverviews.scopeDocIds`
- [ ] `convex/folders.ts` — `setPreferredMainPane` + `setReferenceScope` mutations; extend `updateFolder`
- [ ] `convex/folders.test.ts` — auth/ownership + round-trip tests
- [ ] `convex/audioOverviews.ts` — accept `scopeDocIds` in `createWithTurns`
- [ ] `app/composables/useFolderReferenceScope.ts` — Convex-persisted scope composable
- [ ] `app/components/folder-shell/UnifiedConversationPane.vue` — 2-pane composite per approved design
- [ ] `app/components/folder-shell/UnifiedHelperPaneTabs.vue` — Podcast ↔ Sources toggle
- [ ] `app/pages/app/folders/[id].vue` — collapse chat+audio-overview tabs; render UnifiedConversationPane
- [ ] `app/components/voids/CreateVoidDialog.vue` — Chat/Podcast tiles set preferredMainPane, no void created
- [ ] `app/components/chat/Input.vue` — scope chip wired to useFolderReferenceScope; empty-state handling
- [ ] `app/components/audio-overview/AudioOverviewCustomize.vue` — Scope section with collapsed/expanded states
- [ ] `app/components/audio-overview/AudioOverviewShell.vue` — pass scopeDocIds to server on generate
- [ ] `server/api/audio-overview/generate.post.ts` — accept scopeDocIds; expand folder default recursive
- [ ] `server/utils/ai-search.ts` — optional filterDocIds kwarg
- [ ] `app/pages/app/folders/[id]/podcast.vue` — mobile expand route, layout:false
- [ ] `app/components/audio-overview/StickyMiniPlayer.vue` — mobile-vs-desktop Expand behavior split

**Acceptance Criteria:**
- Given a fresh folder, when the user clicks "Create Chat Void", then `folders.preferredMainPane='chat'` is persisted and the folder page renders chat in the main pane + podcast in the helper.
- Given the same folder, when the user clicks "Create Podcast Void", then `preferredMainPane='podcast'` is persisted and podcast lands in the main pane.
- Given audio is playing, when the user flips the panes, then playback never pauses and the flip direction persists per-folder.
- Given a folder with indexed docs, when the user opens the chat input scope chip, then the picker shows a folder tree with checkboxes; saving narrows `folders.referenceScope` and future chat + podcast generations honor it.
- Given the Customize dialog, when the user toggles Override, then the picker appears and the generation POST includes the override `scopeDocIds` instead of the folder default; `folders.referenceScope` is NOT modified.
- Given a new podcast generation, the resulting row has `scopeDocIds` matching the scope used.
- Given mobile viewport, when the user taps the sticky mini-player Expand, then `/app/folders/<id>/podcast` loads with a back-to-chat chevron.
- Given a folder with 0 indexed docs, when the scope picker opens, then the empty-state "No documents yet" card renders with a "Go to Documents tab" CTA.

## Spec Change Log

### Mid-implementation scope adjustment (2026-04-18)

Landed in 5A:
- `folders.preferredMainPane` + `folders.referenceScope` + `audioOverviews.scopeDocIds` schema + Convex mutations + tests.
- `useFolderReferenceScope` composable (hydrates folder.referenceScope + debounced writes).
- Mobile expand route `/app/folders/[id]/podcast`.
- StickyMiniPlayer mobile-vs-desktop expand split + new visibility guard for the podcast expand route.
- Server `/api/audio-overview/generate` accepts `scopeDocIds` body field with recursive-subfolder default expansion; AI Search filters by scope; Convex stores the snapshot.
- CreateVoidDialog Chat/Podcast tiles persist `preferredMainPane` before navigation (no existing-void-row created for those types).

**Deferred to Phase 5A.2 (next PR — still within the 5A design-approval envelope):**
- Unified 2-pane folder page refactor (collapsing Chat + Audio Overview tabs into a single resizable 2-pane surface).
- Customize dialog Scope section (collapsed/expanded override UI).
- Chat input scope chip visual integration with `useFolderReferenceScope` (current chat input keeps its existing ephemeral scope until 5A.2).
- UnifiedConversationPane + UnifiedHelperPaneTabs components.
- Empty-scope picker "No documents yet" card.

**Rationale:** The 5A spec as-originally-written combined data-foundation work with a large UI refactor. Splitting produces (a) a reviewable foundation PR that lets chat queries + podcast generation share scope today, and (b) a focused UI-refactor PR next that consumes the foundation without schema surprises. Designs approved in escalation log #1 cover both; they remain the target for 5A.2.


## Design Notes

The existing `useReferenceScope` composable handles tri-state selection / normalization / chips. Phase 5A wraps it in `useFolderReferenceScope` which (a) hydrates from `folders.referenceScope` on folder mount, (b) debounces writes (300ms) to `setReferenceScope`, (c) exposes a `bridgeFromOverview()` helper used by the Customize dialog's Override mode to clone the current folder scope into an ephemeral overlay.

Helper pane's Podcast ↔ Sources tab toggle uses a simple ref local to the unified pane component. Default is Podcast. On citation click in chat, the chat component emits `request-sources-panel` which the unified pane listens for and flips the helper to Sources.

The existing G3 `sourcePanelSide` flip persistence (localStorage via `SOURCE_PANEL_SIDE_KEY`) continues to work for the new unified pane — "left vs right" is still meaningful regardless of whether the helper contains Podcast or Sources.

Recursive scope expansion on the server is O(subtree). For folders with hundreds of nested subfolders this is still cheap since we only walk folder rows (indexed `by_userId_and_parentId`) and then union docId arrays. Cap at 500 docs per generation to prevent runaway LLM cost (fail fast with 422 if exceeded; user must narrow scope).

The mobile expand route `/app/folders/[id]/podcast` reuses `AudioOverviewShell` as-is. `layout: false` + a minimal custom header with the back chevron keeps the footprint low. No new Convex queries needed — the Shell already has everything it needs.

## Verification

**Commands:**
- `pnpm test` — expect: all green, +scope + folders tests
- `pnpm test:component` — expect: baseline unchanged

**Manual checks:**
- Desktop: click Create Chat Void → chat is main, podcast in helper. Flip → podcast is main, chat in helper. Audio keeps playing across flip.
- Create Podcast Void → podcast is main on next load.
- Chat scope chip: narrow to 3 docs → chat query uses those 3 + podcast generation uses those 3.
- Customize scope override: pick 2 different docs → those 2 are used ONLY for that generation; folder scope unchanged.
- Regenerate existing podcast → Customize opens with folder default pre-filled (5C adds old-scope pre-fill; 5A just folder default).
- Mobile: play podcast, navigate to home, see sticky bar. Tap Expand → lands on `/app/folders/<id>/podcast` with back chevron.
- Empty folder (0 indexed docs): scope picker shows empty-state card.
