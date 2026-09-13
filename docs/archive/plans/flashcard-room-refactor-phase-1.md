# Flashcard Room Refactor Plan

> Historical implementation plan retained for decision traceability. The room model is now implemented; current behavior is defined by the application, tests, and maintained product documentation.

## Summary
Refactor Budds flashcards from the current "folder-scoped generated set list" into a **persistent flashcard room** model that fits the existing **void-native workspace**. A flashcard void becomes a real room entity with editable current cards, in-room practice, and version history. We keep generation history, but move it behind the room instead of treating each generation as the primary object in the rail.

Phase 1 covers the **room foundation only**: room creation, rename, current-card CRUD/reorder, in-room practice, AI generation into the room, and room history. Standalone SRS and study-guide embedding are intentionally deferred, but the data model should leave a clean path for them.

## Key Changes
### Data model and migration
- Add `flashcardRooms` as the persistent flashcard void entity.
  Fields: `userId`, `folderId`, `title`, `activeVersionId?`, `createdAt` via `_creationTime`, `updatedAt`.
- Replace "set as primary object" with:
  - `flashcardRoomCards`: mutable current room cards.
    Fields: `roomId`, `displayOrder`, `term`, `definition`, `metadata`, source fields, timestamps.
  - `flashcardRoomVersions`: archived snapshots/generations.
    Fields: `roomId`, `title`, `origin` (`ai` | `manual`), `prompt?`, `requestedCardCount?`, `createdAt`.
  - `flashcardVersionCards`: immutable cards for each archived version.
- Do not add SM-2 review tables in Phase 1. Keep stable `roomId`/`roomCardId` boundaries so review state can be added later without reshaping the room API.
- Migrate existing data by converting each existing `flashcardSet` into its own `flashcardRoom` with its cards copied into `flashcardRoomCards`. Preserve the old generation as the room’s initial history version. This keeps current user-visible rail items from disappearing or collapsing unexpectedly.

### Convex/API surface
- Deprecate `listByFolder` / `getSetWithCards` as the primary UI entrypoints and replace with room-based queries:
  - `flashcards.listRoomsByFolder`
  - `flashcards.getRoom`
  - `flashcards.createRoom`
  - `flashcards.renameRoom`
  - `flashcards.createCard`
  - `flashcards.updateCard`
  - `flashcards.deleteCard`
  - `flashcards.reorderCards`
  - `flashcards.generateRoomCards`
  - `flashcards.listRoomVersions`
  - `flashcards.restoreRoomVersion`
  - `flashcards.deleteRoom`
- `generateRoomCards` should:
  1. validate selected documents / prompt / count,
  2. archive the current room cards into a new version,
  3. replace current room cards with the generated result,
  4. set that generated snapshot as the newest history entry.
- Keep authentication/ownership checks fully server-derived from `ctx.auth.getUserIdentity()`.
- Keep bounded queries and explicit indexes; no unbounded `.collect()` on user-facing list endpoints.

### UI and route behavior
- Change flashcard `voidId` routing to reference `flashcardRooms`, not generated sets.
- `CreateVoidDialog` for flashcards should create an empty room immediately, then route to it.
- `FolderShellRail` should list flashcard rooms, not generations.
- Replace `FlashcardsTab` with a room shell:
  - header with inline room rename + room type label,
  - editor/practice mode switch,
  - sticky bottom dock actions,
  - history entrypoint,
  - AI generation modal.
- Editor mode:
  - editable vertical card list,
  - add card,
  - delete card,
  - drag reorder with optimistic UI and rollback on failure,
  - auto-create one empty card on first entry if room has no cards.
- Practice mode:
  - current room cards only,
  - flip interaction, previous/next, shuffle, reset flip on navigation.
- Keep history inside the room UI as a secondary surface. Restoring a prior generation should replace current room cards after confirmation; history entries remain intact.
- Do not add a dedicated standalone practice route or study-guide flashcard section in Phase 1.

## Test Plan
- Convex tests:
  - room creation, rename, delete, ownership enforcement,
  - card CRUD and reorder,
  - generation archives current cards and replaces room cards,
  - version listing and restore behavior,
  - migration from legacy `flashcardSets`/`flashcards`.
- Component tests:
  - flashcard room empty state and first-card auto-create,
  - editor add/edit/delete/reorder flows,
  - dock state in editor vs practice,
  - practice flip/navigation/shuffle behavior,
  - history restore flow,
  - AI generation modal validation and success/error handling.
- Page/route tests:
  - folder rail lists rooms,
  - flashcard void selection uses room id in `voidId`,
  - flashcard create-void flow creates a room and routes correctly,
  - deleting a room clears invalid route selection cleanly.

## Assumptions and Defaults
- Budds remains **void-native**. A flashcard room is the flashcard void; it is not coupled to a chat conversation in Phase 1.
- Generation history is preserved, but as **room history**, not as the primary navigation object.
- Phase 1 excludes:
  - standalone spaced-repetition dashboard/session flow,
  - SM-2 scheduling persistence,
  - study-guide embedded flashcards.
- Card fields should use spec-aligned naming in the new room model: `term`, `definition`, `displayOrder`, `metadata`.
- Source attribution remains attached per card and continues to use current document/chunk metadata patterns.
