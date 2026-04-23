# Story 5.1: Review Item Extraction & SM-2 Data Model

## Status: review

## Description
As a user, I want key concepts from completed sections to enter my review queue, so that I retain what I've learned over time.

## Acceptance Criteria

1. **Given** a section is marked completed, **When** the reinforcement block (flashcards) from that section is processed, **Then** review items are created in the `reviewItems` table with: prompt, answer, initial SM-2 parameters (easeFactor: 2.5, interval: 1, repetitions: 0), nextReviewDate set to tomorrow.
2. Each review item links to its courseId and sectionId.
3. Flagged items have `flagged: true` and are excluded from review scheduling.

## Tasks

- [x] 1. Add `reviewItems` table to `convex/schema.ts`
- [x] 2. Create `convex/reviewItems.ts` with extractFromSection, listDueForUser, listBySection
- [x] 3. Wire extraction into `completeSection` mutation
- [x] 4. Sync flagging between flashcard cards and review items
- [x] 5. Add Convex tests for extraction, due query, and flag sync
- [x] 6. Run `pnpm test` to verify no regressions (629 Convex + 382 component tests pass)

## Dev Agent Record

### Decisions
- `reviewItems` table uses `flashcardRoomCardId` to track the source flashcard card, enabling flag sync.
- `extractFromSection` is an internal mutation called from `completeSection` via `ctx.runMutation`. This keeps the extraction atomic within the completion transaction.
- `nextReviewDate` stored as ISO date string (e.g., "2026-04-24") for timezone-agnostic scheduling, consistent with architecture spec.
- `listDueForUser` uses `by_userId_and_nextReviewDate` index for efficient date-range queries, filtering out flagged items in the handler.
- Flag sync in `contentFlags.flagFlashcard` propagates to review items by querying `by_flashcardRoomCardId` index.

## File List
- `convex/schema.ts` — added reviewItems table
- `convex/reviewItems.ts` — new file with extractFromSection, listDueForUser, listBySection
- `convex/courseSections.ts` — wired extractFromSection into completeSection
- `convex/contentFlags.ts` — added flag sync to review items
- `convex/reviewItems.test.ts` — new test file

## Change Log
- Added `reviewItems` table to schema with SM-2 fields and indexes
- Created `convex/reviewItems.ts` with extractFromSection (internal mutation), listDueForUser (query), listBySection (query)
- Wired review item extraction into `completeSection` — after section is marked completed, flashcard cards are read and review items created
- Added flag propagation from `contentFlags.flagFlashcard`/`unflagFlashcard` to corresponding review items
- Added comprehensive Convex tests
