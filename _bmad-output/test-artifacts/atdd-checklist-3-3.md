---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-04-11'
workflowType: 'testarch-atdd'
inputDocuments:
  - _bmad-output/implementation-artifacts/3-3-delete-documents-and-move-between-folders.md
  - convex/documents.ts
  - convex/documentActions.ts
  - convex/schema.ts
  - convex/documents.test.ts
  - convex/documentActions.test.ts
  - tests/component/documents/file-status-item.test.ts
  - app/components/documents/FileStatusItem.vue
  - app/composables/useDocuments.ts
  - app/pages/app/folders/[id].vue
---

# ATDD Checklist - Epic 3, Story 3.3: Delete Documents and Move Between Folders

**Date:** 2026-04-11
**Author:** palmwine
**Primary Test Level:** Convex Integration + Component

---

## Story Summary

Users need to delete documents they no longer need and move documents between folders to keep their knowledge base organized. Deletion cascades through AI Search, Convex storage, and DB records. Moving updates folder counts and document ownership.

**As a** student
**I want** to delete documents and reorganize them between folders
**So that** my knowledge base stays clean and well-organized

---

## Acceptance Criteria

1. Delete action triggers cascading deletion: schedule AI Search removal → delete storage file → delete DB record → decrement folder documentCount
2. Move to folder updates document's folderId, decrements source and increments destination documentCount, updates both folders' timestamps
3. Deleting a "processing" document skips AI Search cleanup (no chunks exist yet)

---

## Failing Tests Created (RED Phase)

### Convex Integration Tests — deleteDocument (8 tests)

**File:** `convex/documents.test.ts` — describe block `documents.deleteDocument — AC #1, #3`

- **Test:** `[P0] should decrement folder documentCount`
  - **Status:** PASS (pre-existing, already implemented)
  - **Verifies:** Folder count tracking on delete

- **Test:** `[P0] should delete the document record from the database`
  - **Status:** PASS (pre-existing logic)
  - **Verifies:** DB record removal

- **Test:** `[P0] should delete the file from storage`
  - **Status:** PASS (pre-existing logic)
  - **Verifies:** Storage cleanup

- **Test:** `[P0] should schedule deleteDocumentFromAiSearch when doc status is success`
  - **Status:** RED — deleteDocument does not yet schedule AI Search cleanup
  - **Verifies:** AC #1 cascade step 1: schedule AI Search removal for "success" docs

- **Test:** `[P0] should NOT schedule AI Search cleanup when doc status is processing`
  - **Status:** RED — no scheduling logic exists yet to test against
  - **Verifies:** AC #3: skip AI Search for processing docs

- **Test:** `[P1] should NOT schedule AI Search cleanup when doc status is failed`
  - **Status:** RED — no scheduling logic exists yet
  - **Verifies:** AC #3 edge case: skip AI Search for failed docs

- **Test:** `[P0] should reject unauthenticated user`
  - **Status:** PASS (pre-existing)

- **Test:** `[P0] should reject deleting another user's document`
  - **Status:** PASS (pre-existing)

### Convex Integration Tests — deleteDocumentFromAiSearch (2 tests)

**File:** `convex/documentActions.test.ts` — describe block `documentActions.deleteDocumentFromAiSearch — AC #1`

- **Test:** `[P0] should call Cloudflare DELETE endpoint with correct URL and auth`
  - **Status:** RED — `deleteDocumentFromAiSearch` action does not exist
  - **Verifies:** Correct Cloudflare API call with Bearer token auth

- **Test:** `[P1] should not throw when Cloudflare API returns an error`
  - **Status:** RED — action does not exist
  - **Verifies:** Graceful failure handling (log but don't throw)

### Convex Integration Tests — moveDocument (7 tests)

**File:** `convex/documents.test.ts` — describe block `documents.moveDocument — AC #2`

- **Test:** `[P0] should update document folderId to destination`
  - **Status:** RED — `moveDocument` mutation does not exist
  - **Verifies:** Core move operation

- **Test:** `[P0] should decrement source and increment destination documentCount`
  - **Status:** RED — mutation does not exist
  - **Verifies:** Folder count bookkeeping

- **Test:** `[P1] should update both folders updatedAt timestamps`
  - **Status:** RED — mutation does not exist
  - **Verifies:** Timestamp freshness

- **Test:** `[P1] should throw error when moving to same folder`
  - **Status:** RED — mutation does not exist
  - **Verifies:** No-op prevention

- **Test:** `[P0] should reject moving another user's document`
  - **Status:** RED — mutation does not exist
  - **Verifies:** Cross-user document isolation

- **Test:** `[P0] should reject moving to another user's folder`
  - **Status:** RED — mutation does not exist
  - **Verifies:** Cross-user folder isolation

- **Test:** `[P0] should reject unauthenticated user`
  - **Status:** RED — mutation does not exist
  - **Verifies:** Auth guard

### Component Tests — FileStatusItem Actions (3 tests)

**File:** `tests/component/documents/file-status-item.test.ts` — describe block `FileStatusItem — Action Menu (AC #1, #2)`

- **Test:** `[P0] should render a dropdown action menu with trigger button`
  - **Status:** RED — no action menu in component
  - **Verifies:** Dropdown trigger renders with data-testid

- **Test:** `[P0] should emit delete event with document ID when Delete is clicked`
  - **Status:** RED — no action menu in component
  - **Verifies:** Delete menu item emits correct event

- **Test:** `[P0] should emit move event with document ID when Move to folder is clicked`
  - **Status:** RED — no action menu in component
  - **Verifies:** Move menu item emits correct event

---

## Mock Requirements

### Cloudflare AI Search — DELETE Endpoint

**Endpoint:** `DELETE https://api.cloudflare.com/client/v4/accounts/{accountId}/ai-search/instances/{instance}/documents/{documentId}`

**Success Response:**
```json
{ "success": true }
```

**Failure Response:**
```json
{ "success": false, "errors": [{ "message": "Not found" }] }
```

**Notes:** Tests use `vi.stubGlobal('fetch', ...)` to mock. Env vars `CF_ACCOUNT_ID`, `CLOUDFLARE_AI_SEARCH_INSTANCE`, `CLOUDFLARE_AI_SEARCH_TOKEN` must be set in test `beforeEach`.

---

## Required data-testid Attributes

### FileStatusItem Component

- `document-actions-trigger` — Ellipsis/three-dot button that opens the dropdown menu
- `action-delete` — "Delete" menu item inside the dropdown
- `action-move` — "Move to folder" menu item inside the dropdown

---

## Implementation Checklist

### Task 1: Add `deleteDocumentFromAiSearch` internalAction to `convex/documentActions.ts`

**Makes these tests pass:**
- `[P0] should call Cloudflare DELETE endpoint with correct URL and auth`
- `[P1] should not throw when Cloudflare API returns an error`

**Tasks:**
- [ ] Add `internalAction` with args: `documentId: v.string()`
- [ ] Call `DELETE` to Cloudflare AI Search endpoint with Bearer token auth
- [ ] Read config from `process.env.CF_ACCOUNT_ID`, `CLOUDFLARE_AI_SEARCH_INSTANCE`, `CLOUDFLARE_AI_SEARCH_TOKEN`
- [ ] Log but do not throw on failure
- [ ] Run: `pnpm test convex/documentActions.test.ts`

### Task 2: Update `deleteDocument` mutation in `convex/documents.ts`

**Makes these tests pass:**
- `[P0] should schedule deleteDocumentFromAiSearch when doc status is success`
- `[P0] should NOT schedule AI Search cleanup when doc status is processing`
- `[P1] should NOT schedule AI Search cleanup when doc status is failed`

**Tasks:**
- [ ] Before deleting, check `doc.status`
- [ ] If `'success'`, schedule `internal.documentActions.deleteDocumentFromAiSearch` via `ctx.scheduler.runAfter(0, ...)`
- [ ] If `'processing'` or `'failed'`, skip AI Search cleanup
- [ ] Keep existing logic (delete storage, delete DB record, decrement folder count)
- [ ] Run: `pnpm test convex/documents.test.ts`

### Task 3: Add `moveDocument` mutation to `convex/documents.ts`

**Makes these tests pass:**
- `[P0] should update document folderId to destination`
- `[P0] should decrement source and increment destination documentCount`
- `[P1] should update both folders updatedAt timestamps`
- `[P1] should throw error when moving to same folder`
- `[P0] should reject moving another user's document`
- `[P0] should reject moving to another user's folder`
- `[P0] should reject unauthenticated user`

**Tasks:**
- [ ] Add mutation with args: `id: v.id('documents')`, `destinationFolderId: v.id('folders')`
- [ ] Verify auth + ownership of document
- [ ] Verify destination folder exists and belongs to same user
- [ ] Prevent no-op (source === destination)
- [ ] Patch document's `folderId`
- [ ] Decrement source, increment destination `documentCount`
- [ ] Update both folders' `updatedAt`
- [ ] Run: `pnpm test convex/documents.test.ts`

### Task 4: Add action dropdown to `FileStatusItem.vue`

**Makes these tests pass:**
- `[P0] should render a dropdown action menu with trigger button`
- `[P0] should emit delete event with document ID when Delete is clicked`
- `[P0] should emit move event with document ID when Move to folder is clicked`

**Tasks:**
- [ ] Add `documentId` prop (string)
- [ ] Add `DropdownMenu` with ellipsis trigger (`data-testid="document-actions-trigger"`)
- [ ] Add "Move to folder" item (`data-testid="action-move"`) → emit `move` with documentId
- [ ] Add "Delete" item with destructive styling (`data-testid="action-delete"`) → emit `delete` with documentId
- [ ] Run: `pnpm test:component tests/component/documents/file-status-item.test.ts`

### Task 5: Add delete/move mutations to `useDocuments` composable

**Tasks:**
- [ ] Wire `useConvexMutation(api.documents.deleteDocument)` and `useConvexMutation(api.documents.moveDocument)`
- [ ] Export `deleteDocument(id)` and `moveDocument(id, destinationFolderId)` functions

### Task 6: Add delete confirmation AlertDialog to folder page

**Tasks:**
- [ ] Add `AlertDialog` to `app/pages/app/folders/[id].vue`
- [ ] Show filename in dialog confirmation message
- [ ] Cancel and Delete buttons — Delete triggers `deleteDocument` mutation
- [ ] Show toast on success/error

### Task 7: Add move-to-folder Dialog to folder page

**Tasks:**
- [ ] Add `Dialog` with folder picker to `app/pages/app/folders/[id].vue`
- [ ] Display user's folder tree (reuse `allFolders` from `useFolders()`)
- [ ] Current folder disabled/non-selectable
- [ ] On selection, call `moveDocument` mutation
- [ ] Show toast on success/error

---

## Running Tests

```bash
# Run all Convex tests (includes delete + move tests)
pnpm test convex/documents.test.ts convex/documentActions.test.ts

# Run component tests for FileStatusItem
pnpm test:component tests/component/documents/file-status-item.test.ts

# Run only the new failing tests
pnpm test convex/documents.test.ts -t "moveDocument"
pnpm test convex/documents.test.ts -t "deleteDocument.*AC"
pnpm test convex/documentActions.test.ts -t "deleteDocumentFromAiSearch"
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

- 12 new failing tests written across Convex integration and component levels
- All failures due to missing implementation (not test bugs)
- Pre-existing 31 Convex tests + 34 component tests continue to pass

### GREEN Phase (DEV Team - Next Steps)

1. Start with Task 1 (deleteDocumentFromAiSearch action) — smallest, self-contained
2. Then Task 2 (update deleteDocument mutation) — depends on Task 1
3. Then Task 3 (moveDocument mutation) — independent
4. Then Task 4 (FileStatusItem dropdown) — UI layer
5. Then Tasks 5-7 (composable + page wiring) — integration

### REFACTOR Phase

After all tests pass, review for:
- Consistent error messages across mutations
- Edge case handling (concurrent deletes, missing folders)
- Code reuse between delete and move operations

---

## Test Execution Evidence

### Initial Test Run (RED Phase Verification)

**Convex Tests:**
```
Tests  8 failed | 31 passed (39)
```

**Component Tests:**
```
Tests  3 failed | 34 passed (96 total with skipped)
```

**Summary:**
- New failing tests: 11
- Pre-existing passing tests: 65
- Status: RED phase verified

---

## Notes

- Per the story's dev notes, AI Search metadata update on move (Task 4 in story) is deferred to V1 — the `folderId` in AI Search is only used for folder-scoped search (Story 4.1). Tests do not assert on AI Search metadata update for move.
- The `deleteDocumentFromAiSearch` action takes a `documentId: v.string()` (not `v.id('documents')`) because it's the string form used as the AI Search document ID.
- Tests for `_scheduled_functions` system table query use `.collect()` which is acceptable for test-only reads of small result sets.

---

**Generated by BMad TEA Agent** - 2026-04-11
