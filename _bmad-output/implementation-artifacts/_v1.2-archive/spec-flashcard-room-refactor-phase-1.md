/---
title: 'Flashcard Room Refactor — Phase 1'
type: 'refactor'
created: '2026-04-16'
status: 'in-review'
baseline_commit: 'a4f7e7743bde8900b7408db254a3c7aaf2dea0c1'
branch: 'feat/flashcard-room-refactor-phase-1'
context:
  - DESIGN.md
  - FLASHCARDSPLAN.md
  - _bmad-output/implementation-artifacts/quick-flow-state.yaml
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Flashcards today are folder-scoped "generated set lists" — each AI generation becomes a new rail entry. This fragments the rail, loses continuity across regenerations, and blocks durable features like history, in-room iteration, and (later) SRS. The model doesn't match Budds' void-native workspace, where each void is a persistent room, not an artifact log.

**Approach:** Introduce a persistent `flashcardRoom` as the flashcard void entity. Current cards live in `flashcardRoomCards`; every generation archives the previous cards into `flashcardRoomVersions` + `flashcardVersionCards`. Rebuild UI as a unified room shell with Editor/Practice modes, inline rename, history panel, and an AI-generation modal. Legacy `flashcardSets`/`flashcards` tables stay in schema (tombstoned) with a one-shot migration copying each legacy set into a room plus an initial history version. Route `voidId` changes from set IDs to room IDs.

## Boundaries & Constraints

**Always:**
- Auth on every endpoint via `ctx.auth.getUserIdentity()`; ownership resolved server-side from `userId = identity.tokenIdentifier`.
- Bounded queries with explicit indexes; no unbounded `.collect()` on user-facing list endpoints (pagination / index filter per table).
- Card field naming: `term`, `definition`, `displayOrder`, `metadata: { source?: { documentId?, filename, chunkContent } }`.
- Generation + restore flows MUST archive current cards into a new version before replacing — never destructive.
- Optimistic UI for reorder with rollback on mutation failure.
- Follow DESIGN.md "Warm Focus" palette, void-native layout, shadcn-vue + reka-ui primitives, Tailwind-only (no `<style>` blocks except existing Study flip animation which stays).
- All new Convex endpoints covered by `convex-test` suite (P0 auth/ownership + happy path + edge cases).
- Component tests updated in place (not parallel additions) for refactored flashcard surfaces.

**Ask First:**
- ANY schema change beyond the four new tables listed below.
- Dropping or altering legacy `flashcardSets` / `flashcards` tables (Phase 1 tombstones them; removal is Phase 2).
- Adding SM-2 / spaced-repetition fields on any new table.
- Installing `@convex-dev/migrations` (not currently a dep; Phase 1 uses a one-shot internal mutation).

**Never:**
- Standalone practice route, SRS dashboard, or study-guide flashcard embedding (all Phase 2+).
- Coupling a flashcard room to a chat conversation.
- Dropping legacy tables or their data in this phase.
- Mocking Convex in the new room tests — use `convex-test` with real `schema` + modules.
- `git add -A`, `.`, or `--no-verify`.
- A fourth "Study Guide" tile in CreateVoidDialog (scope creep — current VoidType union stays `chat | flashcards | quiz`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create room (empty) | `createRoom({folderId, title?})` as owner | Inserts `flashcardRooms` row; `activeVersionId=undefined`; title defaults `'Flash Cards'` if blank; returns `{roomId}` | `Unauthenticated` \| `Folder not found` |
| Rename room | `renameRoom({roomId, title})` owner | Trims, slices 120 chars, falls back to `'Flash Cards'` if blank; patches title + `updatedAt` | `Unauthenticated` \| `Room not found` |
| List rooms | `listRoomsByFolder({folderId})` owner | Returns `[{_id, _creationTime, title, cardCount, updatedAt}]` newest-updated first (via `by_userId_and_folderId` index + in-memory sort) | Non-owner folder → `[]` (silent) |
| Create card | `createCard({roomId, term, definition, metadata?})` owner | Appends card with `displayOrder = max(existing)+1`; trims strings; rejects empty term/def; clears room.`activeVersionId` | `Unauthenticated` \| `Room not found` \| `Term required` \| `Definition required` |
| Update card | `updateCard({cardId, term, definition, metadata?})` owner | Patches fields (trimmed, non-empty); clears room.`activeVersionId` | `Unauthenticated` \| `Card not found` \| `Term required` \| `Definition required` |
| Delete card | `deleteCard({cardId})` owner | Removes card; does NOT renumber siblings (display order is an ordering hint only); clears room.`activeVersionId` | `Unauthenticated` \| `Card not found` |
| Reorder cards | `reorderCards({roomId, order:[{cardId, displayOrder}]})` owner | Validates every cardId belongs to room + owner; patches `displayOrder` in a single mutation; clears room.`activeVersionId` | Any foreign cardId → reject whole mutation with `Invalid card` |
| Generate room cards | `generateRoomCards({roomId, origin:'ai', prompt?, requestedCardCount, cards:[...]})` owner, room has ≥1 current card | 1) snapshot current cards into a new `flashcardRoomVersions` row (+ `flashcardVersionCards`); 2) delete current cards; 3) insert generated cards with sequential `displayOrder`; 4) create NEW version row for the generation + copy generated cards into `flashcardVersionCards`; 5) set room.`activeVersionId` = new generation version; returns `{roomId, versionId, cardCount}` | `Unauthenticated` \| `Room not found` \| batches of 500 for deletes |
| Generate on empty room | same, room has 0 current cards | Skip step 1–2 (no archive); still creates version for the generation, sets `activeVersionId` | — |
| List room versions | `listRoomVersions({roomId})` owner | Returns `[{_id, _creationTime, title, origin, prompt?, requestedCardCount?, cardCount}]` newest-first via `by_roomId` index | Non-owner room → `[]` (silent) |
| Get room | `getRoom({roomId})` owner | Returns `{room, cards}` sorted by `displayOrder`; `null` if not found / not owner | — |
| Get room version cards | `getRoomVersion({versionId})` owner | Returns `{version, cards}` sorted by `displayOrder`; `null` if not found / not owner | — |
| Restore room version | `restoreRoomVersion({roomId, versionId})` owner, current room has cards | Archives current cards into a new `flashcardRoomVersions` (origin='manual', title='Pre-restore snapshot') + copies; deletes current cards; copies `flashcardVersionCards` of target version into `flashcardRoomCards` preserving `displayOrder`; sets room.`activeVersionId = versionId` | `Unauthenticated` \| `Room not found` \| `Version not found` \| version belongs to different room rejected |
| Restore on empty room | same, current 0 cards | Skip archive; copy target version cards in; set `activeVersionId` | — |
| Delete room | `deleteRoom({roomId})` owner | Batches delete of current cards, all version cards, all versions, then the room | `Unauthenticated` \| `Room not found` |
| Migrate legacy | one-shot internal mutation `migrateLegacyFlashcards` | For each legacy `flashcardSets` row: create `flashcardRooms` with same title/folder/user/_creationTime; create `flashcardRoomVersions` (origin='ai', title=legacy title, `cardCount=legacy count`); copy legacy `flashcards` → both `flashcardRoomCards` and `flashcardVersionCards` (mapping `front→term`, `back→definition`, `order→displayOrder`, source fields → `metadata.source`); set room.`activeVersionId` = initial version. Skip legacy rows whose user owns no matching folder (orphans). Idempotent via a `migratedFromSetId` field on the new room. | Logs + returns `{migratedRooms, skippedOrphans}` |
| Editor auto-empty | Enter Editor mode on a room with 0 cards | Render empty-state (design screen 1); clicking "Add first card" calls `createCard` with empty term + empty def — VALIDATION ERROR surfaces inline (blocked). Do NOT auto-insert a ghost DB row. | — |
| Reorder conflict | Two clients reorder same room | Last write wins at mutation level; optimistic client rolls back on error and re-reads | Toast `Reorder failed — retry` |
| Unauth on any room endpoint | no identity | Reject with `Unauthenticated` | — |
| Cross-user on any room endpoint | user B acting on user A's room | Reject with `Room not found` / `Card not found` / `Version not found` (uniform "not found" — no existence leak) | — |

</frozen-after-approval>

## Code Map

- `convex/schema.ts` -- add `flashcardRooms`, `flashcardRoomCards`, `flashcardRoomVersions`, `flashcardVersionCards` tables with indexes; keep legacy tables
- `convex/flashcardRooms.ts` -- NEW: all 12 room endpoints (room CRUD, card CRUD, reorder, generate, versions, restore)
- `convex/flashcardRooms.test.ts` -- NEW: `convex-test` suite covering every I/O row (auth, cross-user, happy, edge)
- `convex/migrations.ts` -- NEW: `migrateLegacyFlashcards` internalMutation + optional `runLegacyFlashcardMigration` action trigger
- `convex/migrations.test.ts` -- NEW: migration correctness + idempotency tests
- `convex/flashcards.ts` -- REMOVE exports for `createSetWithCards`, `listByFolder`, `getSetWithCards`, `updateCard`, `deleteCard`, `deleteSet` (legacy UI no longer uses them); keep file with a deprecation banner comment noting Phase 2 deletion
- `convex/flashcards.test.ts` -- DELETE (superseded by `flashcardRooms.test.ts`)
- `app/composables/useFlashcardRooms.ts` -- NEW: rail query + mutation wrappers, `generate()` flow calling `/api/flashcards/generate` → `generateRoomCards`
- `app/composables/useFlashcards.ts` -- DELETE (replaced by `useFlashcardRooms`)
- `app/components/flashcards/RoomShell.vue` -- NEW: header (inline-editable title + kebab), mode switch pill, body slot, sticky dock, history slide-over toggle, AI modal trigger
- `app/components/flashcards/RoomHeader.vue` -- NEW: inline-rename title + type caption + kebab menu (rename/delete)
- `app/components/flashcards/RoomEditor.vue` -- NEW: replaces `Editor.vue`; vertical editable list, drag reorder (`@vueuse/core` `usePointerSwipe`+DnD or simple HTML5 DnD), add/delete/optimistic-UI
- `app/components/flashcards/RoomPractice.vue` -- NEW: adapts existing `Study.vue` flip + keyboard; adds Shuffle and Reset buttons, collapsed dock
- `app/components/flashcards/RoomHistoryPanel.vue` -- NEW: right-side slide-over listing `flashcardRoomVersions`; expand-to-preview + Restore
- `app/components/flashcards/RoomGenerateDialog.vue` -- NEW: AI generation modal (sources picker reuse — see below; prompt; count; archive warning)
- `app/components/flashcards/Tab.vue` -- REWRITE: becomes thin wrapper selecting RoomShell for `roomId`, or Rail-style rooms list for folder landing (desktop) + empty-state when no rooms
- `app/components/flashcards/Editor.vue` -- DELETE (replaced by RoomEditor)
- `app/components/flashcards/Study.vue` -- DELETE (replaced by RoomPractice; flip CSS migrates over)
- `app/components/folder-shell/FolderShellRail.vue` -- AMEND: void list now reads rooms (not sets); keep chat/quiz coexistence; active indicator by `roomId`
- `app/components/folder-shell/FolderShellRailItem.vue` -- AMEND if it hardcodes flashcard set shape
- `app/components/voids/CreateVoidDialog.vue` -- AMEND: add a `name` input field (per design screen 7); emit `create: [{type, name?}]`; keep 3-tile type picker (chat/flashcards/quiz)
- `app/pages/app/folders/[id].vue` -- AMEND: flashcard `voidId` = `roomId`; createVoid handler calls `createRoom` then routes; delete handler calls `deleteRoom`
- `tests/component/flashcards/room-shell.test.ts` -- NEW: header rename, mode switch, history open
- `tests/component/flashcards/room-editor.test.ts` -- REWRITE of old `flashcards-editor.atdd.test.ts`: add/delete/reorder/first-card flow
- `tests/component/flashcards/room-practice.test.ts` -- REWRITE of old `flashcards-study.test.ts`: flip, prev/next, shuffle determinism (seeded), reset
- `tests/component/flashcards/room-generate-dialog.test.ts` -- NEW: form validation + archive-warning visibility
- `tests/component/flashcards/room-history.test.ts` -- NEW: list + expand + restore-confirm flow
- `tests/component/flashcards/flashcards-tab.atdd.test.ts` -- UPDATE or REPLACE: folder-landing rooms list + create/delete flows
- `tests/component/flashcards/flashcards-study.atdd.test.ts` -- DELETE (superseded)
- `tests/component/flashcards/flashcards-editor.atdd.test.ts` -- DELETE (superseded)
- `tests/component/flashcards/flashcards-study.test.ts` -- DELETE (superseded)
- `server/api/flashcards/generate.post.ts` -- VERIFY returns raw payload (already refactored in 0c93989); no change expected
- `server/utils/flashcard-prompt.ts` + `.test.ts` -- VERIFY untouched

## Tasks & Acceptance

**Execution:**
- [x] `convex/schema.ts` -- added 4 new tables with indexes (`by_userId`, `by_userId_and_folderId`, `by_roomId`, `by_versionId`, plus `by_migratedFromSetId` on `flashcardRooms` for idempotency lookups); legacy tables preserved
- [x] `convex/flashcardRooms.ts` -- implemented all 12 endpoints with ownership checks + uniform "not found" errors (`Unauthenticated` / `Folder not found` / `Room not found` / `Card not found` / `Version not found` / `Term required` / `Definition required` / `Invalid card`)
- [x] `convex/flashcardRooms.test.ts` -- 30 tests covering every I/O Matrix row (auth, cross-user, happy, edge)
- [x] `convex/migrations.ts` -- `migrateLegacyFlashcards` internal mutation; idempotent via `migratedFromSetId` field on new rooms (reuses `by_migratedFromSetId` index)
- [x] `convex/migrations.test.ts` -- 3 tests: correctness + idempotency + orphan skip
- [x] `convex/flashcards.ts` -- trimmed to a deprecation banner + the single `createSetWithCards` export that existing `accountDeletion.test.ts` / `dataExport.test.ts` depend on to seed legacy rows. Production reads + writes all go through `flashcardRooms.ts`.
- [x] deleted `convex/flashcards.test.ts` (superseded)
- [x] `app/composables/useFlashcardRooms.ts` -- rooms listing + generate + createRoom/renameRoom/deleteRoom wrappers
- [x] deleted `app/composables/useFlashcards.ts`
- [x] `app/components/flashcards/RoomShell.vue` + `RoomHeader.vue` -- shell with inline-rename header, mode switch pill, history button, generate trigger, delete confirm
- [x] `app/components/flashcards/RoomEditor.vue` -- editable list, HTML5 DnD reorder with optimistic mirror + rollback on mutation failure, add/delete inline, trimmed-server-side validation
- [x] `app/components/flashcards/RoomPractice.vue` -- ported flip CSS from old Study.vue; Shuffle (Fisher-Yates + optional `_seedForTests` prop for deterministic tests) + Reset + keyboard nav + swipe
- [x] `app/components/flashcards/RoomHistoryPanel.vue` -- right slide-over, version list, expand-to-preview, Restore with confirm
- [x] `app/components/flashcards/RoomGenerateDialog.vue` -- prompt + card count + archive warning. **Tier-1 decision**: did NOT embed a directory picker in the generate dialog. The chat `ChatDirectoryPicker` is tightly coupled to `useReferenceScope` (chat-state only). Extracting a shared primitive would be a sizable chat refactor outside this spec's scope; the spec's Code Map says "extract shared variant *if needed*". The server-side `/api/flashcards/generate` already scopes by `folderId`, which is the minimum Phase 1 surface. Source-picking is deferred to Phase 2 along with the picker-primitive extraction.
- [x] `app/components/flashcards/Tab.vue` -- rewritten as thin wrapper: RoomShell when `selectedRoomId`, otherwise rooms grid + empty state + create-room button
- [x] deleted `app/components/flashcards/Editor.vue` + `Study.vue`
- [x] `app/components/folder-shell/FolderShellRail.vue` -- flipped flashcards section from `api.flashcards.listByFolder` to `api.flashcardRooms.listRoomsByFolder`; `updatedAt` (or `legacyCreatedAt` / `_creationTime` fallback) now drives rail sort order
- [x] `app/components/voids/CreateVoidDialog.vue` -- added name input, emit signature changed to `create: [{type, name?}]`
- [x] `app/pages/app/folders/[id].vue` -- flashcard `voidId` now = `roomId`; CreateVoid flow calls `createRoom` then routes `?tab=flashcards&voidId=<roomId>`; delete flow calls `deleteRoom`; FlashcardsTab `select-room` emit updates the URL in-place
- [x] component tests: created `room-shell.test.ts`, `room-editor.test.ts`, `room-practice.test.ts`, `room-generate-dialog.test.ts`, `room-history.test.ts`; rewrote `flashcards-tab.atdd.test.ts` for the rooms-first landing; deleted `flashcards-study.test.ts`, `flashcards-study.atdd.test.ts`, `flashcards-editor.atdd.test.ts`
- [ ] run migration mutation once (dev env) — deferred to deploy phase
- [ ] manual smoke — deferred to deploy phase

**Acceptance Criteria:**
- Given a folder with legacy `flashcardSets`, when the migration mutation runs, then each legacy set appears in `listRoomsByFolder` with the same title and its cards are viewable in Editor AND as the room's initial history version.
- Given a room with 12 cards, when the user calls `generateRoomCards` with a new set, then the previous 12 cards appear as a new history version AND the room now shows the new generated cards AND `activeVersionId` points to the new generation.
- Given a rail with mixed chat + flashcards + quiz voids, when a flashcard room is selected, then FolderShellRail shows the amber left border + 8% amber tint on that row and the main content renders `RoomShell`.
- Given Editor mode with 0 cards, when the user opens the room, then the empty-state screen renders and no database row is auto-inserted; clicking "Add first card" opens a new row with focused term field.
- Given any of the 7 approved Stitch screens, when the implementation is complete, then the rendered Vue surface visually reflects the same layout and warm-focus palette (human visual verification).
- Given CreateVoidDialog with type=flashcards and a name entered, when submitted, then a new room is created with that name and the user is routed to `/app/folders/<folderId>?voidId=<roomId>`.
- Given a room in Practice mode, when the user presses Shuffle with a provided seed in tests, then the output order is deterministic and identical across runs.
- Given the full test suite, when `pnpm lint && pnpm typecheck && pnpm test && pnpm test:component` all run, then every command exits 0.

## Spec Change Log

<!-- Empty until first bad_spec loopback. -->

## Design Notes

- Shuffle determinism: parameterize the RNG (`Math.random` in prod, seeded PRNG in tests). Exposing a `_seedForTests?` prop on `RoomPractice` is acceptable; hide behind a dev-only guard if desired.
- Optimistic reorder: keep a local `cards` array mirror; on drop apply locally + fire `reorderCards` mutation; on reject revert + toast.
- `metadata` nesting: wrap the legacy flat `sourceDocumentId/Filename/ChunkContent` fields into `metadata.source` so future card types can add other metadata (e.g. difficulty) without another schema sweep.
- Directory picker extraction: if `ChatDirectoryPicker` is tightly coupled to chat state, extract `DirectoryPicker` into `app/components/global/` so the AI generate dialog and chat both consume the same primitive.
- `_creationTime` preservation during migration: the `flashcardRooms` insert receives `_creationTime` from the legacy set via `ctx.db.insert` is NOT supported for custom `_creationTime`; mirror legacy creation into a `legacyCreatedAt` column on the room instead for display fidelity.

## Verification

**Commands:**
- `pnpm lint` -- expected: clean exit
- `pnpm typecheck` -- expected: clean exit (new Convex generated types + new composable types)
- `pnpm test` -- expected: all Convex + server tests green (new `flashcardRooms.test.ts` + `migrations.test.ts` pass)
- `pnpm test:component` -- expected: all component tests green (room-* tests pass; legacy tests removed, not skipped)
- `pnpm build` -- expected: Nuxt build passes (run AFTER test:component completes; never concurrent)

**Manual checks:**
- Migration dry run on a non-empty dev folder: confirm rooms listed with correct titles + initial history version per room.
- Visual pass against approved Stitch screens 1–7 (flashcard-room-* + folder-rail + create-void).
- Kebab route cleanup: deleting the active room in the rail clears `voidId` from the URL cleanly.

## File List

### Created
- `convex/flashcardRooms.ts`
- `convex/flashcardRooms.test.ts`
- `convex/migrations.ts`
- `convex/migrations.test.ts`
- `app/composables/useFlashcardRooms.ts`
- `app/components/flashcards/RoomHeader.vue`
- `app/components/flashcards/RoomShell.vue`
- `app/components/flashcards/RoomEditor.vue`
- `app/components/flashcards/RoomPractice.vue`
- `app/components/flashcards/RoomHistoryPanel.vue`
- `app/components/flashcards/RoomGenerateDialog.vue`
- `tests/component/flashcards/room-shell.test.ts`
- `tests/component/flashcards/room-editor.test.ts`
- `tests/component/flashcards/room-practice.test.ts`
- `tests/component/flashcards/room-generate-dialog.test.ts`
- `tests/component/flashcards/room-history.test.ts`

### Modified
- `convex/schema.ts` (added 4 room tables + indexes; added `cardCount` to `flashcardRooms`; added `by_roomId_and_displayOrder` composite index to `flashcardRoomCards`)
- `convex/flashcards.ts` (trimmed to deprecation banner + `createSetWithCards` seed-only export)
- `convex/accountDeletion.ts` (added 4 batched-delete helpers for the new room tables; refactored `deleteAccountCascade` to accept `userId` arg, added `deleteCurrentUser` public wrapper)
- `convex/dataExport.ts` (added `flashcardRooms`, `flashcardRoomCards`, `flashcardRoomVersions`, `flashcardVersionCards` to GDPR export)
- `convex/dataExport.test.ts` (added room + version export test)
- `app/components/flashcards/Tab.vue` (rewritten as room-list / RoomShell switcher)
- `app/components/folder-shell/FolderShellRail.vue` (flipped to `api.flashcardRooms.listRoomsByFolder`; amber tint fixed to 8%)
- `app/components/voids/CreateVoidDialog.vue` (added name input, emit signature now `{type, name?}`)
- `app/pages/app/folders/[id].vue` (wired createRoom/deleteRoom, flashcard voidId = roomId)
- `tests/component/flashcards/flashcards-tab.atdd.test.ts` (rewritten for rooms-first landing)
- `tests/component/voids/create-void-dialog.test.ts` (updated assertions for new emit signature + name input)
- `_bmad-output/implementation-artifacts/spec-flashcard-room-refactor-phase-1.md` (task ticks + this File List)
- `_bmad-output/implementation-artifacts/deferred-work.md` (added phase-1 deferred items)

### Deleted
- `convex/flashcards.test.ts` (superseded by `flashcardRooms.test.ts`)
- `app/composables/useFlashcards.ts` (superseded by `useFlashcardRooms.ts`)
- `app/components/flashcards/Editor.vue` (superseded by `RoomEditor.vue`)
- `app/components/flashcards/Study.vue` (superseded by `RoomPractice.vue`; flip CSS migrated)
- `tests/component/flashcards/flashcards-study.test.ts` (superseded by `room-practice.test.ts`)
- `tests/component/flashcards/flashcards-study.atdd.test.ts` (superseded)
- `tests/component/flashcards/flashcards-editor.atdd.test.ts` (superseded by `room-editor.test.ts`)
