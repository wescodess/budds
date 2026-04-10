---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: '2026-04-10'
workflowType: testarch-atdd
inputDocuments:
  - _bmad-output/implementation-artifacts/2-2-rename-and-delete-folders.md
  - convex/folders.ts
  - convex/folders.test.ts
  - convex/schema.ts
  - app/composables/useFolders.ts
  - app/components/sidebar/FolderTree.vue
  - tests/component/sidebar/folder-tree.test.ts
  - tests/support/factories/folder.factory.ts
---

# ATDD Checklist - Epic 2, Story 2.2: Rename and Delete Folders

**Date:** 2026-04-10
**Author:** palmwine
**Primary Test Level:** Convex Integration + Component

---

## Story Summary

Enable students to rename and delete folders in the sidebar FolderTree, including cascade deletion of subfolders.

**As a** student
**I want** to rename and delete folders
**So that** I can keep my knowledge base organized as my courses evolve

---

## Acceptance Criteria

1. Right-click (or "..." on mobile) shows DropdownMenu with "Rename" and "Delete" options
2. "Rename" enables inline editable input; Enter confirms, Escape cancels; empty/whitespace rejected; max 100 chars; trims; real-time Convex update
3. "Delete" on empty folder shows confirmation Dialog, confirming deletes folder from Convex
4. "Delete" on folder with children shows cascade warning ("Delete [name] and all [N] subfolders and [M] documents inside?"), recursive bottom-up deletion
5. ContextMenu, DropdownMenu, Dialog, AlertDialog shadcn components already scaffolded

---

## Failing Tests Created (RED Phase)

### Convex Integration Tests (17 tests)

**File:** `convex/folders.test.ts` (appended to existing file)

**`folders.renameFolder` (8 tests):**

- `it.skip` **[P0] should rename a folder for authenticated owner**
  - **Status:** RED — `api.folders.renameFolder` does not exist
  - **Verifies:** AC #2 — name updates in Convex after rename

- `it.skip` **[P0] should reject empty name**
  - **Status:** RED — mutation not implemented
  - **Verifies:** AC #2 — empty name validation

- `it.skip` **[P0] should reject whitespace-only name**
  - **Status:** RED — mutation not implemented
  - **Verifies:** AC #2 — whitespace-only rejection

- `it.skip` **[P0] should reject name longer than 100 characters**
  - **Status:** RED — mutation not implemented
  - **Verifies:** AC #2 — max 100 char enforcement

- `it.skip` **[P1] should trim whitespace from name**
  - **Status:** RED — mutation not implemented
  - **Verifies:** AC #2 — name trimming

- `it.skip` **[P1] should update updatedAt timestamp**
  - **Status:** RED — mutation not implemented
  - **Verifies:** AC #2 — updatedAt field mutation

- `it.skip` **[P1] should reject renaming another user's folder**
  - **Status:** RED — mutation not implemented
  - **Verifies:** AC #2 — ownership validation

- `it.skip` **[P1] should reject unauthenticated user**
  - **Status:** RED — mutation not implemented
  - **Verifies:** AC #2 — auth guard

**`folders.deleteFolder` (6 tests):**

- `it.skip` **[P0] should delete a leaf folder**
  - **Status:** RED — `api.folders.deleteFolder` does not exist
  - **Verifies:** AC #3 — single folder deletion

- `it.skip` **[P0] should cascade delete folder with direct children**
  - **Status:** RED — mutation not implemented
  - **Verifies:** AC #4 — cascade to direct children

- `it.skip` **[P0] should cascade delete 3-level nested hierarchy**
  - **Status:** RED — mutation not implemented
  - **Verifies:** AC #4 — deep cascade (bottom-up)

- `it.skip` **[P0] should return count of deleted items**
  - **Status:** RED — mutation not implemented
  - **Verifies:** AC #4 — returns `{ deletedFolders, deletedDocuments }`

- `it.skip` **[P1] should reject deleting another user's folder**
  - **Status:** RED — mutation not implemented
  - **Verifies:** AC #3 — ownership validation

- `it.skip` **[P1] should reject unauthenticated user**
  - **Status:** RED — mutation not implemented
  - **Verifies:** AC #3 — auth guard

**`folders.getFolderDescendantCounts` (5 tests):**

- `it.skip` **[P0] should return zero counts for empty folder**
  - **Status:** RED — `api.folders.getFolderDescendantCounts` does not exist
  - **Verifies:** AC #4 — correct counts for leaf folder

- `it.skip` **[P0] should return correct counts for folder with direct children**
  - **Status:** RED — query not implemented
  - **Verifies:** AC #4 — accurate child count

- `it.skip` **[P0] should return correct counts for 3-level hierarchy**
  - **Status:** RED — query not implemented
  - **Verifies:** AC #4 — recursive count across depth

- `it.skip` **[P1] should reject unauthenticated user**
  - **Status:** RED — query not implemented
  - **Verifies:** AC #4 — auth guard

- `it.skip` **[P1] should reject another user's folder**
  - **Status:** RED — query not implemented
  - **Verifies:** AC #4 — ownership isolation

### Component Tests (5 tests)

**File:** `tests/component/sidebar/folder-tree.test.ts` (appended to existing file)

**FolderTree — AC1: Context Menu (2 tests):**

- `it.skip` **[P0] should show context menu with Rename and Delete on right-click**
  - **Status:** RED — ContextMenu not yet wired to FolderTree
  - **Verifies:** AC #1 — right-click triggers context menu with correct options

- `it.skip` **[P1] should show "..." dropdown menu button**
  - **Status:** RED — DropdownMenu not yet added
  - **Verifies:** AC #1 — mobile/touch fallback button

**FolderTree — AC2: Inline Rename (2 tests + 1 cancel):**

- `it.skip` **[P0] should show inline input when rename is triggered**
  - **Status:** RED — inline edit mode not yet implemented
  - **Verifies:** AC #2 — input appears pre-filled with current name

- `it.skip` **[P1] should confirm rename on Enter and cancel on Escape**
  - **Status:** RED — inline edit mode not yet implemented
  - **Verifies:** AC #2 — Escape reverts to original name

---

## Data Factories (Existing)

### Folder Factory

**File:** `tests/support/factories/folder.factory.ts`

**Exports:**
- `createFolder(overrides?)` — single folder doc with faker defaults
- `createFolders(count, overrides?)` — array of folder docs

No new factories needed — existing factory sufficient for all component test scenarios.

---

## Required data-testid Attributes

### FolderTree (new attributes for Story 2-2)

- `context-menu-rename` — Rename option in context menu
- `context-menu-delete` — Delete option in context menu
- `folder-more-menu-{id}` — "..." dropdown trigger button per folder
- `rename-input-{id}` — Inline rename input per folder
- `delete-dialog` — AlertDialog root for delete confirmation
- `delete-dialog-confirm` — Destructive confirm button in delete dialog

### Existing (from Story 2-1, no changes)

- `folder-tree-item-{id}` — TreeItem per folder
- `add-subfolder-{id}` — "+" subfolder creation button

---

## Implementation Checklist

### Test: renameFolder mutation (8 tests)

**File:** `convex/folders.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `renameFolder` mutation to `convex/folders.ts` — args: `id: v.id('folders')`, `name: v.string()`
- [ ] Validate ownership via `ctx.auth.getUserIdentity()` → `tokenIdentifier`
- [ ] Trim name, reject empty/whitespace-only, enforce max 100 chars
- [ ] Use `ctx.db.patch()` to update `name` and `updatedAt` fields
- [ ] Remove `.skip` from renameFolder tests
- [ ] Run: `pnpm test -- --grep "renameFolder"`
- [ ] All 8 tests pass (green phase)

### Test: deleteFolder mutation (6 tests)

**File:** `convex/folders.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `deleteFolder` mutation to `convex/folders.ts` — args: `id: v.id('folders')`
- [ ] Validate ownership
- [ ] Recursively collect descendant IDs using `by_userId_and_parentId` index (bottom-up)
- [ ] Delete all descendants + target folder
- [ ] Return `{ deletedFolders: number, deletedDocuments: number }`
- [ ] Remove `.skip` from deleteFolder tests
- [ ] Run: `pnpm test -- --grep "deleteFolder"`
- [ ] All 6 tests pass (green phase)

### Test: getFolderDescendantCounts query (5 tests)

**File:** `convex/folders.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `getFolderDescendantCounts` query to `convex/folders.ts` — args: `id: v.id('folders')`
- [ ] Validate ownership, return null for unauthorized
- [ ] Recursively walk child folders using `by_userId_and_parentId` index
- [ ] Return `{ subfolderCount: number, documentCount: number }`
- [ ] Remove `.skip` from getFolderDescendantCounts tests
- [ ] Run: `pnpm test -- --grep "getFolderDescendantCounts"`
- [ ] All 5 tests pass (green phase)

### Test: Context menu rendering (2 tests)

**File:** `tests/component/sidebar/folder-tree.test.ts`

**Tasks to make these tests pass:**

- [ ] Wrap TreeItem content with `UiContextMenu` in `FolderTree.vue`
- [ ] Add `UiContextMenuContent` with Rename and Delete items
- [ ] Add `data-testid="context-menu-rename"` and `data-testid="context-menu-delete"`
- [ ] Add `UiDropdownMenu` with "..." trigger button (`data-testid="folder-more-menu-{id}"`)
- [ ] Remove `.skip` from context menu tests
- [ ] Run: `pnpm test:component -- --grep "Context Menu"`
- [ ] All 2 tests pass (green phase)

### Test: Inline rename (3 tests)

**File:** `tests/component/sidebar/folder-tree.test.ts`

**Tasks to make these tests pass:**

- [ ] Add `editingId` and `editName` reactive refs to FolderTree
- [ ] Replace `<span>` with `<input>` when `editingId === item.value._id`
- [ ] Add `data-testid="rename-input-{id}"` on the input
- [ ] Handle Enter (submit), Escape (cancel), blur (cancel)
- [ ] Use `nextTick()` to auto-focus and select text
- [ ] Remove `.skip` from inline rename tests
- [ ] Run: `pnpm test:component -- --grep "Inline Rename"`
- [ ] All 3 tests pass (green phase)

---

## Running Tests

```bash
# Run all Convex integration tests (includes skipped RED tests)
pnpm test

# Run only rename/delete tests
pnpm test -- --grep "renameFolder|deleteFolder|getFolderDescendantCounts"

# Run component tests
pnpm test:component

# Run only FolderTree component tests
pnpm test:component -- --grep "FolderTree"

# Run in watch mode during development
pnpm test:watch
pnpm test:component:watch
```

---

## Red-Green-Refactor Workflow

### RED Phase (Complete)

**TEA Agent Responsibilities:**

- All 22 tests written and skipped (`it.skip`)
- Existing factory reused (no new factories needed)
- data-testid requirements listed for implementation
- Implementation checklist created with per-test-group tasks

**Verification:**

- Tests are skipped (RED) — they reference functions/UI that don't exist yet
- When `.skip` is removed, tests will fail with clear errors
- Failure is due to missing implementation, not test bugs

---

### GREEN Phase (DEV Team — Next Steps)

**DEV Agent Responsibilities:**

1. **Start with Convex mutations** (Task 1 from story): implement `renameFolder`, `deleteFolder`, `getFolderDescendantCounts`
2. **Remove `.skip`** from corresponding test group
3. **Run tests** to verify green: `pnpm test -- --grep "renameFolder"`
4. **Move to composable** (Task 2): add bindings in `useFolders.ts`
5. **Move to UI** (Tasks 3-5): add context menu, inline rename, delete dialog
6. **Remove `.skip`** from component tests, verify green

**Key Principles:**
- One test group at a time
- Minimal implementation to pass
- Run tests frequently
- Remove `@ts-expect-error` comments when functions exist

---

### REFACTOR Phase (After All Tests Pass)

1. Verify all 22 tests pass
2. Remove all `@ts-expect-error` annotations
3. Check for duplication in recursive helper functions
4. Ensure tests still pass after each refactor

---

## Next Steps

1. **Begin implementation** with Convex mutations (Task 1 from story)
2. **Remove `.skip`** one group at a time as you implement
3. **Run tests** after each implementation step
4. **When all tests pass**, proceed to code review

---

## Knowledge Base References Applied

- **data-factories.md** — Existing factory pattern reused for component tests
- **test-quality.md** — Given-When-Then, one concern per test, deterministic, isolated
- **test-levels-framework.md** — Convex integration for business logic, Component for UI behavior
- **test-healing-patterns.md** — `@ts-expect-error` for RED phase, `data-testid` for selector stability

---

## Notes

- No Playwright/Cypress in this project — all tests use Vitest
- `documentCount` will always be 0 until Epic 3 adds the documents table
- `deleteFolder` cascade strategy: collect descendants bottom-up, then delete — avoids orphan folders
- Component tests use `mountSuspended` from `@nuxt/test-utils/runtime` (Nuxt environment)
- The `getFolderDescendantCounts` query is used by the UI to populate cascade warning text in the AlertDialog

---

**Generated by BMad TEA Agent** — 2026-04-10
