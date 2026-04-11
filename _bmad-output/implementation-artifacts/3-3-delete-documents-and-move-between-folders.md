# Story 3.3: Delete Documents and Move Between Folders

Status: done

## Story

As a student,
I want to delete documents I no longer need and reorganize them between folders,
So that my knowledge base stays clean and well-organized.

## Acceptance Criteria

1. **Given** a user viewing a document in the document list
   **When** they click the delete action on a document
   **Then** a confirmation AlertDialog appears showing the document filename
   **And** confirming triggers the cascading deletion sequence:
   1. Schedule an action to remove the document from Cloudflare AI Search (by documentId)
   2. Delete the file from Convex file storage
   3. Delete the document record from Convex
   4. Decrement the source folder's `documentCount`
   **And** the document list updates in real-time

2. **Given** a user viewing the document list
   **When** they select "Move to folder" on a document
   **Then** they can choose a destination folder from their folder tree via a Dialog
   **And** the document's `folderId` is updated in Convex
   **And** the source folder's `documentCount` is decremented and the destination's is incremented
   **And** a Convex action updates the document's `folderId` metadata in Cloudflare AI Search (re-upsert with new folderId attribute)
   **And** the document appears in the destination folder and is removed from the source folder in real-time

3. **Given** a document that is still "processing"
   **When** the user clicks delete
   **Then** the document is deleted from Convex (record + storage) without attempting AI Search cleanup (no chunks exist yet)

## Tasks / Subtasks

- [x] Task 1: Add `deleteDocumentFromAiSearch` internal action to `convex/documentActions.ts` (AC: #1)
  - [x] Add an `internalAction` with args: `documentId: v.string()`
  - [x] Call `DELETE https://api.cloudflare.com/client/v4/accounts/{accountId}/ai-search/instances/{instance}/documents/{documentId}` with Bearer token auth
  - [x] Read config from `process.env.CF_ACCOUNT_ID`, `process.env.CLOUDFLARE_AI_SEARCH_INSTANCE`, `process.env.CLOUDFLARE_AI_SEARCH_TOKEN`
  - [x] Log but do not throw on failure — deletion from Convex should still proceed even if AI Search cleanup fails (eventual consistency)

- [x] Task 2: Update `deleteDocument` mutation in `convex/documents.ts` (AC: #1, #3)
  - [x] Before deleting, check `doc.status` — if `'success'`, schedule `internal.documentActions.deleteDocumentFromAiSearch` via `ctx.scheduler.runAfter(0, ...)` with `{ documentId: args.id }` (string form of the document ID)
  - [x] If status is `'processing'` or `'failed'`, skip AI Search cleanup (no indexed chunks exist)
  - [x] Keep existing logic: delete storage file, delete DB record, decrement folder `documentCount`

- [x] Task 3: Add `moveDocument` mutation to `convex/documents.ts` (AC: #2)
  - [x] Args: `id: v.id('documents')`, `destinationFolderId: v.id('folders')`
  - [x] Verify auth + ownership of the document
  - [x] Verify the destination folder exists and belongs to the same user
  - [x] Prevent no-op moves (source === destination)
  - [x] Patch the document's `folderId` to `destinationFolderId`
  - [x] Decrement source folder `documentCount`, increment destination folder `documentCount`
  - [x] Update both folders' `updatedAt` timestamps
  - [x] N/A — AI Search metadata update on move deferred per Dev Notes (V1 pragmatic decision)

- [x] Task 4: N/A — `updateDocumentAiSearchMetadata` deferred per Dev Notes (V1 pragmatic decision, folderId in AI Search only needed for folder-scoped search in Story 4.1)

- [x] Task 5: Add delete and move actions to `FileStatusItem.vue` (AC: #1, #2)
  - [x] Add a dropdown menu (three-dot / ellipsis icon) to each FileStatusItem row
  - [x] Menu items: "Move to folder" and "Delete" (with destructive styling)
  - [x] Emit `delete` event with document ID and `move` event with document ID when menu items are clicked
  - [x] Add props: `documentId` (string) to pass the document `_id`

- [x] Task 6: Add delete confirmation AlertDialog to folder page (AC: #1)
  - [x] In `app/pages/app/folders/[id].vue`, add an `AlertDialog` that shows when a document delete is triggered
  - [x] Display the filename in the dialog: "Are you sure you want to delete {filename}? This will remove the document and its indexed content."
  - [x] Cancel and Delete buttons — Delete triggers the `deleteDocument` mutation
  - [x] Show toast on success ("Document deleted") and error

- [x] Task 7: Add move-to-folder Dialog to folder page (AC: #2)
  - [x] In `app/pages/app/folders/[id].vue`, add a `Dialog` with a folder picker when "Move to folder" is triggered
  - [x] Display the user's folder tree (reuse `allFolders` from `useFolders()`)
  - [x] Highlight the current folder (disabled / non-selectable)
  - [x] On folder selection, call the `moveDocument` mutation
  - [x] Show toast on success ("Moved to {folderName}") and error

- [x] Task 8: Add `deleteDocument` and `moveDocument` to `useDocuments` composable (AC: #1, #2)
  - [x] Wire up `useConvexMutation(api.documents.deleteDocument)` and `useConvexMutation(api.documents.moveDocument)`
  - [x] Export `deleteDocument(id)` and `moveDocument(id, destinationFolderId)` functions

- [x] Task 9: Write Convex tests for delete with AI Search cleanup (AC: #1, #3) — pre-written via ATDD
  - [x] Test: deleting a "success" document schedules `deleteDocumentFromAiSearch` action
  - [x] Test: deleting a "processing" document does NOT schedule AI Search cleanup
  - [x] Test: deleting a "failed" document does NOT schedule AI Search cleanup
  - [x] Test: folder `documentCount` is decremented after delete
  - [x] Test: `deleteDocumentFromAiSearch` action calls correct Cloudflare endpoint with correct auth headers
  - [x] Test: `deleteDocumentFromAiSearch` does not throw on API failure

- [x] Task 10: Write Convex tests for moveDocument mutation (AC: #2) — pre-written via ATDD
  - [x] Test: document `folderId` is updated to destination
  - [x] Test: source folder `documentCount` decremented, destination incremented
  - [x] Test: both folders' `updatedAt` timestamps are updated
  - [x] Test: moving to same folder throws error (no-op prevention)
  - [x] Test: moving another user's document throws "Document not found"
  - [x] Test: moving to another user's folder throws "Folder not found"
  - [x] N/A — AI Search metadata update on move deferred (V1)

- [x] Task 11: Write component tests for FileStatusItem actions (AC: #1, #2) — pre-written via ATDD
  - [x] Test: dropdown menu renders with "Move to folder" and "Delete" options
  - [x] Test: clicking "Delete" emits `delete` event with document ID
  - [x] Test: clicking "Move to folder" emits `move` event with document ID

### Review Findings

- [x] [Review][Patch] Dropdown menu lacks click-outside-to-close [FileStatusItem.vue] — fixed: added `onClickOutside` from VueUse
- [x] [Review][Patch] Move dialog has no loading guard during mutation [folders/[id].vue] — fixed: added `movePending` ref with disabled state
- [x] [Review][Defer] Move folder picker renders flat list, not a tree [folders/[id].vue:186-195] — deferred, pre-existing UX gap

## Dev Notes

### Cloudflare AI Search Delete API

The Cloudflare AI Search document delete endpoint:
```
DELETE https://api.cloudflare.com/client/v4/accounts/{accountId}/ai-search/instances/{instance}/documents/{documentId}
Authorization: Bearer {token}
```

The `documentId` used during ingestion (Story 3.2) is the Convex document `_id` string — this same ID is used for deletion.

### AI Search Metadata Update on Move

Cloudflare AI Search does not have a dedicated "update attributes" endpoint. The upsert endpoint is idempotent by document ID — re-upserting with the same ID replaces the document. Since the full document text is not stored in Convex (only in Cloudflare), a metadata-only update is not straightforward.

**Approach:** The `updateDocumentAiSearchMetadata` action should attempt to re-upsert with updated attributes. Since Cloudflare AI Search handles the document by ID, upserting with just the attributes and no text change would update the metadata. If this doesn't work with the API, the fallback is to accept that moved documents retain the old `folderId` in AI Search until re-ingestion — the `userId` filter still ensures correct access control. The `folderId` metadata in AI Search is used for folder-scoped search which is a Story 4.1 concern.

**Pragmatic decision:** For V1, skip the AI Search metadata update on move. The `folderId` in AI Search is only used for folder-scoped search (Story 4.1), and the search already filters by `userId` for isolation. When folder-scoped search is implemented, it can re-index or use the Convex `folderId` as the source of truth. This simplifies the move operation significantly.

### Deletion Cascade Order

The mutation handles Convex-side cleanup synchronously (storage delete, DB delete, documentCount update). The AI Search cleanup is scheduled as an async action via `ctx.scheduler.runAfter(0, ...)` — this means:
1. The mutation commits immediately (UI updates instantly via Convex subscription)
2. The AI Search delete runs asynchronously after the mutation commits
3. If AI Search delete fails, the document is already gone from Convex — orphaned chunks in AI Search will not be returned to this user (userId filter prevents it) and can be cleaned up in batch later

### Existing UI Components Available

- `AlertDialog` (shadcn) — for delete confirmation
- `Dialog` (shadcn) — for folder picker
- `DropdownMenu` (shadcn) — for document action menu
- `FolderTree` component — could be reused or simplified for folder picker

### Existing Code to Modify

- `convex/documentActions.ts` — add `deleteDocumentFromAiSearch` internalAction
- `convex/documents.ts` — update `deleteDocument`, add `moveDocument` mutation
- `app/components/documents/FileStatusItem.vue` — add action dropdown
- `app/pages/app/folders/[id].vue` — add delete dialog, move dialog, wire handlers
- `app/composables/useDocuments.ts` — add delete/move mutation wrappers

### Anti-Patterns to Avoid

- Do NOT use `.filter()` in Convex queries — use `.withIndex()`
- Do NOT put `"use node"` in `convex/documents.ts` — it has queries and mutations
- Do NOT call the Cloudflare delete synchronously from the mutation — mutations cannot use `fetch`. Schedule an action instead.
- Do NOT block the delete mutation on AI Search cleanup success — the user should see instant feedback
- Do NOT add `<style>` blocks — use Tailwind utility classes only

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.3]
- [Source: _bmad-output/implementation-artifacts/3-2-document-ingestion-pipeline-with-per-user-isolation.md — Ingestion pattern, documentId as AI Search key]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — "deleteDocument does not remove document from Cloudflare AI Search index"]
- [Source: convex/documents.ts — Current deleteDocument mutation, documents schema]
- [Source: convex/documentActions.ts — Current ingestDocument action, Cloudflare API pattern]
- [Source: convex/_generated/ai/guidelines.md — Convex function patterns]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- ATDD-driven implementation: 12 failing tests pre-written, all turned green
- Task 4 (updateDocumentAiSearchMetadata) deferred per Dev Notes — V1 pragmatic decision, folderId metadata in AI Search only needed for folder-scoped search (Story 4.1)
- FileStatusItem uses inline dropdown instead of shadcn DropdownMenu portal to ensure component testability with wrapper.find()
- All 116 Convex tests pass (0 regressions), all 37 component tests pass (0 regressions)

### File List

- convex/documentActions.ts (modified — added deleteDocumentFromAiSearch internalAction)
- convex/documents.ts (modified — updated deleteDocument with AI Search scheduling, added moveDocument mutation)
- app/components/documents/FileStatusItem.vue (modified — added documentId prop, action dropdown, delete/move emits)
- app/composables/useDocuments.ts (modified — added deleteDocument/moveDocument mutation wrappers)
- app/pages/app/folders/[id].vue (modified — added delete AlertDialog, move Dialog, event handlers)
- convex/documents.test.ts (pre-written ATDD tests — deleteDocument AC#1/#3, moveDocument AC#2)
- convex/documentActions.test.ts (pre-written ATDD tests — deleteDocumentFromAiSearch AC#1)
- tests/component/documents/file-status-item.test.ts (pre-written ATDD tests — action menu AC#1/#2)

### Change Log

- 2026-04-11: Story created, tasks defined
- 2026-04-11: All tasks implemented via ATDD red-green workflow. Status → review
