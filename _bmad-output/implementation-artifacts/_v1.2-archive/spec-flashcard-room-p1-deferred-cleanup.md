---
title: 'Flashcard Room Phase 1 — Deferred Cleanup'
type: 'chore'
created: '2026-04-16'
status: 'in-progress'
baseline_commit: '911ba5d'
branch: 'feat/flashcard-room-p1-deferred-cleanup'
context:
  - _bmad-output/implementation-artifacts/deferred-work.md
---

<frozen-after-approval>

## Intent

**Problem:** Six cleanup items were deferred during Phase 1's adversarial review: the directory-picker is still chat-coupled, legacy `createSetWithCards` lingers in test seeding, restore-no-op wastes version rows, SSR stubs return empty IDs, RoomShell test mock doesn't discriminate mutations, and reorder-rollback has no component test.

**Approach:** Fix all six in one chore pass. Extract a generic `DirectoryPicker` component, remove the legacy flashcards file entirely, add a no-op guard to `restoreRoomVersion`, harden SSR stubs, improve test mocks, and add the missing rollback test.

## Boundaries & Constraints

**Always:** Keep all existing passing tests green. Do not break chat's DirectoryPicker — extract, don't rewrite.

**Ask First:** Deleting `convex/flashcards.ts` entirely (plan says tombstone Phase 2, but file now has zero callers after test rewrite).

**Never:** Touch schema.ts (legacy tables stay tombstoned). Add new UI surfaces.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Restore no-op | `restoreRoomVersion({roomId, versionId})` where `room.activeVersionId === versionId` | Return `{roomId, versionId, cardCount}` immediately, no archive created, no cards touched | N/A |
| Restore different version | same but `activeVersionId !== versionId` | Current behavior: archive → delete → copy → set activeVersionId | Unchanged |
| SSR stub mutation call | `createRoom` called during SSR | Throws `Error('Flashcard room mutations require client-side context')` | Caller must handle (pages are auth-gated client-side, so this is a safety net) |

</frozen-after-approval>

## Code Map

- `app/components/global/DirectoryPicker.vue` -- NEW: extracted visual tree with generic props (folders, files, isSelected, onToggle, onClear)
- `app/components/chat/DirectoryPicker.vue` -- AMEND: thin wrapper passing useReferenceScope callbacks to global picker
- `app/components/flashcards/RoomGenerateDialog.vue` -- AMEND: use global DirectoryPicker with local selection state
- `convex/flashcardRooms.ts:551-595` -- AMEND: add no-op guard in restoreRoomVersion
- `convex/flashcardRooms.test.ts` -- ADD: test for restore-no-op (version count unchanged)
- `convex/flashcards.ts` -- DELETE (zero callers after test rewrite)
- `convex/accountDeletion.test.ts` -- AMEND: seed via flashcardRooms.createRoom + createCard
- `convex/dataExport.test.ts` -- AMEND: seed via flashcardRooms.createRoom + createCard
- `app/composables/useFlashcardRooms.ts:42-68` -- AMEND: server stubs throw instead of returning empty IDs
- `tests/component/flashcards/room-shell.test.ts:32-34` -- AMEND: keyed mockMutate per apiRef
- `tests/component/flashcards/room-editor.test.ts` -- ADD: reorder-rollback + toast test

## Tasks & Acceptance

**Execution:**
- [x] `app/components/global/DirectoryPicker.vue` -- extract generic picker from chat/DirectoryPicker; chat wrapper calls through
- [x] `app/components/flashcards/RoomGenerateDialog.vue` -- integrate global DirectoryPicker with local folder/file selection
- [x] `convex/flashcardRooms.ts` -- add `if (room.activeVersionId === args.versionId) return` guard
- [x] `convex/flashcardRooms.test.ts` -- test restore-no-op: call restore with current activeVersionId, assert version count unchanged
- [x] `convex/accountDeletion.test.ts` + `convex/dataExport.test.ts` -- rewrite seeding to use room endpoints
- [x] delete `convex/flashcards.ts`
- [x] `app/composables/useFlashcardRooms.ts` -- server stubs throw descriptive error
- [x] `tests/component/flashcards/room-shell.test.ts` -- key mockMutate on apiRef string
- [x] `tests/component/flashcards/room-editor.test.ts` -- add reorder-rollback-on-failure test

**Acceptance Criteria:**
- Given a room whose activeVersionId matches the requested version, when restoreRoomVersion is called, then no new version row is created and existing cards are untouched.
- Given the global DirectoryPicker, when used in both chat and flashcard contexts, then both render folder/file trees with correct selection state.
- Given `pnpm test` and `pnpm test:component`, when run after all changes, then zero new failures introduced.

## Spec Change Log

## Verification

**Commands:**
- `pnpm test` -- expected: all Convex tests pass (no new failures)
- `pnpm test:component` -- expected: all component tests pass (no new failures)
